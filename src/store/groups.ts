// Domaine « groups » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  groupEvents,
  groupMembers,
  groups as groupsTable,
  identities,
  notifications,
  relations as relationsTable,
  requests,
} from "../schema.js";
import { Identity } from "./shared.js";
import { StoreError, createIdentity, generateUniqueHandle, getIdentityByEmail, getIdentityByHandle, getIdentityById } from "./identities.js";
import { BookingRequest } from "./requests.js";
import { RelationSummary, RelationType, addRelation, summariesByIds } from "./relations.js";

/* ---- Groupes (Option M : appartenance persistée, messages éphémères) ---- */
//
// Rôles :
//   - owner  : créateur, unique. Promote/demote admin, transfert, suppression.
//   - admin  : ajoute/retire membres.
//   - member : envoie + quitte.
// Toute action de membership est journalisée dans `group_events` (audit).

export const MAX_GROUP_MEMBERS = 128;
export type GroupRole = "owner" | "admin" | "member";
export interface GroupMemberInfo { handle: string; role: GroupRole }
export interface GroupEventInfo {
  id: number;
  kind: string;
  actor: string;
  target: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}
export interface GroupInfo {
  id: string;
  name: string;
  members: GroupMemberInfo[];
  role: GroupRole;
  owner: string;
  events?: GroupEventInfo[];
}

async function logGroupEvent(
  gid: string,
  kind: string,
  actorId: number,
  targetId: number | null,
  payload: Record<string, unknown> | null = null
): Promise<void> {
  await db.insert(groupEvents).values({
    group_id: gid,
    kind,
    actor_id: actorId,
    target_id: targetId ?? undefined,
    payload: payload ? JSON.stringify(payload) : "",
    created_at: new Date().toISOString(),
  });
}

async function recentGroupEvents(gid: string, limit = 50): Promise<GroupEventInfo[]> {
  const rows = await db
    .select({
      id: groupEvents.id,
      kind: groupEvents.kind,
      actor_id: groupEvents.actor_id,
      target_id: groupEvents.target_id,
      payload: groupEvents.payload,
      created_at: groupEvents.created_at,
    })
    .from(groupEvents)
    .where(eq(groupEvents.group_id, gid))
    .orderBy(desc(groupEvents.created_at))
    .limit(limit);
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.flatMap((r) => [r.actor_id, r.target_id].filter((x): x is number => !!x))));
  const idMap = new Map<number, string>();
  if (ids.length) {
    const ih = await db
      .select({ id: identities.id, handle: identities.handle })
      .from(identities)
      .where(inArray(identities.id, ids));
    for (const r of ih) idMap.set(r.id, r.handle);
  }
  return rows
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      actor: idMap.get(r.actor_id) ?? "?",
      target: r.target_id ? (idMap.get(r.target_id) ?? null) : null,
      payload: r.payload ? safeJson(r.payload) : null,
      created_at: r.created_at,
    }))
    .reverse(); // chronologique pour l'affichage
}
const safeJson = (s: string): Record<string, unknown> | null => {
  try { const v = JSON.parse(s); return v && typeof v === "object" ? v : null; } catch { return null; }
};

export async function memberRole(gid: string, id: number): Promise<GroupRole | null> {
  const r = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, id)))
    .limit(1);
  return (r.at(0)?.role as GroupRole | undefined) ?? null;
}
export const isGroupMember = async (gid: string, id: number) => (await memberRole(gid, id)) !== null;
/** Vrai si l'identité a au moins le rôle admin (admin OU owner). */
export async function isGroupAdmin(gid: string, id: number): Promise<boolean> {
  const r = await memberRole(gid, id);
  return r === "admin" || r === "owner";
}

