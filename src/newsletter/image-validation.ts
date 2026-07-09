// Uploaded newsletter images (TASK-168/REQ-069). Stored in Postgres and served publicly by
// GET /media/newsletter/:id. Raster-only allow-list (no SVG → served bytes can't carry script);
// 2 MB cap. The id is an app-generated uuid so no DB extension is required.
//
// This module holds only the PURE validation pieces (no DB/config import) so it can be
// unit-tested without a full env (golden rule 5). DB access lives in ../db/newsletter-images.
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
