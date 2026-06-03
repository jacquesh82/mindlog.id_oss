import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { extname, resolve } from "node:path";
import {
  getGallery,
  countGallery,
  addGalleryPhoto,
  deleteGalleryPhoto,
  toggleGalleryLike,
  hasGalleryLike,
  getGalleryPhotoFile,
  getOwnedGalleryPhotoFile,
  setGalleryFilename,
  galleryPhotoExists,
  setGalleryLink,
} from "../db.js";
import { getIdentityByHandle } from "../store.js";
import { isPremium, sanitizeButtonUrl } from "../premium-api.js";
import { currentIdentity, readBody } from "./_ctx.js";
import { ALLOWED, DATA_DIR } from "./identity.js";

const route = new Hono();

route.get("/api/gallery/:handle", async (c) => {
  const id = await getIdentityByHandle(c.req.param("handle"));
  if (!id) return c.json({ error: "not found" }, 404);
  const viewer = await currentIdentity(c);
  const fingerprint = c.req.header("x-fingerprint") ?? "";
  const mine = viewer?.id === id.id;
  // Lien cliquable (Premium P6) : exposé au public seulement si le titulaire est
  // Premium ; toujours visible pour le propriétaire (édition).
  const premium = await isPremium(id.id);
  const photos = await Promise.all(
    (await getGallery(id.id)).map(async (p) => ({
      ...p,
      link_url: premium || mine ? p.link_url : "",
      url: `/api/gallery/photo/${p.id}`,
      liked: fingerprint ? await hasGalleryLike(p.id, fingerprint) : false,
      mine,
    }))
  );
  return c.json({ photos });
});

// Définit/efface le lien cliquable d'une photo (Premium requis).
route.patch("/api/gallery/:id/link", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  if (!(await isPremium(id.id))) return c.json({ error: "premium required" }, 402);
  const { link_url } = await readBody<{ link_url: string }>(c);
  const raw = typeof link_url === "string" ? link_url.trim() : "";
  const url = raw ? sanitizeButtonUrl(raw) : ""; // "" = effacer le lien
  if (url === null) return c.json({ error: "URL invalide" }, 400);
  const ok = await setGalleryLink(Number(c.req.param("id")), id.id, url);
  return ok ? c.json({ ok: true, link_url: url }) : c.json({ error: "not found" }, 404);
});

route.get("/api/gallery/photo/:id", async (c) => {
  const photoId = Number(c.req.param("id"));
  const filename = await getGalleryPhotoFile(photoId);
  if (!filename) return c.json({ error: "not found" }, 404);
  const p = resolve(DATA_DIR, filename);
  if (!existsSync(p)) return c.json({ error: "not found" }, 404);
  const mime = [...ALLOWED.entries()].find(([, e]) => e === extname(p))?.[0] ?? "application/octet-stream";
  c.header("Content-Type", mime);
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(readFileSync(p));
});

route.post("/api/gallery", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  if ((await countGallery(id.id)) >= 10) return c.json({ error: "max 10 photos" }, 400);
  const body = await c.req.parseBody({ all: true });
  const files = [body.photos].flat().filter((f) => f instanceof File);
  if (!files.length) return c.json({ error: "no files" }, 400);
  const results = [];
  for (const file of files) {
    if ((await countGallery(id.id)) >= 10) break;
    const ext = ALLOWED.get(file.type);
    if (!ext) continue;
    if (file.size > 5 * 1024 * 1024) continue;
    const photoId = await addGalleryPhoto(id.id, ""); // placeholder
    const name = `gallery-${id.id}-${photoId}${ext}`;
    writeFileSync(resolve(DATA_DIR, name), Buffer.from(await file.arrayBuffer()));
    await setGalleryFilename(photoId, name);
    results.push({ id: photoId, url: `/api/gallery/photo/${photoId}`, likes: 0, liked: false, mine: true });
  }
  return c.json({ photos: results });
});

route.delete("/api/gallery/:id", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const photoId = Number(c.req.param("id"));
  const filename = await getOwnedGalleryPhotoFile(photoId, id.id);
  if (!filename) return c.json({ error: "not found" }, 404);
  await deleteGalleryPhoto(id.id, photoId);
  try { rmSync(resolve(DATA_DIR, filename)); } catch { /* ignoré */ }
  return c.json({ ok: true });
});

route.post("/api/gallery/:id/like", async (c) => {
  const photoId = Number(c.req.param("id"));
  if (!(await galleryPhotoExists(photoId))) return c.json({ error: "not found" }, 404);
  const { fingerprint } = await c.req.json<{ fingerprint: string }>();
  if (!fingerprint || fingerprint.length > 64) return c.json({ error: "fingerprint required" }, 400);
  const result = await toggleGalleryLike(photoId, fingerprint);
  return c.json(result);
});

export default route;