/** Handles + rôles des membres d'un groupe. */
export async function groupMembersInfo(gid: string): Promise<GroupMemberInfo[]> {
  const rows = await db
    .select({ handle: identities.handle, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(identities, eq(identities.id, groupMembers.identity_id))
    .where(eq(groupMembers.group_id, gid));
  return rows.map((r) => ({ handle: r.handle, role: r.role as GroupRole }));
}
/** Ids des membres (pour fan-out SSE / notifications). */
export async function groupMemberIds(gid: string): Promise<number[]> {
  const rows = await db.select({ id: groupMembers.identity_id }).from(groupMembers).where(eq(groupMembers.group_id, gid));
  return rows.map((r) => r.id);
}

async function ownerHandle(gid: string): Promise<string> {
  const rows = await db
    .select({ handle: identities.handle })
    .from(groupsTable)
    .innerJoin(identities, eq(identities.id, groupsTable.owner_id))
    .where(eq(groupsTable.id, gid))
    .limit(1);
  return rows.at(0)?.handle ?? "";
}

/** Détail d'un groupe si `meId` en est membre, sinon null. */
export async function getGroup(meId: number, gid: string): Promise<GroupInfo | null> {
  const role = await memberRole(gid, meId);
  if (!role) return null;
  const g = await db.select({ name: groupsTable.name }).from(groupsTable).where(eq(groupsTable.id, gid)).limit(1);
  if (!g.length) return null;
  return {
    id: gid,
    name: g[0].name,
    members: await groupMembersInfo(gid),
    role,
    owner: await ownerHandle(gid),
    events: await recentGroupEvents(gid),
  };
}

/** Groupes dont `meId` est membre. */
export async function listGroups(meId: number): Promise<GroupInfo[]> {
  const mine = await db
    .select({ gid: groupMembers.group_id, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.identity_id, meId));
  const out: GroupInfo[] = [];
  for (const m of mine) {
    const g = await db.select({ name: groupsTable.name }).from(groupsTable).where(eq(groupsTable.id, m.gid)).limit(1);
    if (g.length) {
      out.push({
        id: m.gid,
        name: g[0].name,
        members: await groupMembersInfo(m.gid),
        role: m.role as GroupRole,
        owner: await ownerHandle(m.gid),
      });
    }
  }
  return out;
}

/** Crée un groupe ; les membres doivent être des contacts réciproques de l'owner. */
export async function createGroup(ownerId: number, name: string, memberHandles: string[]): Promise<GroupInfo> {
  const ids: number[] = [];
  for (const h of memberHandles) {
    const o = await getIdentityByHandle(h.replace(/^@/, ""));
    if (!o) throw new StoreError(404, `Contact introuvable : ${h}`);
    if (o.id === ownerId) continue;
    if (!(await areContacts(ownerId, o.id))) throw new StoreError(400, `@${o.handle} n'est pas un contact réciproque.`);
    if (!ids.includes(o.id)) ids.push(o.id);
  }
  if (ids.length + 1 > MAX_GROUP_MEMBERS) throw new StoreError(400, "Groupe trop grand.");
  const id = randomUUID();
  const now = new Date().toISOString();
  const gname = name.slice(0, 80);
  await db.insert(groupsTable).values({ id, name: gname, owner_id: ownerId, created_at: now });
  await db.insert(groupMembers).values([
    { group_id: id, identity_id: ownerId, role: "owner", joined_at: now },
    ...ids.map((i) => ({ group_id: id, identity_id: i, role: "member" as const, joined_at: now })),
  ]);
  await logGroupEvent(id, "create", ownerId, null, gname ? { name: gname } : null);
  for (const i of ids) await logGroupEvent(id, "join", ownerId, i);
  return { id, name: gname, members: await groupMembersInfo(id), role: "owner", owner: (await getIdentityById(ownerId))?.handle ?? "" };
}

/** Ajoute un membre (admin/owner uniquement ; contact réciproque de l'actor). */
export async function addGroupMember(actorId: number, gid: string, handle: string): Promise<void> {
  if (!(await isGroupAdmin(gid, actorId))) throw new StoreError(403, "Réservé aux administrateurs.");
  const o = await getIdentityByHandle(handle.replace(/^@/, ""));
  if (!o) throw new StoreError(404, "Contact introuvable.");
  if (!(await areContacts(actorId, o.id))) throw new StoreError(400, "Pas un contact réciproque.");
  const count = (await groupMemberIds(gid)).length;
  if (count + 1 > MAX_GROUP_MEMBERS) throw new StoreError(400, "Groupe trop grand.");
  const r = await db
    .insert(groupMembers)
    .values({ group_id: gid, identity_id: o.id, role: "member", joined_at: new Date().toISOString() })
    .onConflictDoNothing()
    .returning({ id: groupMembers.identity_id });
  if (r.length) await logGroupEvent(gid, "join", actorId, o.id);
}

/** Retire un membre (admin/owner ; impossible de retirer l'owner ; pas soi-même). */
export async function removeGroupMember(actorId: number, gid: string, handle: string): Promise<boolean> {
  if (!(await isGroupAdmin(gid, actorId))) throw new StoreError(403, "Réservé aux administrateurs.");
  const o = await getIdentityByHandle(handle.replace(/^@/, ""));
  if (!o || o.id === actorId) return false;
  const targetRole = await memberRole(gid, o.id);
  if (targetRole === "owner") throw new StoreError(400, "L'owner ne peut pas être retiré.");
  const r = await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, o.id)))
    .returning({ id: groupMembers.identity_id });
  if (r.length) await logGroupEvent(gid, "kick", actorId, o.id);
  return r.length > 0;
}

