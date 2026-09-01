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
}

// Record one send attempt. Callers treat this as BEST-EFFORT: a bookkeeping failure must never
// fail (or block) the send it describes — src/clients/email.ts catches and logs.
export async function recordEmailSend(record: EmailSendRecord): Promise<void> {
  await pool.query(
    `INSERT INTO email_log (kind, recipient, recipient_name, subject, status, error)
     VALUES ($1, lower($2), $3, $4, $5, $6)`,
    [
      record.kind,
      record.recipient,
      record.recipientName ?? null,
      record.subject,
      record.status,
      record.error ? String(record.error).slice(0, DETAIL_LIMIT) : null,
    ],
  );
}

// Stamp a delivery outcome (delivered / bounced / complained) onto the NEWEST matching send to
// that address that has no outcome yet — the same newest-first, windowed correlation the
// newsletter stats use (SES reports per address, not per message). Unmatched events are simply
// dropped here; the newsletter pipeline still records its own.
export async function markEmailDelivery(
  recipient: string,
  deliveryStatus: "delivered" | "bounced" | "complained",
  occurredAt: Date,
  detail: string | null,
): Promise<void> {
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
});

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
  const rows = await pool.query(
    `SELECT id, kind, recipient, recipient_name, subject, status, error,
            delivery_status, delivery_at, delivery_detail, created_at
       FROM email_log ${clause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${arg(query.limit)} OFFSET ${arg(query.offset)}`,
    params,
  );
  return { rows: (rows.rows as RawRow[]).map(rowOf), total: Number(total.rows[0]?.n ?? 0) };
}

// The red band: everything that went wrong recently — our attempt failed, or the mailbox side
// bounced/complained — newest first, capped (the band is a warning light, not a second table).
export async function listRecentEmailFailures(days = 14, limit = 25): Promise<EmailLogRow[]> {
  const { rows } = await pool.query(
    `SELECT id, kind, recipient, recipient_name, subject, status, error,
            delivery_status, delivery_at, delivery_detail, created_at
       FROM email_log
      WHERE created_at > now() - ($1 || ' days')::interval
        AND (status = 'failed' OR delivery_status IN ('bounced', 'complained'))
      ORDER BY created_at DESC, id DESC
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
  return rowCount ?? 0;
}

// Right-to-erasure hook: remove every log row for an address. No flow calls this YET — the
// repo's erasure today is per-story/per-contact (TASK-311) and carries no email-log linkage —
// but when a donor-erasure flow lands it must call this in the same stroke, so the helper (and
// its test) ship with the table rather than being remembered later.
export async function eraseEmailLogFor(email: string): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM email_log WHERE recipient = lower($1)`, [email]);
  return rowCount ?? 0;
}
