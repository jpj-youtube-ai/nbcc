import { randomUUID } from "node:crypto";
import { pool } from "./pool";

// Uploaded newsletter images (TASK-168/REQ-069). Stored in Postgres and served publicly by
// GET /media/newsletter/:id. Pure validation (mime/size) lives in ../newsletter/image-validation
// so it can be unit-tested without importing this DB module (golden rule 5); re-exported here so
// existing/future importers of this module keep working unchanged.
export { MAX_IMAGE_BYTES, ALLOWED_IMAGE_MIME, validateUpload } from "../newsletter/image-validation";

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
