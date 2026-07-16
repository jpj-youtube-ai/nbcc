import { pool } from "./pool";
// TASK-252: deleting/redacting a newsletter is an audited STATE CHANGE, so it goes through
// writeWithAudit — the row and its audit_log entry commit in one transaction. recordAudit would let
// the content vanish while its audit failed, which is precisely the gap this feature exists to close.
import { writeWithAudit } from "./donations";

// DB access for the admin newsletter (TASK-161/REQ-069). Read/write over the newsletters table plus
// the consented-donor recipient query and the unsubscribe write. Mirrors the pool-query style of
// src/db/portal.ts (no transaction needed — single-statement writes).

export interface NewsletterSummary {
  id: number;
  subject: string;
  status: "draft" | "sent";
  sentAt: string | null;
  recipientCount: number | null;
  // Delivery outcome, stamped after a send (TASK-190). Null until a newsletter has been sent.
  sentCount: number | null;
  failedCount: number | null;
  failedEmails: string[] | null;
  // TASK-252: when a SENT newsletter's content was deleted; null on everything else. A redacted
  // newsletter keeps this whole summary — that stub IS the record of what was sent, when, to how many.
  redactedAt: string | null;
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

// A managed subscriber row: one consenting email address (deduped), for the subscriber list.
export interface NewsletterSubscriber {
  email: string;
  name: string | null;
}

interface Row {
  id: number;
  subject: string;
  body_html: string;
  body_json: unknown | null;
  status: "draft" | "sent";
  sent_at: string | null;
  recipient_count: number | null;
  sent_count: number | null;
  failed_count: number | null;
  failed_emails: string[] | null;
  redacted_at: string | null;
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
    sentCount: r.sent_count ?? null,
    failedCount: r.failed_count ?? null,
    failedEmails: r.failed_emails ?? null,
    // TASK-252: when a SENT newsletter's content was deleted. NULL on everything else, so the UI can
    // both label it and stop offering a delete that would do nothing.
    redactedAt: r.redacted_at ?? null,
  };
}

export async function listNewsletters(): Promise<NewsletterSummary[]> {
  const rows = (
    await pool.query<Row>(
      `SELECT id, subject, body_html, status, sent_at, recipient_count, sent_count, failed_count, failed_emails,
              redacted_at
         FROM newsletters ORDER BY id DESC`,
    )
  ).rows;
  return rows.map((r) => toNewsletter({ ...r, body_html: "", body_json: null }));
}

export async function getNewsletter(id: number): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `SELECT id, subject, body_html, body_json, status, sent_at, recipient_count, sent_count, failed_count, failed_emails,
              redacted_at
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
       RETURNING id, subject, body_html, body_json, status, sent_at, recipient_count, sent_count, failed_count, failed_emails`,
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
       RETURNING id, subject, body_html, body_json, status, sent_at, recipient_count, sent_count, failed_count, failed_emails`,
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
       RETURNING id, subject, body_html, body_json, status, sent_at, recipient_count, sent_count, failed_count, failed_emails`,
      [id, sentBy],
    )
  ).rows[0];
  return row ? toNewsletter(row) : null;
}

// Stamp the delivery outcome after a send: the target list size plus how many actually went out,
// how many failed, and which addresses failed (TASK-190). failed_emails is stored as a jsonb array.
export async function setNewsletterDeliverySummary(
  id: number,
  summary: { recipientCount: number; sentCount: number; failedCount: number; failedEmails: string[] },
): Promise<void> {
  await pool.query(
    `UPDATE newsletters
        SET recipient_count = $2, sent_count = $3, failed_count = $4, failed_emails = $5
      WHERE id = $1`,
    [id, summary.recipientCount, summary.sentCount, summary.failedCount, JSON.stringify(summary.failedEmails)],
  );
}

// The managed subscriber list: consenting donors deduped by address, newest-consent first is not
// tracked, so ordered by email. An optional case-insensitive query filters on email or name.
export async function listNewsletterSubscribers(q?: string): Promise<NewsletterSubscriber[]> {
  const params: unknown[] = [];
  let filter = "";
  if (q && q.trim()) {
    params.push(`%${q.trim().toLowerCase()}%`);
    filter = `AND (lower(email) LIKE $1 OR lower(coalesce(full_name, '')) LIKE $1)`;
  }
  const rows = (
    await pool.query<{ email: string; name: string | null }>(
      `SELECT lower(email) AS email, min(full_name) AS name
         FROM donors
        WHERE email_consent = true AND email IS NOT NULL ${filter}
        GROUP BY lower(email)
        ORDER BY email`,
      params,
    )
  ).rows;
  return rows.map((r) => ({ email: r.email, name: r.name }));
}

