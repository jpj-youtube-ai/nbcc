import { pool } from "./pool";

// DB access for the admin newsletter (TASK-161/REQ-069). Read/write over the newsletters table plus
// the consented-donor recipient query and the unsubscribe write. Mirrors the pool-query style of
// src/db/portal.ts (no transaction needed — single-statement writes).

export interface NewsletterSummary {
  id: number;
  subject: string;
  status: "draft" | "sent";
  sentAt: string | null;
  recipientCount: number | null;
}

export interface Newsletter extends NewsletterSummary {
  bodyHtml: string;
}

export interface NewsletterRecipient {
  email: string;
  donorId: number;
}

interface Row {
  id: number;
  subject: string;
  body_html: string;
  status: "draft" | "sent";
  sent_at: string | null;
  recipient_count: number | null;
}

function toNewsletter(r: Row): Newsletter {
  return {
    id: r.id,
    subject: r.subject,
    bodyHtml: r.body_html,
    status: r.status,
    sentAt: r.sent_at,
    recipientCount: r.recipient_count,
  };
}

export async function listNewsletters(): Promise<NewsletterSummary[]> {
  const rows = (
    await pool.query<Row>(
      `SELECT id, subject, body_html, status, sent_at, recipient_count
         FROM newsletters ORDER BY id DESC`,
    )
  ).rows;
  return rows.map((r) => toNewsletter({ ...r, body_html: "" }));
}

export async function getNewsletter(id: number): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `SELECT id, subject, body_html, status, sent_at, recipient_count
         FROM newsletters WHERE id = $1`,
      [id],
    )
  ).rows[0];
  return row ? toNewsletter(row) : null;
}

export async function createNewsletter(subject: string, bodyHtml: string): Promise<Newsletter> {
  const row = (
    await pool.query<Row>(
      `INSERT INTO newsletters (subject, body_html, status)
       VALUES ($1, $2, 'draft')
       RETURNING id, subject, body_html, status, sent_at, recipient_count`,
      [subject, bodyHtml],
    )
  ).rows[0];
  return toNewsletter(row);
}

export async function updateNewsletterDraft(
  id: number,
  subject: string,
  bodyHtml: string,
): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `UPDATE newsletters SET subject = $2, body_html = $3, updated_at = now()
        WHERE id = $1 AND status = 'draft'
       RETURNING id, subject, body_html, status, sent_at, recipient_count`,
      [id, subject, bodyHtml],
    )
  ).rows[0];
  return row ? toNewsletter(row) : null;
}

// Recipients: every consenting donor with an email, deduped case-insensitively by address.
export async function listNewsletterRecipients(): Promise<NewsletterRecipient[]> {
  const rows = (
    await pool.query<{ email: string; donor_id: number }>(
      `SELECT lower(email) AS email, min(id) AS donor_id
         FROM donors
        WHERE email_consent = true AND email IS NOT NULL
        GROUP BY lower(email)
        ORDER BY email`,
    )
  ).rows;
  return rows.map((r) => ({ email: r.email, donorId: r.donor_id }));
}

// Mark a draft sent. Returns false when the row is not a draft (already sent / missing) so the route
// can treat a re-send as a no-op 409 — a double-click cannot re-blast.
export async function markNewsletterSent(
  id: number,
  sentBy: number,
  recipientCount: number,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE newsletters
        SET status = 'sent', sent_at = now(), sent_by = $2, recipient_count = $3
      WHERE id = $1 AND status = 'draft'`,
    [id, sentBy, recipientCount],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function unsubscribeDonor(donorId: number): Promise<void> {
  await pool.query(`UPDATE donors SET email_consent = false WHERE id = $1`, [donorId]);
}
