import { pool } from "./pool";
import { emailLogPruneCutoff } from "../email/log-retention";

// The email send audit log (email-audit feature): one row per send attempt from
// src/clients/email.ts, enriched later by SES delivery events. Metadata only — never a body.
// Single-statement writes over the pool, mirroring src/db/newsletter-events.ts.

// How far an SES delivery event may trail the send it belongs to and still be matched to it.
// Same 14-day window the newsletter correlation uses — events beyond that are not ours to claim.
const DELIVERY_MATCH_DAYS = 14;
// Error/detail strings are stored truncated: they exist to say WHY, not to warehouse payloads.
const DETAIL_LIMIT = 500;

export interface EmailSendRecord {
  kind: string;
  recipient: string;
  recipientName?: string | null;
  subject: string;
  status: "sent" | "failed";
  error?: string | null;
  /** TASK-346: the id SES returned. Null for a stubbed or failed send. */
  sesMessageId?: string | null;
}

// Record one send attempt. Callers treat this as BEST-EFFORT: a bookkeeping failure must never
// fail (or block) the send it describes — src/clients/email.ts catches and logs.
export async function recordEmailSend(record: EmailSendRecord): Promise<void> {
  await pool.query(
    `INSERT INTO email_log
       (kind, recipient, recipient_name, subject, status, error, ses_message_id)
     VALUES ($1, lower($2), $3, $4, $5, $6, $7)`,
    [
      record.kind,
      record.recipient,
      record.recipientName ?? null,
      record.subject,
      record.status,
      record.error ? String(record.error).slice(0, DETAIL_LIMIT) : null,
      record.sesMessageId ?? null,
    ],
  );
}

// Stamp a delivery outcome (delivered / bounced / complained) onto the send it belongs to.
//
// TASK-346: BY MESSAGE ID where we have one. The original correlation was recipient + recency —
// newest unmatched row for that address — which is simply wrong as soon as one person has two
// recent emails, and it picks the NEWER one, so an event for an older send lands on a newer one
// and the page shows both outcomes inverted. That became a live case when the ball started
// sending a guest-details read-back minutes after a ticket confirmation: the page exists to
// answer "did their confirmation arrive?", and it would have answered backwards.
//
// The old heuristic is kept as a FALLBACK, not deleted: rows written before this shipped have no
// id, and neither do stubbed sends. Better a best guess than no outcome at all for those.
// Unmatched events are still dropped; the newsletter pipeline records its own separately.
export async function markEmailDelivery(
  recipient: string,
  deliveryStatus: "delivered" | "bounced" | "complained",
  occurredAt: Date,
  detail: string | null,
  messageId: string | null = null,
): Promise<void> {
  if (messageId) {
    // TASK-464: one email can go to several people (the Ball's ticket report), each with a row
    // under the same id. The outcome belongs to the row for the address SES named, and only that.
    const exact = await pool.query(
      `UPDATE email_log SET delivery_status = $2, delivery_at = $3::timestamptz, delivery_detail = $4
        WHERE ses_message_id = $1 AND recipient = lower($5)`,
      [messageId, deliveryStatus, occurredAt.toISOString(), detail ? detail.slice(0, DETAIL_LIMIT) : null, recipient],
    );
    if ((exact.rowCount ?? 0) > 0) return;
    // An email to one person: its id alone is exact, however SES wrote the address.
    const only = await pool.query(
      `UPDATE email_log SET delivery_status = $2, delivery_at = $3::timestamptz, delivery_detail = $4
        WHERE ses_message_id = $1
          AND (SELECT count(*) FROM email_log WHERE ses_message_id = $1) = 1`,
      [messageId, deliveryStatus, occurredAt.toISOString(), detail ? detail.slice(0, DETAIL_LIMIT) : null],
    );
    // Only fall back when the id matched nothing — an id we have never seen is an email from
    // before this shipped, or from another sender on the same SES identity.
    if ((only.rowCount ?? 0) > 0) return;
  }
  await pool.query(
    `UPDATE email_log SET delivery_status = $2, delivery_at = $3::timestamptz, delivery_detail = $4
      WHERE id = (
        SELECT id FROM email_log
         WHERE recipient = lower($1)
           AND delivery_status IS NULL
           AND status = 'sent'
           AND created_at > $3::timestamptz - interval '${DELIVERY_MATCH_DAYS} days'
           AND created_at <= $3::timestamptz + interval '10 minutes'
         ORDER BY created_at DESC
         LIMIT 1
      )`,
    [recipient, deliveryStatus, occurredAt.toISOString(), detail ? detail.slice(0, DETAIL_LIMIT) : null],
  );
}

