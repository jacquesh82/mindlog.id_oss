/**
 * Couche « appareils » du multi-appareils E2E natif (P1, cf.
 * docs/multidevice-proposal.md). Un compte (identité) lie plusieurs appareils,
 * chacun avec sa PROPRE clé E2E et son PROPRE bundle de prekeys X3DH.
 *
 * Sécurité : l'enrôlement d'un nouvel appareil est en attente (`approved=0`)
 * jusqu'à approbation par un appareil DÉJÀ approuvé. Le tout premier appareil du
 * compte est auto-approuvé (amorçage). Limite : MAX_DEVICES appareils actifs.
 *
 * Le serveur ne voit que du matériel PUBLIC (clés publiques, prekeys publiques) —
 * jamais de clé privée ni d'état de ratchet.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db.js";
import { devices, devicePrekeys, deviceOneTimePrekeys } from "./schema.js";
import type { PrekeyBundleInput } from "./store.js";

export const MAX_DEVICES = 5; // appareils actifs par compte
const MAX_DEVICE_OPK_POOL = 200; // OPK par appareil (anti-flood)

export interface DeviceRow {
  id: number;
  deviceId: string;
  e2ePubkey: string;
  name: string;
  approved: boolean;
  createdAt: string;
  lastSeen: string | null;
}

interface RawDevice {
  id: number;
  device_id: string;
  e2e_pubkey: string;
  name: string;
  approved: number;
  created_at: string;
  last_seen: string | null;
}

const mapDevice = (r: RawDevice): DeviceRow => ({
  id: r.id,
  deviceId: r.device_id,
  e2ePubkey: r.e2e_pubkey,
  name: r.name,
  approved: r.approved === 1,
  createdAt: r.created_at,
  lastSeen: r.last_seen,
});

/** Appareils actifs (non révoqués) d'une identité, du plus ancien au plus récent. */
export async function listDevices(identityId: number): Promise<DeviceRow[]> {
  const rows = (await db
    .select()
    .from(devices)
    .where(and(eq(devices.identity_id, identityId), isNull(devices.revoked_at)))
    .orderBy(devices.id)) as RawDevice[];
  return rows.map(mapDevice);
}

async function approvedCount(identityId: number): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(devices)
    .where(and(eq(devices.identity_id, identityId), isNull(devices.revoked_at), eq(devices.approved, 1)));
  return rows.at(0)?.n ?? 0;
}

/**
 * Enregistre (ou rafraîchit) un appareil. Le PREMIER appareil approuvé du compte
 * est auto-approuvé (amorçage) ; les suivants restent en attente jusqu'à
 * approbation par un appareil déjà actif. Borné à [MAX_DEVICES].
 */
export async function registerDevice(
  identityId: number,
  deviceId: string,
  e2ePubkey: string,
  name: string
): Promise<{ device: DeviceRow; pending: boolean }> {
  const existing = (
    await db
      .select()
      .from(devices)
      .where(and(eq(devices.identity_id, identityId), eq(devices.device_id, deviceId)))
      .limit(1)
  ).at(0) as RawDevice | undefined;
  if (existing) {
    // Re-publication (nouvelle clé, ré-enrôlement après révocation) : conserve `approved`.
    const next = { ...existing, e2e_pubkey: e2ePubkey, name: name || existing.name };
    await db
      .update(devices)
      .set({ e2e_pubkey: e2ePubkey, name: next.name, revoked_at: null, last_seen: new Date().toISOString() })
      .where(eq(devices.id, existing.id));
    return { device: mapDevice(next), pending: existing.approved !== 1 };
  }
  if ((await listDevices(identityId)).length >= MAX_DEVICES) throw new Error("Limite d'appareils atteinte (5).");
  const firstApproved = (await approvedCount(identityId)) === 0; // amorçage : 1er appareil
  const ins = (await db
    .insert(devices)
    .values({
      identity_id: identityId,
      device_id: deviceId,
      e2e_pubkey: e2ePubkey,
      name,
      approved: firstApproved ? 1 : 0,
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    })
    .returning()) as RawDevice[];
  return { device: mapDevice(ins[0]), pending: !firstApproved };
}

/**
 * Résout des `device_id` (chaînes) → clés primaires, en ne gardant que les
 * appareils APPROUVÉS, non révoqués, appartenant à l'une des `identityIds`
 * fournies (le pair et/ou moi). Sert à valider les destinataires d'un fan-out.
 */
export async function resolveDevicePks(identityIds: number[], deviceIds: string[]): Promise<Map<string, number>> {
  if (!deviceIds.length || !identityIds.length) return new Map();
  const rows = (await db
    .select({ id: devices.id, device_id: devices.device_id })
    .from(devices)
    .where(
      and(
        inArray(devices.identity_id, identityIds),
        inArray(devices.device_id, deviceIds),
        isNull(devices.revoked_at),
        eq(devices.approved, 1)
      )
    )) as { id: number; device_id: string }[];
  return new Map(rows.map((r) => [r.device_id, r.id]));
}

/** Résout l'appareil courant depuis l'en-tête `x-device-id`. */
export async function resolveDevice(identityId: number, deviceId: string | undefined): Promise<DeviceRow | undefined> {
  if (!deviceId) return undefined;
  const r = (
    await db
      .select()
      .from(devices)
      .where(and(eq(devices.identity_id, identityId), eq(devices.device_id, deviceId), isNull(devices.revoked_at)))
      .limit(1)
  ).at(0) as RawDevice | undefined;
  return r ? mapDevice(r) : undefined;
}