/** Quitte un groupe. L'owner doit transférer d'abord. Si plus aucun membre, suppression. */
export async function leaveGroup(meId: number, gid: string): Promise<boolean> {
  const role = await memberRole(gid, meId);
  if (!role) return false;
  if (role === "owner") {
    // Tolérance : si l'owner est seul, on autorise la dissolution.
    const others = (await groupMemberIds(gid)).filter((i) => i !== meId);
    if (others.length) throw new StoreError(400, "Transférez la propriété avant de quitter.");
  }
  const r = await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, meId)))
    .returning({ id: groupMembers.identity_id });
  if (r.length) await logGroupEvent(gid, "leave", meId, null);
  if (!(await groupMemberIds(gid)).length) await db.delete(groupsTable).where(eq(groupsTable.id, gid));
  return r.length > 0;
}

/** Promeut un membre au rang d'admin (owner uniquement). */
export async function promoteGroupMember(ownerId: number, gid: string, handle: string): Promise<void> {
  if ((await memberRole(gid, ownerId)) !== "owner") throw new StoreError(403, "Réservé à l'owner.");
  const o = await getIdentityByHandle(handle.replace(/^@/, ""));
  if (!o) throw new StoreError(404, "Contact introuvable.");
  const role = await memberRole(gid, o.id);
  if (role !== "member") throw new StoreError(400, "Pas un membre simple.");
  await db
    .update(groupMembers)
    .set({ role: "admin" })
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, o.id)));
  await logGroupEvent(gid, "promote", ownerId, o.id);
}

/** Rétrograde un admin en membre simple (owner uniquement). */
export async function demoteGroupMember(ownerId: number, gid: string, handle: string): Promise<void> {
  if ((await memberRole(gid, ownerId)) !== "owner") throw new StoreError(403, "Réservé à l'owner.");
  const o = await getIdentityByHandle(handle.replace(/^@/, ""));
  if (!o) throw new StoreError(404, "Contact introuvable.");
  const role = await memberRole(gid, o.id);
  if (role !== "admin") throw new StoreError(400, "Pas un administrateur.");
  await db
    .update(groupMembers)
    .set({ role: "member" })
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, o.id)));
  await logGroupEvent(gid, "demote", ownerId, o.id);
}

/** Transfère la propriété (owner uniquement). L'ancien owner devient admin. */
export async function transferGroupOwnership(ownerId: number, gid: string, handle: string): Promise<void> {
  if ((await memberRole(gid, ownerId)) !== "owner") throw new StoreError(403, "Réservé à l'owner.");
  const o = await getIdentityByHandle(handle.replace(/^@/, ""));
  if (!o || o.id === ownerId) throw new StoreError(400, "Cible invalide.");
  if (!(await isGroupMember(gid, o.id))) throw new StoreError(400, "Pas un membre.");
  await db
    .update(groupMembers)
    .set({ role: "admin" })
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, ownerId)));
  await db
    .update(groupMembers)
    .set({ role: "owner" })
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, o.id)));
  await db.update(groupsTable).set({ owner_id: o.id }).where(eq(groupsTable.id, gid));
  await logGroupEvent(gid, "transfer", ownerId, o.id);
}