export interface EmailLogRow {
  id: number;
  kind: string;
  recipient: string;
  recipientName: string | null;
  subject: string;
  status: string;
  error: string | null;
  deliveryStatus: string | null;
  deliveryAt: string | null;
  deliveryDetail: string | null;
  createdAt: string;
  /** TASK-562: set on a problem row staff removed from the red band: when, who, 'stop' or 'tidy'. */
  removedAt: string | null;
  removedBy: string | null;
  removedKind: string | null;
}

export interface EmailLogQuery {
  kind?: string; // exact kind filter
  status?: string; // 'sent' | 'failed' | 'delivered' | 'bounced' | 'complained'
  q?: string; // substring across recipient, name and subject
  limit: number;
  offset: number;
}

interface RawRow {
  id: number;
  kind: string;
  recipient: string;
  recipient_name: string | null;
  subject: string;
  status: string;
  error: string | null;
  delivery_status: string | null;
  delivery_at: string | null;
  delivery_detail: string | null;
  created_at: string;
  removed_at?: string | null;
  removed_by?: string | null;
  removed_kind?: string | null;
}

const rowOf = (r: RawRow): EmailLogRow => ({
  id: r.id,
  kind: r.kind,
  recipient: r.recipient,
  recipientName: r.recipient_name,
  subject: r.subject,
  status: r.status,
  error: r.error,
  deliveryStatus: r.delivery_status,
  deliveryAt: r.delivery_at,
  deliveryDetail: r.delivery_detail,
  createdAt: r.created_at,
  removedAt: r.removed_at ?? null,
  removedBy: r.removed_by ?? null,
  removedKind: r.removed_kind ?? null,
});

// TASK-562: staff can remove an address from the red band (email_audit_removals). What that hides
// is decided HERE, each time the band or the list is read, and never when an email is sent: for a
// log row `l` and a removal `r` of its address that has not been put back, the row is hidden when
// it is older than the removal, or the removal is a 'stop' and the address is still blocked. So a
// tidied address comes back the next time it fails; a stopped one stays out for as long as it is
// blocked; and unblocking it under Newsletter brings its later failures back with no code there
// knowing about this. One fragment, used by both readers, so the band and the list's "Removed by"
// mark can never disagree.
const PROBLEM = `(l.status = 'failed' OR l.delivery_status IN ('bounced', 'complained'))`;
const REMOVAL_HIDES = `r.email = l.recipient AND r.put_back_at IS NULL
           AND (l.created_at <= r.removed_at
                OR (r.kind = 'stop' AND EXISTS (
                      SELECT 1 FROM email_suppressions s
                       WHERE lower(s.email) = l.recipient AND s.removed_at IS NULL)))`;

