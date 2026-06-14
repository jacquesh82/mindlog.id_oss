// Domaine « eventInvites » — invitations RSVP à un événement.
// Jointure virtuelle : l'événement reste celui de l'organisateur ; l'invité le voit
// en lecture seule dans son agenda une fois `accepted` (pas de copie → édition et
// suppression de l'organisateur se propagent, le ON DELETE cascade nettoie).
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { eventInvites, events as eventsTable } from "../schema.js";
import { CardEvent } from "./verifications.js";
import { StoreError, getIdentityByHandle } from "./identities.js";
import { type Identity } from "./shared.js";
import { hasRelation } from "./groups.js";

export type InviteStatus = "pending" | "accepted" | "declined";

export interface EventInviteRow {
  handle: string;
  display_name: string;
  has_photo: boolean;
  status: InviteStatus;
}

export interface MyInvite {
  event: CardEvent;
  organizer_handle: string;
  organizer_name: string;
  created_at: string;
}

/** Charge un événement en exigeant qu'il appartienne à `inviterId` et qu'il soit de
 *  type 'event' (les lives premium ne se gèrent pas par invitation nominative). */
async function requireOwnedEvent(eventId: number, inviterId: number): Promise<CardEvent> {
  const rows = (await db
    .select()
    .from(eventsTable)
    .where(and(eq(eventsTable.id, eventId), eq(eventsTable.identity_id, inviterId)))
    .limit(1)) as CardEvent[];
  const ev = rows.at(0);
  if (!ev) throw new StoreError(404, "Événement introuvable.");
  if (ev.kind === "live") throw new StoreError(400, "Les lives ne se gèrent pas par invitation.");
  return ev;
}

/** Invite un contact (relation sortante de l'organisateur) à un de ses événements.
 *  Idempotent : ré-inviter quelqu'un déjà invité ne crée pas de doublon. */
export async function inviteToEvent(
  eventId: number,
  inviterId: number,
  inviteeHandle: string
): Promise<{ invitee: Identity; status: InviteStatus; created: boolean; event: CardEvent }> {
  const event = await requireOwnedEvent(eventId, inviterId);
  const invitee = await getIdentityByHandle(inviteeHandle.replace(/^@/, ""));
  if (!invitee) throw new StoreError(404, "Aucune identité avec ce handle.");
  if (invitee.id === inviterId) throw new StoreError(400, "Impossible de s'inviter soi-même.");
  // « Toute relation » : l'organisateur doit avoir cette personne en relation (sens sortant).
  if (!(await hasRelation(inviterId, invitee.id)))
    throw new StoreError(403, "Vous devez avoir cette personne dans vos relations pour l'inviter.");
  const ins = await db
    .insert(eventInvites)
    .values({
      event_id: eventId,
      inviter_id: inviterId,
      invitee_id: invitee.id,
      status: "pending",
      created_at: new Date().toISOString(),
    })
    .onConflictDoNothing({ target: [eventInvites.event_id, eventInvites.invitee_id] })
    .returning({ id: eventInvites.id });
  const created = ins.length > 0;
  const cur = (await db
    .select({ status: eventInvites.status })
    .from(eventInvites)
    .where(and(eq(eventInvites.event_id, eventId), eq(eventInvites.invitee_id, invitee.id)))
    .limit(1)) as { status: InviteStatus }[];
  return { invitee, status: cur.at(0)?.status ?? "pending", created, event };
}

/** Retire une invitation (action organisateur). */
export async function removeEventInvite(eventId: number, inviterId: number, inviteeHandle: string): Promise<boolean> {
  const invitee = await getIdentityByHandle(inviteeHandle.replace(/^@/, ""));
  if (!invitee) return false;
  const r = await db
    .delete(eventInvites)
    .where(
      and(
        eq(eventInvites.event_id, eventId),
        eq(eventInvites.inviter_id, inviterId),
        eq(eventInvites.invitee_id, invitee.id)
      )
    )
    .returning({ id: eventInvites.id });
  return r.length > 0;
}

