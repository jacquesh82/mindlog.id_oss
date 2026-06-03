// Domaine « identities » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, desc, eq, sql } from "drizzle-orm";
import { BASE_FIELDS, RESERVED_HANDLES, db, newAccessKey } from "../db.js";
import {
  cardFields,
  identities,
} from "../schema.js";
import { Identity } from "./shared.js";
import { setRecoveryEmail } from "./notifications.js";
import { upsertField } from "./cardFields.js";

/* ------------------------------- Identities ------------------------------ */

export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/;

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_-]/g, "-");
}

export class StoreError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getIdentityByHandle(handle: string): Promise<Identity | undefined> {
  const rows = await db.select().from(identities).where(eq(identities.handle, handle.toLowerCase())).limit(1);
  return rows[0];
}

export async function getIdentityById(id: number): Promise<Identity | undefined> {
  const rows = await db.select().from(identities).where(eq(identities.id, id)).limit(1);
  return rows[0];
}

export async function getIdentityByKey(key: string | null | undefined): Promise<Identity | undefined> {
  if (!key) return undefined;
  const rows = await db.select().from(identities).where(eq(identities.access_key, key)).limit(1);
  return rows[0];
}

export async function getIdentityByEmail(email: string | null | undefined): Promise<Identity | undefined> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return undefined;
  const rows = await db
    .select()
    .from(identities)
    .where(sql`lower(${identities.recovery_email}) = ${e}`)
    .limit(1);
  return rows[0];
}

/** Dérive un handle valide et unique à partir d'un email/nom (auto-inscription). */
export async function generateUniqueHandle(seed: string): Promise<string> {
  let base = normalizeHandle((seed.split("@")[0] || seed).trim())
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 28);
  if (base.length < 2 || !/^[a-z0-9]/.test(base)) base = `id-${base}`.slice(0, 28);
  base = base.replace(/^[-_]+|[-_]+$/g, "") || "id";
  let candidate = base;
  for (let n = 2; (await getIdentityByHandle(candidate)) || RESERVED_HANDLES.has(candidate); n++)
    candidate = `${base}-${n}`.slice(0, 30);
  return candidate;
}

export async function createIdentity(
  handleRaw: string,
  displayName?: string,
  email?: string
): Promise<Identity> {
  const handle = normalizeHandle(handleRaw);
  if (!HANDLE_RE.test(handle))
    throw new StoreError(400, "Handle invalide (2-30 caractères : a-z, 0-9, - ou _).");
  if (RESERVED_HANDLES.has(handle)) throw new StoreError(409, "Ce handle est réservé.");
  if (await getIdentityByHandle(handle)) throw new StoreError(409, "Ce handle est déjà pris.");

  const accessKey = newAccessKey();
  return db.transaction(async (tx) => {
    const ins = await tx
      .insert(identities)
      .values({ handle, access_key: accessKey, recovery_email: (email ?? "").trim() })
      .returning();
    const id = ins[0].id;

    await tx.insert(cardFields).values(
      BASE_FIELDS.map(([key, label, pub], i) => ({
        identity_id: id,
        key,
        label,
        value: "",
        is_custom: 0,
        is_public: pub,
        visibility: pub ? "public" : "private",
        position: i,
      }))
    );
    if (displayName)
      await tx
        .update(cardFields)
        .set({ value: displayName.trim() })
        .where(and(eq(cardFields.identity_id, id), eq(cardFields.key, "display_name")));

    return ins[0];
  });
}

export async function searchIdentities(
  q: string,
  limit = 12
): Promise<{ handle: string; display_name: string; title: string; has_photo: boolean }[]> {
  const term = `%${q.trim().replace(/[%_]/g, "")}%`;
  // ILIKE : recherche insensible à la casse (comme le LIKE par défaut de SQLite).
  const res = await db.execute(sql`
    SELECT i.handle, i.photo_file,
           COALESCE(dn.value, '') AS display_name,
           COALESCE(t.value, '')  AS title
      FROM identities i
      LEFT JOIN card_fields dn ON dn.identity_id = i.id AND dn.key = 'display_name'
      LEFT JOIN card_fields t  ON t.identity_id  = i.id AND t.key  = 'title'
     WHERE i.handle ILIKE ${term} OR dn.value ILIKE ${term}
     ORDER BY i.handle
     LIMIT ${limit}
  `);
  return (res.rows as { handle: string; photo_file: string | null; display_name: string; title: string }[]).map(
    (r) => ({ handle: r.handle, display_name: r.display_name, title: r.title, has_photo: !!r.photo_file })
  );
}

export async function listIdentities(): Promise<{ handle: string; created_at: string }[]> {
  return db
    .select({ handle: identities.handle, created_at: identities.created_at })
    .from(identities)
    .orderBy(desc(identities.created_at));
}

// Profil mascotte public @milo (easter egg), créé une seule fois.
export const MILO_BIO =
  "Je m'adapte à toutes les couleurs. Mascotte officielle de mindlog · id — clique-moi pour changer de couleur !";
export const MILO_EMAIL = "milo@mindlog.today";
export async function ensureMilo(): Promise<void> {
  const existing = await getIdentityByHandle("milo");
  if (existing) {
    await upsertField(existing.id, { key: "bio", value: MILO_BIO });
    await upsertField(existing.id, { key: "email", value: MILO_EMAIL });
    await setRecoveryEmail(existing.id, MILO_EMAIL);
    return;
  }
  const id = await createIdentity("milo", "Milo", MILO_EMAIL);
  await upsertField(id.id, { key: "title", value: "Mascotte caméléon 🦎" });
  await upsertField(id.id, { key: "bio", value: MILO_BIO });
  await upsertField(id.id, { key: "email", value: MILO_EMAIL });
  await upsertField(id.id, { key: "website", value: "https://id.mindlog.today" });
  await upsertField(id.id, { key: "location", value: "Quelque part sur une branche" });
}