// The main list: newest first, filterable by kind and status, searchable across recipient /
// name / subject. A status filter of 'failed' means OUR attempt failed; 'bounced'/'complained'/
// 'delivered' filter on the mailbox-side outcome; 'sent' means attempted-and-accepted.
export async function listEmailLog(query: EmailLogQuery): Promise<{ rows: EmailLogRow[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const arg = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };

  if (query.kind) where.push(`kind = ${arg(query.kind)}`);
  if (query.status === "failed" || query.status === "sent") {
    where.push(`status = ${arg(query.status)}`);
  } else if (query.status === "delivered" || query.status === "bounced" || query.status === "complained") {
    where.push(`delivery_status = ${arg(query.status)}`);
  }
  if (query.q && query.q.trim()) {
    const like = arg(`%${query.q.trim().toLowerCase()}%`);
    where.push(`(recipient LIKE ${like} OR lower(coalesce(recipient_name, '')) LIKE ${like} OR lower(subject) LIKE ${like})`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await pool.query(`SELECT count(*) AS n FROM email_log ${clause}`, params);
  // TASK-562: each row with the newest removal that is hiding it from the red band, if one is, so
  // the page can say who removed it and when. Only a problem row can be hidden. The join hands on
  // three names of its own and nothing else, so the filters above, which name the log's columns
  // plainly ("kind", "status"), still mean the log's.
  const rows = await pool.query(
    `SELECT id, kind, recipient, recipient_name, subject, status, error,
            delivery_status, delivery_at, delivery_detail, created_at,
            removed_at, removed_by, removed_kind
       FROM email_log l
       LEFT JOIN LATERAL (
         SELECT r.removed_at, r.removed_by, r.kind AS removed_kind
           FROM email_audit_removals r
          WHERE ${REMOVAL_HIDES}
            AND ${PROBLEM}
          ORDER BY r.removed_at DESC
          LIMIT 1
       ) rm ON true
       ${clause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${arg(query.limit)} OFFSET ${arg(query.offset)}`,
    params,
  );
  return { rows: (rows.rows as RawRow[]).map(rowOf), total: Number(total.rows[0]?.n ?? 0) };
}

// The red band: everything that went wrong recently — our attempt failed, or the mailbox side
// bounced/complained — newest first, capped (the band is a warning light, not a second table).
// TASK-562: less what staff have removed from it (REMOVAL_HIDES above). The Overview counts this
// same list, so its number drops with the band's.
export async function listRecentEmailFailures(days = 14, limit = 25): Promise<EmailLogRow[]> {
  const { rows } = await pool.query(
    `SELECT id, kind, recipient, recipient_name, subject, status, error,
            delivery_status, delivery_at, delivery_detail, created_at
       FROM email_log l
      WHERE l.created_at > now() - ($1 || ' days')::interval
        AND ${PROBLEM}
        AND NOT EXISTS (
          SELECT 1 FROM email_audit_removals r
           WHERE ${REMOVAL_HIDES})
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $2`,
    [days, limit],
  );
  return (rows as RawRow[]).map(rowOf);
}

// Retention (6 years past tax-year-end — src/email/log-retention.ts). Called from the daily
// runner; returns how many rows left, for its one-line summary.
export async function pruneEmailLog(now: Date = new Date()): Promise<number> {
  const cutoff = emailLogPruneCutoff(now);
  const { rowCount } = await pool.query(`DELETE FROM email_log WHERE created_at <= $1::timestamptz`, [
    cutoff.toISOString(),
  ]);
  // TASK-562: a removal from the red band names an address too, and is about rows that have now
  // gone: it does not outlive them.
  await pool.query(`DELETE FROM email_audit_removals WHERE removed_at <= $1::timestamptz`, [cutoff.toISOString()]);
  // And a removal whose address no longer has a single row in the log. Two older paths forget a
  // person here without coming through eraseEmailLogFor (a sponsor's unpaid pledge in
  // src/db/pledges.ts, a cleared team invite in src/db/fundraising-teams.ts) and neither knows
  // about removals: without this the removal would be the last place the address was kept.
  await pool.query(
    `DELETE FROM email_audit_removals r WHERE NOT EXISTS (SELECT 1 FROM email_log l WHERE l.recipient = r.email)`,
  );
  return rowCount ?? 0;
}

// Right-to-erasure hook: remove every log row for an address. No flow calls this YET — the
// repo's erasure today is per-story/per-contact (TASK-311) and carries no email-log linkage —
// but when a donor-erasure flow lands it must call this in the same stroke, so the helper (and
// its test) ship with the table rather than being remembered later.
//
// Sponsor pledges call it with `kinds`: when an unpaid pledge's details are removed, the log rows for
// the emails about that pledge go too, and nothing else sent to that address is touched.
//
// TASK-562: without `kinds`, what staff decided about the address in the Email audit
// (email_audit_removals) goes with its rows. With `kinds` it stays: the address still has others.
export async function eraseEmailLogFor(email: string, kinds?: readonly string[]): Promise<number> {
  const { rowCount } = kinds
    ? await pool.query(`DELETE FROM email_log WHERE recipient = lower($1) AND kind = ANY($2)`, [email, [...kinds]])
    : await pool.query(`DELETE FROM email_log WHERE recipient = lower($1)`, [email]);
  if (!kinds) await pool.query(`DELETE FROM email_audit_removals WHERE email = lower($1)`, [email]);
  return rowCount ?? 0;
}