/** Liste les invités d'un événement + leur statut (vue organisateur). */
export async function listEventInvites(eventId: number, inviterId: number): Promise<EventInviteRow[]> {
  await requireOwnedEvent(eventId, inviterId);
  const res = await db.execute(sql`
    SELECT i.handle, i.photo_file, ei.status,
           COALESCE(dn.value, '') AS display_name
      FROM event_invites ei
      JOIN identities i ON i.id = ei.invitee_id
      LEFT JOIN card_fields dn ON dn.identity_id = i.id AND dn.key = 'display_name'
     WHERE ei.event_id = ${eventId} AND ei.inviter_id = ${inviterId}
     ORDER BY ei.created_at ASC
  `);
  return (res.rows as { handle: string; photo_file: string | null; status: InviteStatus; display_name: string }[]).map(
    (r) => ({ handle: r.handle, display_name: r.display_name, has_photo: !!r.photo_file, status: r.status })
  );
}

/** Invitations EN ATTENTE reçues par l'invité (pour l'UI « Accepter / Refuser »). */
export async function listMyInvites(inviteeId: number): Promise<MyInvite[]> {
  const res = await db.execute(sql`
    SELECT e.*, o.handle AS organizer_handle,
           COALESCE(dn.value, '') AS organizer_name, ei.created_at AS invited_at
      FROM event_invites ei
      JOIN events e ON e.id = ei.event_id
      JOIN identities o ON o.id = ei.inviter_id
      LEFT JOIN card_fields dn ON dn.identity_id = o.id AND dn.key = 'display_name'
     WHERE ei.invitee_id = ${inviteeId} AND ei.status = 'pending'
     ORDER BY e.starts_at ASC
  `);
  return (res.rows as unknown as (CardEvent & { organizer_handle: string; organizer_name: string; invited_at: string })[]).map(
    (r) => ({
      event: {
        id: r.id, identity_id: r.identity_id, title: r.title, starts_at: r.starts_at,
        ends_at: r.ends_at, location: r.location, link: r.link, notes: r.notes,
        is_public: r.is_public, kind: r.kind,
      },
      organizer_handle: r.organizer_handle,
      organizer_name: r.organizer_name,
      created_at: r.invited_at,
    })
  );
}

/** Événements ACCEPTÉS par l'invité — fusionnés (lecture seule) dans son agenda. */
export async function getAcceptedInviteEvents(inviteeId: number): Promise<(CardEvent & { invited_by: string })[]> {
  const res = await db.execute(sql`
    SELECT e.*, o.handle AS invited_by
      FROM event_invites ei
      JOIN events e ON e.id = ei.event_id
      JOIN identities o ON o.id = ei.inviter_id
     WHERE ei.invitee_id = ${inviteeId} AND ei.status = 'accepted'
     ORDER BY e.starts_at ASC
  `);
  return (res.rows as unknown as (CardEvent & { invited_by: string })[]).map((r) => ({
    id: r.id, identity_id: r.identity_id, title: r.title, starts_at: r.starts_at,
    ends_at: r.ends_at, location: r.location, link: r.link, notes: r.notes,
    is_public: r.is_public, kind: r.kind, invited_by: r.invited_by,
  }));
}

/** RSVP de l'invité : accepte ou refuse une invitation EN ATTENTE. Renvoie l'organisateur
 *  et l'événement (pour notifier en retour), ou null si rien à mettre à jour. */
export async function respondEventInvite(
  inviteeId: number,
  eventId: number,
  accept: boolean
): Promise<{ organizerId: number; event: CardEvent } | null> {
  const r = await db
    .update(eventInvites)
    .set({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() })
    .where(
      and(
        eq(eventInvites.event_id, eventId),
        eq(eventInvites.invitee_id, inviteeId),
        eq(eventInvites.status, "pending")
      )
    )
    .returning({ inviter_id: eventInvites.inviter_id });
  const row = r.at(0);
  if (!row) return null;
  const ev = (await db.select().from(eventsTable).where(eq(eventsTable.id, eventId)).limit(1)) as CardEvent[];
  if (!ev.length) return null;
  return { organizerId: row.inviter_id, event: ev[0] };
}
