# Donor-portal self-request route — design

- **Requirement:** REQ-061 (self-serve donor portal)
- **Date:** 2026-07-05
- **Status:** approved, pre-implementation

## Problem

The donor portal (REQ-061) is fully built on the **consume** side: `portal.html` +
`/api/portal/:token` authenticate a one-time magic-link token and let a donor edit
details, cancel Gift Aid, and cancel a subscription. The **issue** side was never
wired — `issuePortalAccessToken` and `sendPortalMagicLink` are called only by tests.
No donor can obtain a link, so the portal is unreachable in practice.

### Why email lookup is not trivial

`donors.email` is stored **only when the donor ticked marketing consent** at donation
time (REQ-039, `stripe-webhook-model.ts`): a monthly donor who typed an email but did
not opt into marketing lands as an **email-less donor row**. So "look the donor up in
our DB by email" misses exactly the population that most needs the portal
(subscription donors). It is also non-unique — one email maps to many donor rows.

Stripe, however, always holds the customer email for a subscription (visible in the
dashboard Customer column). A portal-access link is **transactional, not marketing**,
so sending it to the Stripe email is legitimate without the marketing-consent gate —
the same reasoning the code already uses for the company billing-contact email.

## Approach

Self-request keyed off the **Stripe customer email**, scoped to **subscription
donors** (the target population; one-off-only donors are out of scope).

No name-matching: the magic link is itself the proof of inbox ownership. Requiring the
typed name to equal the email owner would falsely reject legitimate donors
(`paul.popa1995@yahoo.ro` etc.) for no real security gain.

## Route

`POST /api/portal/request`, body `{ email }`. Public. Mounted in `src/app.ts` after
`express.json`, alongside the existing `portalRouter`.

### Flow

1. Zod-validate `{ email: z.string().trim().email() }`. Malformed → `400`.
2. Rate-limit (per-email **and** per-IP). Over limit → generic `200` (do not reveal
   the limit).
3. Stripe lookup: `customers.list({ email })` → for each customer
   `subscriptions.list({ customer, status: 'all' })` → collect subscription ids.
4. Map subscription id → our donor row via stored `donations.stripe_subscription_id`
   → `donor_id` (newest match wins if several).
5. On a match: `issuePortalAccessToken(donorId)` →
   `portalMagicLink(PORTAL_BASE_URL, token)` →
   `sendPortalMagicLink({ to: <Stripe email>, link })`. Best-effort send: a provider
   failure is logged, never surfaced (mirrors existing post-commit email calls).
6. **Always** respond `200 { message: "If that email matches a supporter, we've sent a
   portal link." }` — identical body for match / no-match / send-failure. No
   enumeration.

## Units

- `src/clients/stripe.ts` — add `findSubscriptionIdsByEmail(email): Promise<string[]>`
  (real SDK: `customers.list` + `subscriptions.list`). Extend the offline **stub** so
  local dev + CI/BDD run without a live Stripe account. Depends on: Stripe SDK.
- `src/db/portal.ts` — add `findDonorIdBySubscriptionIds(subIds): Promise<number | null>`
  returning the newest matching `donor_id`. Depends on: the pool, `donations` table.
- `src/portal/request-limiter.ts` — pure, in-memory sliding-window limiter (DB-free,
  no clock global; `now` injected). Depends on: nothing. Per-task state — acceptable
  for the single Fargate task; note in README to revisit if scaled out.
- `src/routes/portal.ts` — add `postRequestAccess` handler + `portalRouter.post(...)`
  line. Orchestrates the units above; contains no lookup logic itself.

## Error handling

- Malformed body → `400` (the only non-200 for a well-formed request).
- Stripe error, no match, or send failure → logged, generic `200`. The route never
  leaks whether an email is a known supporter.

## Testing

- **Unit (Vitest, DB-free):**
  - `request-limiter`: allows under the cap, denies over it, resets after the window
    (inject `now`).
  - request-body schema: valid email passes; malformed / missing → failure.
  - `portalMagicLink` URL building is already covered.
- **BDD (`features/portal.feature`):**
  - valid email with a stubbed subscription → `200` + generic message.
  - unknown email → **same** `200` + **byte-identical** generic message (enumeration
    guard, asserted explicitly).
  - malformed email → `400`.

## Out of scope (explicit follow-ups)

- One-off-only donors (no subscription) obtaining a link.
- Making email mandatory on the donate form.
- Storing donor email regardless of marketing consent for operational access.
- A durable/distributed rate limiter (current one is per-task in-memory).

## No-change confirmations

No new config value, secret, or migration. Reuses `PORTAL_BASE_URL`,
`issuePortalAccessToken`, `sendPortalMagicLink`, and the existing Stripe client.
