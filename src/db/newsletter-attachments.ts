import { randomUUID } from "node:crypto";
import { pool } from "./pool";

// Newsletter file attachments (TASK-193). Bytes stored in Postgres, cascade-deleted with the
// newsletter. Pure validation (mime/size) lives in ../newsletter/attachment-validation so it can be
// unit-tested without this DB module (golden rule 5); re-exported here for convenience.
export { MAX_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_MIME, validateAttachment } from "../newsletter/attachment-validation";

export interface AttachmentMeta {
  id: string;
  filename: string;
  mime: string;
  byteSize: number;
}

export interface AttachmentForSend {
  filename: string;
  mime: string;
  bytes: Buffer;
}

export async function insertNewsletterAttachment(
  newsletterId: number,
  filename: string,
  mime: string,
  bytes: Buffer,
  uploadedBy: number | null,
): Promise<AttachmentMeta> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO newsletter_attachments (id, newsletter_id, filename, mime, bytes, byte_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, newsletterId, filename, mime, bytes, bytes.length, uploadedBy],
  );
  return { id, filename, mime, byteSize: bytes.length };
}

export async function listNewsletterAttachments(newsletterId: number): Promise<AttachmentMeta[]> {
  const rows = (
    await pool.query<{ id: string; filename: string; mime: string; byte_size: number }>(
      `SELECT id, filename, mime, byte_size FROM newsletter_attachments
        WHERE newsletter_id = $1 ORDER BY created_at`,
      [newsletterId],
    )
  ).rows;
  return rows.map((r) => ({ id: r.id, filename: r.filename, mime: r.mime, byteSize: r.byte_size }));
}

// The attachments with their bytes, for building the email payload at send time.
export async function listNewsletterAttachmentsForSend(newsletterId: number): Promise<AttachmentForSend[]> {
  const rows = (
    await pool.query<{ filename: string; mime: string; bytes: Buffer }>(
      `SELECT filename, mime, bytes FROM newsletter_attachments
        WHERE newsletter_id = $1 ORDER BY created_at`,
      [newsletterId],
    )
  ).rows;
  return rows.map((r) => ({ filename: r.filename, mime: r.mime, bytes: r.bytes }));
}

// Delete one attachment scoped to its newsletter; returns whether a row was removed.
export async function deleteNewsletterAttachment(newsletterId: number, id: string): Promise<boolean> {
  const res = await pool.query(
    `DELETE FROM newsletter_attachments WHERE id = $1 AND newsletter_id = $2`,
    [id, newsletterId],
  );
  return (res.rowCount ?? 0) > 0;
}
