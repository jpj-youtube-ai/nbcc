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
    `INSERT INTO newsletter_email_events (svix_event_id, newsletter_id, email, event_type, occurred_at, detail, link_url)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7)
     ON CONFLICT (svix_event_id) WHERE svix_event_id IS NOT NULL DO NOTHING`,
    [
      svixEventId,
      newsletterId,
      event.email,
      event.eventType,
      occurredAtIso,
      event.detail ? JSON.stringify(event.detail) : null,
      event.linkUrl, // TASK-257: which link a click was for; null on everything else
    ],
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

// TASK-259: the subscriber-side twin of recordUnsubscribeEvent — a list subscriber has no donor row,
// but their address is known from the membership the unsubscribe just tombstoned. Same best-effort
// contract at the caller.
export async function recordUnsubscribeEventForEmail(newsletterId: number, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO newsletter_email_events (svix_event_id, newsletter_id, email, event_type, occurred_at)
     VALUES (NULL, $1, lower($2), 'unsubscribed', now())`,
    [newsletterId, email],
  );
}

export interface NewsletterLinkStat {
  link: string;
  uniqueClicks: number; // distinct people — the honest headline
  totalClicks: number; // raw clicks, alongside (one keen reader can click five times)
}

export interface NewsletterStats {
  sends: number; // accepted recipients recorded for this newsletter (the rate denominator)
  delivered: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  // TASK-257 (Phase 2): zero until tracking is enabled on the newsletter sending domain. Opens are
  // approximate by nature (Apple Mail prefetches; image-blocking undercounts) — the UI says so.
  opened: number;
  clicked: number;
  links: NewsletterLinkStat[];
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
  // Per-link clicks (TASK-257). Unsubscribe links are EXCLUDED: every recipient's unsubscribe URL is
  // tokenised per person, so they would drown the table in one-click rows of donor-identifying URLs —
  // and unsubscribes are already counted honestly by our own endpoint's events. Unique people lead
  // (one keen reader can click five times); capped, the dashboard is not a log viewer.
  const links = await pool.query(
    `SELECT link_url, count(DISTINCT email) AS unique_clicks, count(*) AS total_clicks
       FROM newsletter_email_events
      WHERE newsletter_id = $1 AND event_type = 'clicked'
        AND link_url IS NOT NULL AND link_url NOT LIKE '%/unsubscribe/%'
      GROUP BY link_url
      ORDER BY unique_clicks DESC, total_clicks DESC
      LIMIT 50`,
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
    opened: byType.get("opened")?.n ?? 0,
    clicked: byType.get("clicked")?.n ?? 0,
    links: links.rows.map((r) => ({
      link: r.link_url,
      uniqueClicks: Number(r.unique_clicks),
      totalClicks: Number(r.total_clicks),
    })),
    bouncedEmails: byType.get("bounced")?.emails ?? [],
  };
}
