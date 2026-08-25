import { pool } from "./pool";
// TASK-252: deleting/redacting a newsletter is an audited STATE CHANGE, so it goes through
// writeWithAudit — the row and its audit_log entry commit in one transaction. recordAudit would let
// the content vanish while its audit failed, which is precisely the gap this feature exists to close.
import { writeWithAudit } from "./donations";
import type { ListKind } from "./subscriber-lists";
import { suppressedAmong } from "./email-suppressions";
import { mergeRecipients } from "../newsletter/merge-recipients";

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
  // TASK-278: WHO sent it. sent_by has been stamped at send time since the atomic claim landed, but
  // was never selected back — so the history could not say who pressed the button.
  sentBy: string | null;
  // TASK-270: WHICH audience this went to. The list was stamped at send time but never read back, so
  // the history couldn't tell you whether a message went to volunteers or to donors. Null for
  // pre-audience sends, which were always the newsletter audience.
  audience: string | null;
  // TASK-283: what actually HAPPENED, on the list itself rather than only behind a per-newsletter
  // stats call. The overview exists to answer "where did it all land" in one place, and it cannot
  // do that if every row needs its own request. Counted as distinct addresses, matching
  // getNewsletterStats exactly so the list and the detail can never disagree.
  //
  // Null, never 0, when nothing is known — a send that predates event tracking must show an em dash,
  // not a confident zero that reads as "nobody got it".
  deliveredCount: number | null;
  clickedCount: number | null;
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
  audience?: string | null;
  sent_by_email?: string | null;
  delivered_count?: string | number | null;
  clicked_count?: string | number | null;
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
    audience: r.audience ?? null,
    sentBy: r.sent_by_email ?? null,
    // TASK-283: real outcomes on the LIST, not only behind a per-newsletter stats call. The overview
    // exists to answer "where did it all land" in one place, and it cannot do that if every row
    // needs its own request. Null (not 0) when nothing is known, so a send that predates tracking
    // shows an em dash rather than a confident, wrong zero.
    deliveredCount: r.delivered_count == null ? null : Number(r.delivered_count),
    clickedCount: r.clicked_count == null ? null : Number(r.clicked_count),
  };
}

export async function listNewsletters(): Promise<NewsletterSummary[]> {
  const rows = (
    await pool.query<Row>(
      `SELECT n.id, n.subject, n.body_html, n.status, n.sent_at, n.recipient_count, n.sent_count,
              n.failed_count, n.failed_emails, n.redacted_at, l.name AS audience,
              u.email AS sent_by_email, ev.delivered_count, ev.clicked_count
         FROM newsletters n
         LEFT JOIN subscriber_lists l ON l.id = n.list_id
         LEFT JOIN users u ON u.id = n.sent_by
         -- TASK-283: delivered/clicked for EVERY newsletter in one aggregate, so the overview can
         -- show outcomes inline instead of firing a stats request per row. DISTINCT email matches
         -- getNewsletterStats exactly, so the list and the detail can never disagree.
         LEFT JOIN (
           SELECT newsletter_id,
                  count(DISTINCT email) FILTER (WHERE event_type = 'delivered') AS delivered_count,
                  count(DISTINCT email) FILTER (WHERE event_type = 'clicked') AS clicked_count
             FROM newsletter_email_events
            GROUP BY newsletter_id
         ) ev ON ev.newsletter_id = n.id
        ORDER BY n.id DESC`,
    )
  ).rows;
  return rows.map((r) => toNewsletter({ ...r, body_html: "", body_json: null }));
}

export async function getNewsletter(id: number): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `SELECT n.id, n.subject, n.body_html, n.body_json, n.status, n.sent_at, n.recipient_count,
              n.sent_count, n.failed_count, n.failed_emails, n.redacted_at,
              l.name AS audience, u.email AS sent_by_email
         FROM newsletters n
         LEFT JOIN subscriber_lists l ON l.id = n.list_id
         LEFT JOIN users u ON u.id = n.sent_by
        WHERE n.id = $1`,
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

// TASK-259: a recipient of a LIST send. donorId XOR subscriberId identifies them — it decides which
// unsubscribe token their email carries.
export interface ListRecipient {
  email: string;
  donorId: number | null;
  subscriberId: number | null;
  fullName: string | null;
}

