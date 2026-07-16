import { pool } from "./pool";
import type { ParsedResendEvent } from "../newsletter/resend-events";

// TASK-255: the delivery-facts store behind the email stats dashboard (Phase 1 — see
// docs/superpowers/specs/2026-07-16-newsletter-email-stats-design.md). Two tables:
//   newsletter_sends        — one row per ACCEPTED recipient per send (correlation target + honest
//                             rate denominator);
//   newsletter_email_events — per-address facts: Resend's delivered/bounced/complained plus our own
//                             unsubscribed events.
// Single-statement writes over the pool, mirroring src/db/newsletters.ts.

// Batch-record who a newsletter was accepted for — ONE statement however many donors (the send loop
// already made N relay calls; the bookkeeping shouldn't add N more round trips). Addresses stored
// lowercased because correlation compares lowercased. Callers treat this as best-effort: recording
// failing must never fail a send that already happened.
export async function recordNewsletterSends(
  newsletterId: number,
  recipients: { donorId: number | null; email: string }[],
): Promise<void> {
  if (recipients.length === 0) return;
  await pool.query(
    `INSERT INTO newsletter_sends (newsletter_id, donor_id, email)
     SELECT $1, d, lower(e) FROM unnest($2::int[], $3::text[]) AS t(d, e)`,
    [newsletterId, recipients.map((r) => r.donorId), recipients.map((r) => r.email.toLowerCase())],
  );
}

export type ResendEventOutcome = "recorded" | "unmatched" | "duplicate";

// Ingest one verified webhook event. Resend reports per ADDRESS, not per newsletter, so first find
// the newest send to that address: sent no later than ~10 minutes after the event (clock skew) and no
// more than 14 days before it (events beyond that window are not ours to claim). No match means the
// email was a receipt / login code / anything else on the domain → the caller acknowledges and DROPS
// it: we do not warehouse data about mail the dashboard has no use for.
//
// The insert is idempotent on the Svix id (partial unique index): Resend retries deliveries until
// acknowledged, and a retry must report "duplicate", never a second row — rates are counted off these
// rows, so one duplicate would silently inflate every percentage.
export async function recordResendEvent(
  svixEventId: string,
  event: ParsedResendEvent,
): Promise<ResendEventOutcome> {
  const occurredAtIso = event.occurredAt.toISOString();
  const match = await pool.query(
    `SELECT newsletter_id FROM newsletter_sends
      WHERE email = $1
        AND sent_at <= $2::timestamptz + interval '10 minutes'
        AND sent_at > $2::timestamptz - interval '14 days'
      ORDER BY sent_at DESC
      LIMIT 1`,
    [event.email, occurredAtIso],
  );
  const newsletterId = match.rows[0]?.newsletter_id;
  if (newsletterId == null) return "unmatched";

  const { rowCount } = await pool.query(
    `INSERT INTO newsletter_email_events (svix_event_id, newsletter_id, email, event_type, occurred_at, detail)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
     ON CONFLICT (svix_event_id) WHERE svix_event_id IS NOT NULL DO NOTHING`,
    [svixEventId, newsletterId, event.email, event.eventType, occurredAtIso, event.detail ? JSON.stringify(event.detail) : null],
  );
  return (rowCount ?? 0) > 0 ? "recorded" : "duplicate";
}

// Our own event: a donor used a v2 unsubscribe link, which names the newsletter it was printed in.
// The address is resolved FROM the donor row in the same statement — the route holds only ids, and a
// donor with no email on file simply records nothing. Best-effort at the caller: the unsubscribe
// itself must never fail because its bookkeeping did.
export async function recordUnsubscribeEvent(newsletterId: number, donorId: number): Promise<void> {
  await pool.query(
    `INSERT INTO newsletter_email_events (svix_event_id, newsletter_id, email, event_type, occurred_at)
     SELECT NULL, $1, lower(email), 'unsubscribed', now()
       FROM donors WHERE id = $2 AND email IS NOT NULL`,
    [newsletterId, donorId],
  );
}

export interface NewsletterStats {
  sends: number; // accepted recipients recorded for this newsletter (the rate denominator)
  delivered: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  bouncedEmails: string[]; // the actual dead addresses, for list cleaning
}

// Aggregates ONLY — the dashboard shows "139 delivered", never "who opened what" (charity privacy
// posture; the spec makes this a deliberate wall). DISTINCT addresses per type, so even a hypothetical
// duplicate row could not inflate a rate.
export async function getNewsletterStats(newsletterId: number): Promise<NewsletterStats> {
  const sends = await pool.query(`SELECT count(*) AS sends FROM newsletter_sends WHERE newsletter_id = $1`, [
    newsletterId,
  ]);
  const events = await pool.query(
    `SELECT event_type, count(DISTINCT email) AS n,
            CASE WHEN event_type = 'bounced' THEN array_agg(DISTINCT email) END AS emails
       FROM newsletter_email_events
      WHERE newsletter_id = $1
      GROUP BY event_type`,
    [newsletterId],
  );
  const byType = new Map<string, { n: number; emails: string[] | null }>(
    events.rows.map((r) => [r.event_type, { n: Number(r.n), emails: r.emails ?? null }]),
  );
  return {
    sends: Number(sends.rows[0]?.sends ?? 0),
    delivered: byType.get("delivered")?.n ?? 0,
    bounced: byType.get("bounced")?.n ?? 0,
    complained: byType.get("complained")?.n ?? 0,
    unsubscribed: byType.get("unsubscribed")?.n ?? 0,
    bouncedEmails: byType.get("bounced")?.emails ?? [],
  };
}
