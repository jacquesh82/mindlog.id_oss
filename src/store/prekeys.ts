// Domaine « prekeys » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  e2eOneTimePrekeys,
  e2ePrekeys,
  identities,
} from "../schema.js";
import { getIdentityById } from "./identities.js";

/* ---- Prekeys X3DH (matériel public, opaque au serveur) ---- */

const MAX_OPK_POOL = 200; // borne par identité (anti-flood d'écriture)

export interface PrekeyBundleInput {
  spkPub: string;
  spkId: number;
  spkSig?: string;
  opks?: { opkId: number; opkPub: string }[];
}

/** Publie/rafraîchit la SPK et ajoute des OPK au pool (idempotent sur opk_id). */
export async function setPrekeyBundle(identityId: number, b: PrekeyBundleInput): Promise<void> {
  // Détection d'une régénération du store client : si la SPK publique change, les
  // OPK encore en base proviennent de l'ANCIENNE génération de clés — le client
  // n'en détient plus les clés privées (navigateur réinitialisé, restauration de
  // coffre sur appareil vierge…). Servir une telle OPK « fantôme » à un expéditeur
  // produit un DH4 incohérent côté destinataire → message « illisible ». On purge
  // donc le pool OPK quand la SPK change pour qu'il ne contienne que des OPK dont
  // le destinataire a réellement la clé privée.
  const prevRows = await db
    .select({ spk_pub: e2ePrekeys.spk_pub })
    .from(e2ePrekeys)
    .where(eq(e2ePrekeys.identity_id, identityId))
    .limit(1);
  const prevSpk = prevRows.at(0)?.spk_pub;
  const spkChanged = prevSpk !== undefined && prevSpk !== b.spkPub;

  await db
    .insert(e2ePrekeys)
    .values({
      identity_id: identityId,
      spk_pub: b.spkPub,
      spk_id: b.spkId,
      spk_sig: b.spkSig ?? "",
      updated_at: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: e2ePrekeys.identity_id,
      set: { spk_pub: b.spkPub, spk_id: b.spkId, spk_sig: b.spkSig ?? "", updated_at: new Date().toISOString() },
    });
  if (spkChanged) {
    await db.delete(e2eOneTimePrekeys).where(eq(e2eOneTimePrekeys.identity_id, identityId));
  }
  if (b.opks?.length) await replenishOneTimePrekeys(identityId, b.opks);
}

/** Ajoute des OPK au pool (ignore les doublons d'opk_id), borné à MAX_OPK_POOL. */
export async function replenishOneTimePrekeys(
  identityId: number,
  opks: { opkId: number; opkPub: string }[]
): Promise<void> {
  if (!opks.length) return;
  const free = await countAvailableOpks(identityId);
  const room = Math.max(0, MAX_OPK_POOL - free);
  const slice = opks.slice(0, room);
  if (!slice.length) return;
  await db
    .insert(e2eOneTimePrekeys)
    .values(slice.map((o) => ({ identity_id: identityId, opk_id: o.opkId, opk_pub: o.opkPub })))
    .onConflictDoNothing();
}

/** Nombre d'OPK non consommées restantes. */
export async function countAvailableOpks(identityId: number): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(e2eOneTimePrekeys)
    .where(and(eq(e2eOneTimePrekeys.identity_id, identityId), eq(e2eOneTimePrekeys.consumed, 0)));
  return rows.at(0)?.n ?? 0;
}

export interface PrekeyBundle {
  ik: string; // clé publique d'identité (identities.pubkey)
  spkPub: string;
  spkId: number;
  spkSig: string;
  opkPub: string | null; // OPK consommée pour ce handshake (null si pool vide)
  opkId: number | null;
}

/**
 * Récupère le bundle de prekeys d'une identité en CONSOMMANT une OPK de façon
 * atomique (une seule requête UPDATE … RETURNING) pour éviter qu'un même OPK soit
 * remis à deux initiateurs. Renvoie null si l'identité n'a pas (encore) de SPK.
 */
export async function fetchPrekeyBundle(identityId: number): Promise<PrekeyBundle | null> {
  const spkRows = await db
    .select({ spk_pub: e2ePrekeys.spk_pub, spk_id: e2ePrekeys.spk_id, spk_sig: e2ePrekeys.spk_sig })
    .from(e2ePrekeys)
    .where(eq(e2ePrekeys.identity_id, identityId))
    .limit(1);
  const spk = spkRows.at(0);
  if (!spk) return null;
  const ident = await getIdentityById(identityId);
  if (!ident?.pubkey) return null;

  // Consommation atomique d'une OPK libre (PGlite & Postgres : sous-requête + RETURNING).
  // `ORDER BY id DESC` : on sert la PLUS RÉCENTE d'abord. La génération courante du
  // client (celle dont il détient les clés privées) est toujours la dernière publiée,
  // donc la plus haute `id`. Servir d'anciennes OPK encore présentes (pré-purge SPK)
  // donnerait un DH4 incohérent → « message illisible ».
  const consumed = await db.execute(sql`
    UPDATE e2e_one_time_prekeys SET consumed = 1
     WHERE id = (
       SELECT id FROM e2e_one_time_prekeys
        WHERE identity_id = ${identityId} AND consumed = 0
        ORDER BY id DESC LIMIT 1
     )
     RETURNING opk_id, opk_pub
  `);
  const opk = consumed.rows.at(0) as { opk_id: number; opk_pub: string } | undefined;

  return {
    ik: ident.pubkey,
    spkPub: spk.spk_pub,
    spkId: spk.spk_id,
    spkSig: spk.spk_sig,
    opkPub: opk?.opk_pub ?? null,
    opkId: opk?.opk_id ?? null,
  };
}

