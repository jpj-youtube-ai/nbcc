import { contactPool } from "./contact-pool";
import { archiveCondition, type ArchiveView } from "../admin/archive-filter";
import type { ContactEnquiry } from "../contact/schema";

// The ONLY read/write path for contact enquiries. Uses contactPool exclusively — never
// src/db/pool.ts or stories-pool.ts — so this feature can never reach the main `charity` DB
// or the `stories` DB. No audit_log row (that table lives in the charity DB; this feature is
// self-contained in its own database).

export interface ContactRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  message: string;
  status: string; // new | replied
  created_at: Date;
  replied_at: Date | null;
  replied_by: string | null; // admin email who marked it replied; null otherwise
}

export async function insertEnquiry(e: ContactEnquiry): Promise<{ id: number }> {
  const result = await contactPool.query<{ id: number }>(
    `INSERT INTO contact_enquiries (first_name, last_name, email, message)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [e.firstName, e.lastName, e.email, e.message],
  );
  return { id: result.rows[0].id };
}

// Newest-first, optionally filtered by status. Returns the full row set (the message body is
// small and there is no cross-submitter PII-minimisation concern as there is for stories).
export async function listEnquiries(status?: string, view: ArchiveView = "live"): Promise<ContactRow[]> {
  const conditions: string[] = [];
  const params: string[] = [];
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  // TASK-311: archived enquiries stay out of the working list and appear only behind the Archived
  // filter. Same single source of truth as the stories list.
  const archived = archiveCondition(view);
  if (archived) conditions.push(archived);
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const result = await contactPool.query<ContactRow>(
    `SELECT id, first_name, last_name, email, message, status, created_at, replied_at, replied_by
     FROM contact_enquiries${where}
     ORDER BY created_at DESC`,
    params,
  );
  return result.rows;
}

// TASK-311: the everyday action - a message from a real person should not vanish to a stray click.
export async function archiveEnquiry(id: number): Promise<boolean> {
  const result = await contactPool.query(
    `UPDATE contact_enquiries SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function restoreEnquiry(id: number): Promise<boolean> {
  const result = await contactPool.query(
    `UPDATE contact_enquiries SET archived_at = NULL WHERE id = $1 AND archived_at IS NOT NULL`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getEnquiry(id: number): Promise<ContactRow | null> {
  const result = await contactPool.query<ContactRow>(
    `SELECT id, first_name, last_name, email, message, status, created_at, replied_at, replied_by,
            archived_at
     FROM contact_enquiries WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

// Set status to 'replied' (replied_at = now(), replied_by = the admin email) or back to 'new'
// (replied_at = null, replied_by = null). `repliedBy` is ignored when reverting. Returns the
// updated row, or null when the id does not exist.
export async function markReplied(
  id: number,
  replied: boolean,
  repliedBy: string | null,
): Promise<ContactRow | null> {
  const result = await contactPool.query<ContactRow>(
    `UPDATE contact_enquiries
     SET status = $2,
         replied_at = ${replied ? "now()" : "NULL"},
         replied_by = $3
     WHERE id = $1
     RETURNING id, first_name, last_name, email, message, status, created_at, replied_at, replied_by`,
    [id, replied ? "replied" : "new", replied ? repliedBy : null],
  );
  return result.rows[0] ?? null;
}

export async function deleteEnquiry(id: number): Promise<boolean> {
  const result = await contactPool.query(`DELETE FROM contact_enquiries WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
