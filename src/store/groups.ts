// Domaine « groups » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
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

export const MAX_GROUP_MEMBERS = 32;
export interface GroupMemberInfo { handle: string; role: string; }
export interface GroupInfo { id: string; name: string; members: GroupMemberInfo[]; role: string }

export async function memberRole(gid: string, id: number): Promise<string | null> {
  const r = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, id)))
    .limit(1);
  return r.at(0)?.role ?? null;
}
export const isGroupMember = async (gid: string, id: number) => (await memberRole(gid, id)) !== null;

/** Handles + rôles des membres d'un groupe. */
export async function groupMembersInfo(gid: string): Promise<GroupMemberInfo[]> {
  return db
    .select({ handle: identities.handle, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(identities, eq(identities.id, groupMembers.identity_id))
    .where(eq(groupMembers.group_id, gid));
}
/** Ids des membres (pour fan-out SSE / notifications). */
export async function groupMemberIds(gid: string): Promise<number[]> {
  const rows = await db.select({ id: groupMembers.identity_id }).from(groupMembers).where(eq(groupMembers.group_id, gid));
  return rows.map((r) => r.id);
}

/** Détail d'un groupe si `meId` en est membre, sinon null. */
export async function getGroup(meId: number, gid: string): Promise<GroupInfo | null> {
  const role = await memberRole(gid, meId);
  if (!role) return null;
  const g = await db.select({ name: groupsTable.name }).from(groupsTable).where(eq(groupsTable.id, gid)).limit(1);
  if (!g.length) return null;
  return { id: gid, name: g[0].name, members: await groupMembersInfo(gid), role };
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
    if (g.length) out.push({ id: m.gid, name: g[0].name, members: await groupMembersInfo(m.gid), role: m.role });
  }
  return out;
}

/** Crée un groupe ; les membres doivent être des contacts réciproques de l'admin. */
export async function createGroup(adminId: number, name: string, memberHandles: string[]): Promise<GroupInfo> {
  const ids: number[] = [];
  for (const h of memberHandles) {
    const o = await getIdentityByHandle(h.replace(/^@/, ""));
    if (!o) throw new StoreError(404, `Contact introuvable : ${h}`);
    if (o.id === adminId) continue;
    if (!(await areContacts(adminId, o.id))) throw new StoreError(400, `@${o.handle} n'est pas un contact réciproque.`);
    if (!ids.includes(o.id)) ids.push(o.id);
  }
  if (ids.length + 1 > MAX_GROUP_MEMBERS) throw new StoreError(400, "Groupe trop grand.");
  const id = randomUUID();
  const now = new Date().toISOString();
  const gname = name.slice(0, 80);
  await db.insert(groupsTable).values({ id, name: gname, created_at: now });
  await db.insert(groupMembers).values([
    { group_id: id, identity_id: adminId, role: "admin", joined_at: now },
    ...ids.map((i) => ({ group_id: id, identity_id: i, role: "member", joined_at: now })),
  ]);
  return { id, name: gname, members: await groupMembersInfo(id), role: "admin" };
}

/** Ajoute un membre (admin uniquement ; contact réciproque de l'admin). */
export async function addGroupMember(adminId: number, gid: string, handle: string): Promise<void> {
  if ((await memberRole(gid, adminId)) !== "admin") throw new StoreError(403, "Réservé à l'administrateur.");
  const o = await getIdentityByHandle(handle.replace(/^@/, ""));
  if (!o) throw new StoreError(404, "Contact introuvable.");
  if (!(await areContacts(adminId, o.id))) throw new StoreError(400, "Pas un contact réciproque.");
  const count = (await groupMemberIds(gid)).length;
  if (count + 1 > MAX_GROUP_MEMBERS) throw new StoreError(400, "Groupe trop grand.");
  await db
    .insert(groupMembers)
    .values({ group_id: gid, identity_id: o.id, role: "member", joined_at: new Date().toISOString() })
    .onConflictDoNothing();
}

/** Retire un membre (admin uniquement ; pas soi-même — utiliser leaveGroup). */
export async function removeGroupMember(adminId: number, gid: string, handle: string): Promise<boolean> {
  if ((await memberRole(gid, adminId)) !== "admin") throw new StoreError(403, "Réservé à l'administrateur.");
  const o = await getIdentityByHandle(handle.replace(/^@/, ""));
  if (!o || o.id === adminId) return false;
  const r = await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, o.id)))
    .returning({ id: groupMembers.identity_id });
  return r.length > 0;
}

/** Quitte un groupe. Si plus aucun membre, le groupe est supprimé. */
export async function leaveGroup(meId: number, gid: string): Promise<boolean> {
  const r = await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.group_id, gid), eq(groupMembers.identity_id, meId)))
    .returning({ id: groupMembers.identity_id });
  if (!(await groupMemberIds(gid)).length) await db.delete(groupsTable).where(eq(groupsTable.id, gid));
  return r.length > 0;
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