/** Renomme un groupe (admin/owner). */
export async function renameGroup(actorId: number, gid: string, name: string): Promise<void> {
  if (!(await isGroupAdmin(gid, actorId))) throw new StoreError(403, "Réservé aux administrateurs.");
  const trimmed = name.slice(0, 80);
  const prev = await db.select({ name: groupsTable.name }).from(groupsTable).where(eq(groupsTable.id, gid)).limit(1);
  if (!prev.length) throw new StoreError(404, "Groupe introuvable.");
  await db.update(groupsTable).set({ name: trimmed }).where(eq(groupsTable.id, gid));
  await logGroupEvent(gid, "rename", actorId, null, { oldName: prev[0].name, newName: trimmed });
}

export async function removeRelation(identityId: number, relatedHandle: string): Promise<boolean> {
  const other = await getIdentityByHandle(relatedHandle.replace(/^@/, ""));
  if (!other) return false;
  const r = await db
    .delete(relationsTable)
    .where(and(eq(relationsTable.identity_id, identityId), eq(relationsTable.related_id, other.id)))
    .returning({ id: relationsTable.identity_id });
  return r.length > 0;
}

/** Graphe non-orienté ; renvoie les relations groupées par degré (1 à maxDegree). */
export async function getRelationsByDegree(
  identityId: number,
  maxDegree = 3
): Promise<Record<number, RelationSummary[]>> {
  const edges = (await db
    .select({
      identity_id: relationsTable.identity_id,
      related_id: relationsTable.related_id,
      type: relationsTable.type,
      created_at: relationsTable.created_at,
    })
    .from(relationsTable)) as {
    identity_id: number;
    related_id: number;
    type: RelationType;
    created_at: string;
  }[];
  const incomingSet = new Set(edges.filter((e) => e.related_id === identityId).map((e) => e.identity_id));
  const adj = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    let set = adj.get(a);
    if (!set) {
      set = new Set();
      adj.set(a, set);
    }
    set.add(b);
  };
  for (const e of edges) {
    link(e.identity_id, e.related_id);
    link(e.related_id, e.identity_id);
  }

  const result: Record<number, RelationSummary[]> = {};

  const direct = edges.filter((e) => e.identity_id === identityId);
  const directIds = direct.map((e) => e.related_id);
  const directType = new Map(direct.map((e) => [e.related_id, e.type]));
  const directCreated = new Map(direct.map((e) => [e.related_id, e.created_at]));
  const dSums = await summariesByIds(directIds);
  const handleById = new Map<number, string>();
  for (const [id, s] of dSums) handleById.set(id, s.handle);
  result[1] = directIds
    .map((id) => {
      const s = dSums.get(id);
      return s
        ? { ...s, type: directType.get(id) ?? "amis", created_at: directCreated.get(id) ?? "", mutual: incomingSet.has(id) }
        : null;
    })
    .filter(Boolean) as RelationSummary[];

  const visited = new Set<number>([identityId, ...directIds]);
  let frontier = directIds;
  for (let degree = 2; degree <= maxDegree; degree++) {
    const next: number[] = [];
    const viaOf = new Map<number, number>();
    for (const node of frontier)
      for (const nb of adj.get(node) ?? [])
        if (!visited.has(nb)) {
          visited.add(nb);
          next.push(nb);
          viaOf.set(nb, node);
        }
    const sums = await summariesByIds(next);
    for (const [id, s] of sums) handleById.set(id, s.handle);
    result[degree] = next
      .map((id) => {
        const s = sums.get(id);
        if (!s) return null;
        const via = viaOf.get(id);
        return { ...s, via: via !== undefined ? handleById.get(via) : undefined };
      })
      .filter(Boolean) as RelationSummary[];
    frontier = next;
    if (!next.length) break;
  }
  for (let d = 1; d <= maxDegree; d++) if (!(d in result)) result[d] = [];
  return result;
}

