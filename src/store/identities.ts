// Domaine « identities » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq, sql } from "drizzle-orm";
import { BASE_FIELDS, RESERVED_HANDLES, db, newAccessKey } from "../db.js";
import {
  cardFields,
  identities,
} from "../schema.js";
import { Identity } from "./shared.js";
import { setRecoveryEmail } from "./notifications.js";
import { upsertField } from "./cardFields.js";
import { addTag } from "./tags.js";

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
  limit = 12,
  opts: { includeTags?: boolean } = {}
): Promise<{ handle: string; display_name: string; title: string; has_photo: boolean }[]> {
  const raw = q.trim();
  // Email = saisie COMPLÈTE uniquement (pas d'autocomplétion / dump partiel).
  // Match exact (lowercased) sur recovery_email + card_field public 'email'.
  // Quand on est en mode email, on désactive la recherche partielle pour ne pas
  // laisser fuiter des adresses via un display_name qui en contiendrait une.
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw.toLowerCase() : null;
  // Handle / display_name / tags : recherche partielle (ILIKE %term%). Le `@`
  // initial éventuellement saisi est stripé pour que `@joe` matche `joe123`.
  // Les jokers SQL (%, _) sont neutralisés.
  const partial = raw.replace(/^@+/, "").replace(/[%_]/g, "");
  const term = `%${partial}%`;
  // Filtre annuaire : exclut les comptes Premium qui se sont rendus invisibles
  // (settings.listed_in_directory === false). Le champ settings est JSON, on
  // s'appuie sur l'opérateur jsonb/`::jsonb` pour le filtrage.
  // - Match sur handle, display_name, et optionnellement tags (capability Premium).
  // - ILIKE : insensible à la casse. Les % et _ saisis sont neutralisés ci-dessus.
  //
  // Gating Premium côté owner : un match par TAG ne doit ressortir que si
  // l'identité titulaire est elle-même Premium effective (sinon les tags d'un
  // ex-trial expiré continueraient de remonter dans la recherche). Le test
  // duplique inline la logique de `subscriptionIsPremium` (cf.
  // src/premium/store/subscriptions.ts) — 3 j de grâce, statut actif/trial/past_due,
  // current_period_end null toléré sauf en past_due. Comparaison ISO 8601 (texte
  // en UTC, ordre lexicographique = ordre temporel).
  const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
  const graceCutoff = new Date(Date.now() - GRACE_MS).toISOString();
  const tagJoin = opts.includeTags && !email
    ? sql`LEFT JOIN tags tg ON tg.identity_id = i.id
          LEFT JOIN subscriptions sub ON sub.identity_id = i.id`
    : sql``;
  const tagWhere = opts.includeTags && !email
    ? sql`OR (tg.tag ILIKE ${term}
            AND sub.identity_id IS NOT NULL
            AND sub.status IN ('active','trialing','past_due')
            AND (
              (sub.current_period_end IS NULL AND sub.status <> 'past_due')
              OR sub.current_period_end >= ${graceCutoff}
            ))`
    : sql``;
  const emailJoin = email
    ? sql`LEFT JOIN card_fields em ON em.identity_id = i.id AND em.key = 'email'`
    : sql``;
  // En mode email : UNIQUEMENT match exact. En mode partiel : handle + display_name.
  const matchWhere = email
    ? sql`(lower(i.recovery_email) = ${email} OR lower(em.value) = ${email})`
    : sql`(i.handle ILIKE ${term} OR dn.value ILIKE ${term} ${tagWhere})`;
  const res = await db.execute(sql`
    SELECT DISTINCT i.handle, i.photo_file,
           COALESCE(dn.value, '') AS display_name,
           COALESCE(t.value, '')  AS title
      FROM identities i
      LEFT JOIN card_fields dn ON dn.identity_id = i.id AND dn.key = 'display_name'
      LEFT JOIN card_fields t  ON t.identity_id  = i.id AND t.key  = 'title'
      ${tagJoin}
      ${emailJoin}
     WHERE ${matchWhere}
       -- Match littéral du flag dans le JSON brut : robuste si settings invalide.
       -- Le défaut (true) reste donc affiché tant que l'utilisateur n'a pas coché « hors annuaire ».
       AND COALESCE(i.settings, '') NOT ILIKE '%"listed_in_directory":false%'
     ORDER BY i.handle
     LIMIT ${limit}
  `);
  return (res.rows as { handle: string; photo_file: string | null; display_name: string; title: string }[]).map(
    (r) => ({ handle: r.handle, display_name: r.display_name, title: r.title, has_photo: !!r.photo_file })
  );
}

// Profil mascotte public @milo (easter egg), créé une seule fois.
export const MILO_BIO =
  "Caméléon des forêts tropicales de Madagascar. Je change de couleur selon mes humeurs et mes rencontres — ici, selon tes préférences d'interface. Cliquez sur ma palette pour changer l'accent de l'app. Mascotte officielle de mindlog · id.";
export const MILO_EMAIL = "milo@mindlog.today";
export async function ensureMilo(): Promise<void> {
  const existing = await getIdentityByHandle("milo");
  const miloBio = { key: "bio", label: "À propos", value: MILO_BIO };
  if (existing) {
    await upsertField(existing.id, miloBio);
    await upsertField(existing.id, { key: "email", value: MILO_EMAIL });
    await setRecoveryEmail(existing.id, MILO_EMAIL);
    return;
  }
  const id = await createIdentity("milo", "Milo", MILO_EMAIL);
  await upsertField(id.id, { key: "display_name", label: "Nom", value: "Milo" });
  await upsertField(id.id, { key: "title", label: "Rôle", value: "Mascotte officielle" });
  await upsertField(id.id, miloBio);
  await upsertField(id.id, { key: "email", value: MILO_EMAIL });
  await upsertField(id.id, { key: "website", label: "Site", value: "https://id.mindlog.today" });
  await upsertField(id.id, { key: "location", label: "Lieu", value: "Forêt tropicale, Madagascar" });
  await upsertField(id.id, { key: "company", label: "Projet", value: "mindlog · id" });
  for (const tag of ["caméléon", "nature", "photographie", "open-source", "mindlog"]) {
    await addTag(id.id, tag).catch(() => {});
  }
}