// Resolve who a list actually reaches, at send time — driven by the audience's KIND (TASK-270), not
// by its slug. It used to key off the literal string 'newsletter', so renaming that row would have
// silently dropped every donor from the send with nothing on screen to say so.
//   donors   — the live donor audience only (no stored rows of its own)
//   everyone — its own members PLUS the donors, deduped by address with the DONOR identity winning
//              (their token keys global newsletter consent, the subscriber's leaves one list)
//   manual   — exactly its active members
export async function listRecipientsForList(list: { id: number; kind: ListKind }): Promise<ListRecipient[]> {
  const fromSubs: ListRecipient[] = [];
  if (list.kind !== "donors") {
    const subs = await pool.query(
      `SELECT id, name, email FROM list_subscribers
        WHERE list_id = $1 AND unsubscribed_at IS NULL ORDER BY email`,
      [list.id],
    );
    for (const r of subs.rows) {
      fromSubs.push({ email: r.email.toLowerCase(), donorId: null, subscriberId: r.id, fullName: r.name });
    }
  }
  if (list.kind === "manual") return dropSuppressed(fromSubs);

  const donors = await listNewsletterRecipients();
  const byEmail = new Map<string, ListRecipient>();
  for (const s of fromSubs) byEmail.set(s.email, s);
  for (const d of donors) {
    byEmail.set(d.email, { email: d.email, donorId: d.donorId, subscriberId: null, fullName: d.fullName });
  }
  return dropSuppressed(Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email)));
}

// TASK-288: several audiences, resolved into the ONE list that will actually be mailed. Each
// audience goes through listRecipientsForList above - the same already-trusted query, including its
// suppression gate - and mergeRecipients folds them, deduplicated by email. Somebody on Volunteers
// AND Donors gets one email, not two: sending twice is the fastest way to be marked as spam, and the
// person who reports it is one of your most engaged supporters.
export async function listRecipientsForLists(
  lists: { id: number; kind: ListKind }[],
): Promise<ListRecipient[]> {
  if (lists.length === 0) return [];
  if (lists.length === 1) return listRecipientsForList(lists[0]);
  const perAudience: ListRecipient[][] = [];
  for (const list of lists) perAudience.push(await listRecipientsForList(list));
  return mergeRecipients(perAudience) as ListRecipient[];
}

// TASK-272: the last gate before anyone is mailed. Hard bounces and spam complaints are dropped HERE,
// inside the one resolver both the send loop and the recipient preview use — so the count an admin
// confirms is the count that goes out, and a suppressed address cannot be reached by any send path.
async function dropSuppressed(recipients: ListRecipient[]): Promise<ListRecipient[]> {
  if (recipients.length === 0) return recipients;
  const blocked = await suppressedAmong(recipients.map((r) => r.email));
  return blocked.size === 0 ? recipients : recipients.filter((r) => !blocked.has(r.email));
}

// TASK-288: stamp EVERY audience a send went to. list_id keeps the first, so the history join, the
// stats panel and listNewsletters all keep working exactly as they did - the array is additive.
export async function setNewsletterLists(id: number, listIds: number[]): Promise<void> {
  if (listIds.length === 0) return;
  await pool.query("UPDATE newsletters SET list_id = $1, list_ids = $2 WHERE id = $3", [
    listIds[0],
    listIds,
    id,
  ]);
}

// Stamp which audience a send went to (read back by the stats panel and history).
export async function setNewsletterList(id: number, listId: number): Promise<void> {
  await pool.query(`UPDATE newsletters SET list_id = $2 WHERE id = $1`, [id, listId]);
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

// Returns the address that was unsubscribed, so the caller can make the opt-out STICK across both
// data models (TASK-272 — see unsubscribeEverywhereForEmail).
export async function unsubscribeDonor(donorId: number): Promise<string | null> {
  const { rows } = await pool.query(
    `UPDATE donors SET email_consent = false WHERE id = $1 RETURNING lower(email) AS email`,
    [donorId],
  );
  return rows[0]?.email ?? null;
}

// TASK-272: an unsubscribe has to be true for the ADDRESS, not just for one row that happens to
// represent them. Someone who donated with the box ticked AND signed up through the website footer
// exists twice: a consenting donor and an active list membership. The send deduped them and let the
// DONOR identity win, so they got a donor token — clearing that flag left the subscriber row active
// and the very next newsletter reached them again, after we had told them they were unsubscribed.
// Tombstoning every membership for the address closes that, and is a no-op for the common case.
export async function unsubscribeAllListsForEmail(email: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE list_subscribers SET unsubscribed_at = COALESCE(unsubscribed_at, now())
      WHERE lower(email) = $1 AND unsubscribed_at IS NULL`,
    [email.trim().toLowerCase()],
  );
  return rowCount ?? 0;
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

// TASK-258: there is deliberately NO redact/delete for a SENT newsletter in this module — the
// function that did it (TASK-252's redactSentNewsletter) was REMOVED, not disabled. A sent campaign
// is the charity's permanent record of what was said to donors (trustees, complaints and the
// Fundraising Regulator all ask "what exactly did you send?"), and the stored content carries no
// donor data — names merge per recipient at send time, so privacy never required deleting it.
// Immutability by absence: nothing to call, nothing to guard, nothing to forget. The redacted_at /
// redacted_by columns remain for the rows redacted before the reversal; the UI still labels those.