/** Relations directes (degré 1) pour l'affichage public. */
export async function getDirectRelations(identityId: number): Promise<RelationSummary[]> {
  return (await getRelationsByDegree(identityId, 1))[1];
}

/** Le viewer (aId) a-t-il ajouté bId à ses relations (même sans réciprocité) ? */
export async function hasRelation(aId: number, bId: number): Promise<boolean> {
  if (aId === bId) return false;
  const rows = await db
    .select({ x: relationsTable.identity_id })
    .from(relationsTable)
    .where(and(eq(relationsTable.identity_id, aId), eq(relationsTable.related_id, bId)))
    .limit(1);
  return rows.length > 0;
}

/** Deux identités sont « contacts » si la relation est réciproque (validée des 2 côtés). */
export async function areContacts(aId: number, bId: number): Promise<boolean> {
  if (aId === bId) return false;
  const res = await db.execute(sql`
    SELECT
      EXISTS(SELECT 1 FROM relations WHERE identity_id = ${aId} AND related_id = ${bId}) AS ab,
      EXISTS(SELECT 1 FROM relations WHERE identity_id = ${bId} AND related_id = ${aId}) AS ba
  `);
  const row = res.rows[0] as { ab: boolean; ba: boolean };
  return row.ab && row.ba;
}

export async function setRequestStatus(
  identityId: number,
  id: number,
  status: "pending" | "accepted" | "declined"
): Promise<boolean> {
  const r = await db
    .update(requests)
    .set({ status })
    .where(and(eq(requests.id, id), eq(requests.identity_id, identityId)))
    .returning({ id: requests.id });
  return r.length > 0;
}

export interface AcceptOutcome {
  updated: boolean;
  request?: BookingRequest;
  /** Identité du demandeur (résolue par email ou créée automatiquement). */
  requester?: Identity;
  /** True si le compte du demandeur vient d'être créé pour l'occasion. */
  requesterIsNew?: boolean;
  /** Clé d'accès (lien magique) — uniquement quand requesterIsNew. */
  accessKey?: string;
  /** True si la relation réciproque (contacts) est établie des deux côtés. */
  contacts?: boolean;
}

/**
 * Accepte une demande de RDV : passe le statut à 'accepted', établit le contact
 * réciproque avec le demandeur (les deux sens) et, si le demandeur n'a pas encore
 * d'identité, lui en crée une automatiquement (auto-inscription par email).
 */
export async function acceptRequest(accepterId: number, id: number): Promise<AcceptOutcome> {
  const rows = (await db
    .select()
    .from(requests)
    .where(and(eq(requests.id, id), eq(requests.identity_id, accepterId)))
    .limit(1)) as BookingRequest[];
  const request = rows.at(0);
  if (!request) return { updated: false };

  await db.update(requests).set({ status: "accepted" }).where(eq(requests.id, id));
  request.status = "accepted";

  const accepter = await getIdentityById(accepterId);
  const email = request.email.trim();
  if (!accepter || !email) return { updated: true, request };

  // Résout le demandeur par email, ou crée son identité à la volée.
  let requester = await getIdentityByEmail(email);
  let requesterIsNew = false;
  if (!requester) {
    const handle = await generateUniqueHandle(request.name || email);
    requester = await createIdentity(handle, request.name || undefined, email);
    requesterIsNew = true;
  }
  if (requester.id === accepterId) return { updated: true, request };

  // Contact réciproque : on ajoute la relation dans les deux sens.
  await addRelation(accepterId, requester.handle);
  await addRelation(requester.id, accepter.handle);

  return {
    updated: true,
    request,
    requester,
    requesterIsNew,
    accessKey: requesterIsNew ? requester.access_key : undefined,
    contacts: await areContacts(accepterId, requester.id),
  };
}

export async function deleteRequest(identityId: number, id: number): Promise<boolean> {
  const r = await db
    .delete(requests)
    .where(and(eq(requests.id, id), eq(requests.identity_id, identityId)))
    .returning({ id: requests.id });
  return r.length > 0;
}

