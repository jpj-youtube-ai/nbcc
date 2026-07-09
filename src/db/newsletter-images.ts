import { randomUUID } from "node:crypto";
import { pool } from "./pool";

// Uploaded newsletter images (TASK-168/REQ-069). Stored in Postgres and served publicly by
// GET /media/newsletter/:id. Raster-only allow-list (no SVG → served bytes can't carry script);
// 2 MB cap. The id is an app-generated uuid so no DB extension is required.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export function validateUpload(
  mime: string,
  byteSize: number,
): { ok: true } | { ok: false; reason: "mime" | "size" } {
  if (!ALLOWED_IMAGE_MIME.includes(mime as (typeof ALLOWED_IMAGE_MIME)[number])) {
    return { ok: false, reason: "mime" };
  }
  if (byteSize <= 0 || byteSize > MAX_IMAGE_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}

export async function insertNewsletterImage(
  mime: string,
  bytes: Buffer,
  uploadedBy: number | null,
): Promise<{ id: string }> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO newsletter_images (id, mime, bytes, byte_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, mime, bytes, bytes.length, uploadedBy],
  );
  return { id };
}

export async function getNewsletterImage(
  id: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const row = (
    await pool.query<{ mime: string; bytes: Buffer }>(
      `SELECT mime, bytes FROM newsletter_images WHERE id = $1`,
      [id],
    )
  ).rows[0];
  return row ?? null;
}
