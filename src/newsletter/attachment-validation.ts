// Pure validation for newsletter file attachments (TASK-193). No DB/config import so it can be
// unit-tested without a full env (golden rule 5). DB access lives in ../db/newsletter-attachments.
//
// 10 MB per-file cap and a conservative allow-list of the document/image types a charity newsletter
// would actually send (flyers, order-of-service PDFs, spreadsheets). Executables/scripts are not
// allowed. The bytes are only ever emailed as an attachment (never served inline from our origin),
// so the list is broader than the image one, but still deliberately bounded.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export function validateAttachment(
  mime: string,
  byteSize: number,
): { ok: true } | { ok: false; reason: "mime" | "size" } {
  if (!ALLOWED_ATTACHMENT_MIME.includes(mime as (typeof ALLOWED_ATTACHMENT_MIME)[number])) {
    return { ok: false, reason: "mime" };
  }
  if (byteSize <= 0 || byteSize > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}
