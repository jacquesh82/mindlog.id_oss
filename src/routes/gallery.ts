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
} from "../db.js";
import { getIdentityByHandle } from "../store.js";
import { currentIdentity } from "./_ctx.js";
import { ALLOWED, DATA_DIR } from "./identity.js";

const route = new Hono();

route.get("/api/gallery/:handle", async (c) => {
  const id = await getIdentityByHandle(c.req.param("handle"));
  if (!id) return c.json({ error: "not found" }, 404);
  const viewer = await currentIdentity(c);
  const fingerprint = c.req.header("x-fingerprint") ?? "";
  const photos = await Promise.all(
    (await getGallery(id.id)).map(async (p) => ({
      ...p,
      url: `/api/gallery/photo/${p.id}`,
      liked: fingerprint ? await hasGalleryLike(p.id, fingerprint) : false,
      mine: viewer?.id === id.id,
    }))
  );
  return c.json({ photos });
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