// Remove a subscriber by address: turn email_consent off for EVERY donor row with that email
// (case-insensitive), so a person on file under more than one donation stops receiving the
// newsletter. Returns how many rows were affected (0 = no such consenting address).
export async function unsubscribeSubscriberByEmail(email: string): Promise<number> {
  const res = await pool.query(
    `UPDATE donors SET email_consent = false WHERE lower(email) = $1 AND email_consent = true`,
    [email.trim().toLowerCase()],
  );
  return res.rowCount ?? 0;
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

// --- Deleting a newsletter (TASK-252) -------------------------------------------------------------
// A DRAFT never went anywhere, so it is really deleted. A SENT newsletter went to real donors: the row
// is the record of what was emailed, and deleting it would leave the charity unable to answer "what
// did you send me in July?". But keeping it forever also means holding donor addresses
// (failed_emails) indefinitely. So a sent newsletter is REDACTED, not deleted — the content and the
// bounced addresses go; the stub that answers what/when/how-many stays.

// Hard-delete a DRAFT. The `status = 'draft'` guard is the safety catch: even handed the id of a sent
// newsletter, this can never destroy the record of something that reached real donors. Returns false
// when nothing matched, so the route 404s instead of pretending.
//
// Row + audit commit in ONE transaction (writeWithAudit): a deletion that vanished without its audit
// row would be exactly the gap this feature exists to avoid.
export async function deleteDraftNewsletter(id: number, actor: string, subject: string): Promise<boolean> {
  return writeWithAudit(
    async (client) => {
      const { rowCount } = await client.query(`DELETE FROM newsletters WHERE id = $1 AND status = 'draft'`, [id]);
      return (rowCount ?? 0) > 0;
    },
    (removed) => ({
      actor,
      action: "newsletter.deleted",
      entity: "newsletter",
      entityId: id,
      data: { subject, removed },
    }),
  );
}

// Redact a SENT newsletter: strip the content and the donor addresses, keep the audit stub.
//
// KEPT (deliberately untouched): subject, status, sent_at, sent_by, recipient_count, sent_count,
// failed_count — the record the charity has to be able to produce.
// CLEARED: body_html, body_json, failed_emails, and the attachments.
//
// body_html is BLANKED to '' rather than nulled: the column is NOT NULL, and relaxing that would break
// older code expecting a string if we ever rolled back. Returns false when nothing matched (already
// redacted rows still match, so re-redacting is harmless and idempotent) — the `status = 'sent'` guard
// means this can never touch a draft.
export async function redactSentNewsletter(
  id: number,
  redactedBy: number | null,
  actor: string,
  subject: string,
): Promise<boolean> {
  return writeWithAudit(
    async (client) => {
      // Attachments are content too — and they are the actual files that went to donors. Inside the
      // transaction, so a failure part-way cannot leave the files gone but the newsletter intact.
      await client.query(`DELETE FROM newsletter_attachments WHERE newsletter_id = $1`, [id]);
      // TASK-255: the delivery-tracking rows are keyed BY donor address — the same data class as
      // failed_emails, so the redaction promise covers them. Same transaction: a partial redaction
      // is not a redaction. The stub keeps the headline counts; per-address detail goes.
      await client.query(`DELETE FROM newsletter_email_events WHERE newsletter_id = $1`, [id]);
      await client.query(`DELETE FROM newsletter_sends WHERE newsletter_id = $1`, [id]);
      const { rowCount } = await client.query(
        `UPDATE newsletters
            SET body_html = '', body_json = NULL, failed_emails = NULL,
                redacted_at = now(), redacted_by = $2
          WHERE id = $1 AND status = 'sent'`,
        [id, redactedBy],
      );
      return (rowCount ?? 0) > 0;
    },
    (redacted) => ({
      actor,
      action: "newsletter.redacted",
      entity: "newsletter",
      entityId: id,
      // The audit keeps what the redacted row no longer can: the audit trail the user asked for.
      data: { subject, redacted },
    }),
  );
}