/** Approuve un appareil en attente. RÉSERVÉ à un appareil DÉJÀ approuvé du compte. */
export async function approveDevice(
  identityId: number,
  targetPk: number,
  approverDeviceId: string | undefined
): Promise<boolean> {
  const approver = await resolveDevice(identityId, approverDeviceId);
  if (!approver || !approver.approved) return false; // seul un appareil approuvé peut approuver
  const res = await db
    .update(devices)
    .set({ approved: 1 })
    .where(and(eq(devices.id, targetPk), eq(devices.identity_id, identityId), isNull(devices.revoked_at)))
    .returning({ id: devices.id });
  return res.length > 0;
}

/** Révoque (déconnecte) un appareil : ses enveloppes/bundles cessent d'être servis. */
export async function revokeDevice(identityId: number, targetPk: number): Promise<boolean> {
  const res = await db
    .update(devices)
    .set({ revoked_at: new Date().toISOString() })
    .where(and(eq(devices.id, targetPk), eq(devices.identity_id, identityId)))
    .returning({ id: devices.id });
  return res.length > 0;
}

/** Publie/rafraîchit le bundle de prekeys de CET appareil (purge OPK si la SPK change). */
export async function setDevicePrekeyBundle(devicePk: number, b: PrekeyBundleInput): Promise<void> {
  const prev = (
    await db.select({ spk_pub: devicePrekeys.spk_pub }).from(devicePrekeys).where(eq(devicePrekeys.device_pk, devicePk)).limit(1)
  ).at(0)?.spk_pub;
  const spkChanged = prev !== undefined && prev !== b.spkPub;
  await db
    .insert(devicePrekeys)
    .values({ device_pk: devicePk, spk_pub: b.spkPub, spk_id: b.spkId, spk_sig: b.spkSig ?? "", updated_at: new Date().toISOString() })
    .onConflictDoUpdate({
      target: devicePrekeys.device_pk,
      set: { spk_pub: b.spkPub, spk_id: b.spkId, spk_sig: b.spkSig ?? "", updated_at: new Date().toISOString() },
    });
  if (spkChanged) await db.delete(deviceOneTimePrekeys).where(eq(deviceOneTimePrekeys.device_pk, devicePk));
  if (b.opks?.length) await replenishDeviceOpks(devicePk, b.opks);
}

export async function replenishDeviceOpks(devicePk: number, opks: { opkId: number; opkPub: string }[]): Promise<void> {
  if (!opks.length) return;
  const room = Math.max(0, MAX_DEVICE_OPK_POOL - (await countDeviceOpks(devicePk)));
  const slice = opks.slice(0, room);
  if (!slice.length) return;
  await db
    .insert(deviceOneTimePrekeys)
    .values(slice.map((o) => ({ device_pk: devicePk, opk_id: o.opkId, opk_pub: o.opkPub })))
    .onConflictDoNothing();
}

export async function countDeviceOpks(devicePk: number): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deviceOneTimePrekeys)
    .where(and(eq(deviceOneTimePrekeys.device_pk, devicePk), eq(deviceOneTimePrekeys.consumed, 0)));
  return rows.at(0)?.n ?? 0;
}

export interface DeviceBundle {
  deviceId: string;
  ik: string; // clé publique d'identité de l'APPAREIL
  spkPub: string;
  spkId: number;
  spkSig: string;
  opkPub: string | null; // OPK consommée pour ce handshake (null si pool vide)
  opkId: number | null;
}

/**
 * Bundles de TOUS les appareils approuvés/actifs d'une identité (1 OPK consommée
 * par appareil, atomique) — base du fan‑out X3DH. `excludeDeviceId` sert à exclure
 * MON propre appareil quand je récupère mes AUTRES appareils (sync).
 */
export async function fetchDeviceBundles(
  identityId: number,
  opts: { excludeDeviceId?: string } = {}
): Promise<DeviceBundle[]> {
  const devs = (await listDevices(identityId)).filter((d) => d.approved && d.deviceId !== opts.excludeDeviceId);
  const out: DeviceBundle[] = [];
  for (const d of devs) {
    const spk = (
      await db
        .select({ spk_pub: devicePrekeys.spk_pub, spk_id: devicePrekeys.spk_id, spk_sig: devicePrekeys.spk_sig })
        .from(devicePrekeys)
        .where(eq(devicePrekeys.device_pk, d.id))
        .limit(1)
    ).at(0);
    if (!spk) continue; // appareil sans bundle publié → non joignable pour l'instant
    // Consommation atomique d'une OPK (la plus récente d'abord, cf. fetchPrekeyBundle).
    const consumed = await db.execute(sql`
      UPDATE device_one_time_prekeys SET consumed = 1
       WHERE id = (
         SELECT id FROM device_one_time_prekeys WHERE device_pk = ${d.id} AND consumed = 0 ORDER BY id DESC LIMIT 1
       )
       RETURNING opk_id, opk_pub
    `);
    const opk = consumed.rows.at(0) as { opk_id: number; opk_pub: string } | undefined;
    out.push({
      deviceId: d.deviceId,
      ik: d.e2ePubkey,
      spkPub: spk.spk_pub,
      spkId: spk.spk_id,
      spkSig: spk.spk_sig,
      opkPub: opk?.opk_pub ?? null,
      opkId: opk?.opk_id ?? null,
    });
  }
  return out;
}
