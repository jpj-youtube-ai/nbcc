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
  bodyJson: unknown | null;
}

export interface NewsletterRecipient {
  email: string;
  donorId: number;
  fullName: string | null;
}

interface Row {
  id: number;
  subject: string;
  body_html: string;
  body_json: unknown | null;
  status: "draft" | "sent";
  sent_at: string | null;
  recipient_count: number | null;
}

function toNewsletter(r: Row): Newsletter {
  return {
    id: r.id,
    subject: r.subject,
    bodyHtml: r.body_html,
    bodyJson: r.body_json,
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
  return rows.map((r) => toNewsletter({ ...r, body_html: "", body_json: null }));
}

export async function getNewsletter(id: number): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `SELECT id, subject, body_html, body_json, status, sent_at, recipient_count
         FROM newsletters WHERE id = $1`,
      [id],
    )
  ).rows[0];
  return row ? toNewsletter(row) : null;
}

export async function createNewsletter(
  subject: string,
  bodyHtml: string,
  bodyJson: unknown | null,
): Promise<Newsletter> {
  const row = (
    await pool.query<Row>(
      `INSERT INTO newsletters (subject, body_html, body_json, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING id, subject, body_html, body_json, status, sent_at, recipient_count`,
      [subject, bodyHtml, bodyJson],
    )
  ).rows[0];
  return toNewsletter(row);
}

export async function updateNewsletterDraft(
  id: number,
  subject: string,
  bodyHtml: string,
  bodyJson: unknown | null,
): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `UPDATE newsletters SET subject = $2, body_html = $3, body_json = $4, updated_at = now()
        WHERE id = $1 AND status = 'draft'
       RETURNING id, subject, body_html, body_json, status, sent_at, recipient_count`,
      [id, subject, bodyHtml, bodyJson],
    )
  ).rows[0];
  return row ? toNewsletter(row) : null;
}

// Recipients: every consenting donor with an email, deduped case-insensitively by address.
export async function listNewsletterRecipients(): Promise<NewsletterRecipient[]> {
  const rows = (
    await pool.query<{ email: string; donor_id: number; full_name: string | null }>(
      `SELECT lower(email) AS email, min(id) AS donor_id, min(full_name) AS full_name
         FROM donors
        WHERE email_consent = true AND email IS NOT NULL
        GROUP BY lower(email)
        ORDER BY email`,
    )
  ).rows;
  return rows.map((r) => ({ email: r.email, donorId: r.donor_id, fullName: r.full_name }));
}

// Atomically claim a draft for sending: flip it to 'sent' ONLY if it is still a draft, in a single
// UPDATE, and return the claimed row. Returns null if the row is missing or already sent — so the
// caller can 409 and, crucially, NEVER runs the send loop for a newsletter another request already
// claimed. This is what makes a double-click / two concurrent admins unable to double-send: the row
// is marked sent BEFORE any email goes out. recipient_count is filled in afterwards by
// setNewsletterRecipientCount once the recipient list is known.
export async function claimNewsletterForSend(id: number, sentBy: number): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `UPDATE newsletters SET status = 'sent', sent_at = now(), sent_by = $2
        WHERE id = $1 AND status = 'draft'
       RETURNING id, subject, body_html, body_json, status, sent_at, recipient_count`,
      [id, sentBy],
    )
  ).rows[0];
  return row ? toNewsletter(row) : null;
}

export async function setNewsletterRecipientCount(id: number, recipientCount: number): Promise<void> {
  await pool.query(`UPDATE newsletters SET recipient_count = $2 WHERE id = $1`, [id, recipientCount]);
}

export async function unsubscribeDonor(donorId: number): Promise<void> {
  await pool.query(`UPDATE donors SET email_consent = false WHERE id = $1`, [donorId]);
}

// Add a newsletter subscriber captured manually (e.g. an email given verbally on a doorstep). If a
// donor with this email already exists, (re)enable their consent — "resubscribed"; otherwise create
// a minimal individual donor row with consent on — "added". Matched case-insensitively, mirroring
// listNewsletterRecipients' lower(email) dedupe, so a manual add never creates a duplicate consenting
// recipient for an address already on file. full_name is required by the schema, so it falls back to
// the email's local part when no name is supplied.
export async function addNewsletterSubscriber(
  email: string,
  name?: string,
): Promise<{ email: string; status: "added" | "resubscribed" }> {
  const trimmed = email.trim();
  const lower = trimmed.toLowerCase();
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM donors WHERE lower(email) = $1 LIMIT 1`,
    [lower],
  );
  if (existing.rows.length > 0) {
    await pool.query(`UPDATE donors SET email_consent = true WHERE lower(email) = $1`, [lower]);
    return { email: lower, status: "resubscribed" };
  }
  const fullName = name && name.trim() ? name.trim() : trimmed.split("@")[0];
  await pool.query(
    `INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', $1, $2, true)`,
    [fullName, trimmed],
  );
  return { email: lower, status: "added" };
}
