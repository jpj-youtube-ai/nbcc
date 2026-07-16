# Newsletter email stats (Phase 1: delivery truth) — design

Date: 2026-07-16 · Approved by: Jaimie (in-session) · Tasks: TASK-255 (events backend), TASK-256 (dashboard UI)

## Goal

Per-newsletter stats an admin can trust: **Sent → Delivered → Bounced → Marked-as-spam → Unsubscribed**,
with rates and the bounced addresses (for list cleaning). Phase 1 changes **nothing** about how any
email looks — no tracking pixel, no rewritten links, no per-donor tracking.

## What is honestly measurable (and what is not)

Our relay (`services/email-relay`) sends via **Resend**. Resend emits signed webhook events per email:
`email.delivered`, `email.bounced`, `email.complained` (recipient marked it spam). Those are real,
per-address facts. **Silent junk-folder placement is not measurable by anyone** — the dashboard never
claims a "junk rate"; complaints + bounces are the honest proxies. Opens/clicks are Phase 2 only,
because Resend's tracking toggle is domain-wide and would put a pixel + rewritten links in Gift Aid
receipts; Phase 2 uses a newsletter-only sending subdomain (user decision deferred).

## Architecture (Phase 1)

```
Resend ──signed webhook──▶ POST /api/webhooks/resend      (public; Svix-signature verified)
                               │ verify signature (RESEND_WEBHOOK_SECRET, timing-safe, ±5 min)
                               │ parse {type, to, created_at, svix-id}
                               ▼
                     match to newsletter_sends by (email, sent_at ≤ t, within 14 days)
                        │ matched → INSERT newsletter_email_events (idempotent on svix id)
                        └ unmatched → 200, DROP (receipts/login codes: no warehousing)
```

- **`newsletter_sends`** (new table): one row per accepted recipient per send — `newsletter_id`,
  `donor_id` (SET NULL), `email`, `sent_at`. Written best-effort as a batch after the existing send
  loop; a failure never fails the send. This is both the correlation target and the denominator.
- **`newsletter_email_events`** (new table): `svix_event_id` (partial UNIQUE where not null — Resend
  retries; retries can't double-count), `newsletter_id`, `email`, `event_type`
  CHECK ∈ {delivered, bounced, complained, unsubscribed}, `occurred_at`, `detail` jsonb (bounce
  reason). Unsubscribes are our own events (`svix_event_id` NULL).
- **Unsubscribe attribution**: token v2 `donorId.newsletterId.sig` alongside legacy `donorId.sig`;
  the verifier accepts both **forever** (already-sent emails must keep working). The unsubscribe route
  records an `unsubscribed` event (newsletter_id null on legacy links), best-effort.
- **Stats endpoint**: `GET /api/admin/newsletters/:id/stats` (Editor+, matching the tab) returns
  aggregate counts (DISTINCT email per type) + `bouncedEmails[]`. **Aggregates only** — no
  "who opened what" view exists, on purpose (charity privacy posture).
- **Redaction coherence (extends TASK-252)**: redacting a sent newsletter ALSO deletes its
  `newsletter_sends` + `newsletter_email_events` rows in the same transaction — they hold donor
  addresses, the same class of data as `failed_emails`. The stub keeps the headline counts.
- **Config**: `RESEND_WEBHOOK_SECRET` through the full golden-rule-3 chain (schema, `.env.example`,
  SSM param, task-def secrets, `exec_secrets` IAM, `pr.yml` env). Empty secret ⇒ endpoint answers 503
  (deployable before the user configures Resend).

## Dashboard (TASK-256)

In the Newsletter tab, an open **sent** newsletter shows a stats strip: Delivered / Bounced / Spam /
Unsubscribed with rates over accepted sends, plus the bounced addresses. Sends predating the feature
(no `newsletter_sends` rows) show "No delivery data (sent before tracking)" — never fake zeros.
Redacted newsletters show only the kept stub. Pure rate/format helpers in `admin/helpers.js`
(unit-tested), queries in the db layer, render in `app.js` — the established admin pattern.

## User setup (one-time, after TASK-255 deploys)

Resend dashboard → Webhooks → add `https://nbcc.scot/api/webhooks/resend`, tick
delivered / bounced / complained, copy the `whsec_…` signing secret to me for SSM. Staging first with
the staging URL. Stats accrue from switch-on; Resend does not back-report.

## Testing

Unit: Svix verification vectors (valid/garbled/stale/wrong-secret), token v2 + legacy verify, event
insert idempotency, correlation + stats SQL shapes (mocked pool), redaction cascade. BDD: signed
webhook round trip (send → delivered event → stats reflect it), bad signature rejected, v2 unsubscribe
attributed. CI gets a test `RESEND_WEBHOOK_SECRET` in `pr.yml`.

## Explicitly out of scope (Phase 2, needs user DNS + relay deploy)

Opens/clicks via `updates.nbcc.scot` sending subdomain with tracking enabled; per-donor engagement
views; back-filling historical sends.
