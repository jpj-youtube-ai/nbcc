# Design: end-to-end donation journey BDD

Date: 2026-07-04
Status: approved

## Problem

Donation is the highest-consequence path in the service and the most plausible
breaking point. Today it is covered by three BDD features that each test one
slice in isolation:

- `features/checkout.feature` — `POST /api/checkout-session` payload validation
  and the returned `{ url }`.
- `features/stripe-webhook.feature` — the webhook persisting `donations` /
  `donors` / `declarations` rows.
- `features/gift-aid.feature` — token-scoped declaration completion.

The two halves that make up a real donation (endpoint → webhook) are exercised
with **independently hand-authored metadata**. A drift between the metadata
`buildSessionParams` stamps and the keys the webhook reads would pass both
suites. Nothing walks a donor end to end across every option the donate page
offers.

## Goal

One BDD feature that walks each donor persona through the whole server-side
journey — `POST /api/checkout-session` → the signed `checkout.session.completed`
Stripe would fire → the resulting DB state — covering the full matrix of
donation options. Stripe is the offline stub; no live account, no network.

Out of scope: a headless browser driving `donate.html`. Cucumber here hits HTTP
endpoints on `BASE_URL`, not the browser; the give-widget JS in
`assets/js/main.js` is not driven by BDD and stays as-is. This design tests the
server journey — the true breaking surface (payload → Stripe → DB).

## The seam

`POST /api/checkout-session` returns only `{ url }`, so the chain cannot see the
metadata `buildSessionParams` stamped. Stripe's real behaviour is that after
Checkout completes it posts your **session object back** — including your
metadata — inside `checkout.session.completed`. We mirror that faithfully.

**Change (`src/routes/api.ts`, additive + strictly guarded):** when the offline
stub is active, attach a `session` field to the 200 response body:

```ts
const body: { url: string | null; session?: {...} } = { url: session.url };
if (!stripeConfigured && config.NODE_ENV !== "production") {
  body.session = { id: session.id, metadata: params.metadata, mode: params.mode };
}
return res.status(200).json(body);
```

- Guarded by `!stripeConfigured && NODE_ENV !== "production"`. Production
  **never** stubs (see `src/clients/stripe.ts`), so the production response is
  byte-identical to today.
- Purely additive: the frontend (`startCheckout`) reads only `url`, so the extra
  field is ignored everywhere it already runs.
- `stripeConfigured` is already exported from `src/clients/stripe.ts`; import it
  alongside the existing `stripe` import.
- Keeps the Cucumber step process pure HTTP + `pg` (its current shape) — no
  importing TS, no new route, no new mount.

## The journey (per scenario)

1. `POST /api/checkout-session` with the persona payload → assert `200` and
   capture `response.session.metadata` (and `.mode`).
2. Build a `checkout.session.completed` event whose `data.object` is that
   captured session, plus the fields a real completion adds Stripe-side:
   `payment_intent` (unique `pi_journey_*`), `amount_total`, `currency: "gbp"`,
   and `payment_status`. Sign it with `STRIPE_WEBHOOK_SECRET` via the SDK's
   offline `generateTestHeaderString` (same mechanism as
   `stripe-webhook.steps.js`) → `POST /api/stripe/webhook`.
3. Assert the resulting `donations` / `donors` / `declarations` rows.

Payment-side fields (`payment_intent`, `amount_total`, `payment_status`) are
Stripe's at completion, not ours at creation, so the step supplies them — that
is faithful, not a shortcut. The metadata is captured, never re-authored.

## New files & step defs

- `features/donation-journey.feature` — tagged `@db @donation-journey`.
- `features/steps/donation-journey.steps.js`:
  - A `When` that POSTs a persona payload, captures the echoed session, then
    posts the signed completion webhook with injected payment fields. The
    persona payload and the payment fields come from the feature via docstrings.
  - A `Before({ tags: "@donation-journey" })` cleanup mirroring the
    `@stripe-webhook` hook: delete `pi_journey_%` / `sub_journey_%` donations in
    FK order (partner shares → donations → declarations → donors), capturing donor
    ids from the donations first so anonymous / partnership donors are reached.
  - New `Then` assertions not already provided by `stripe-webhook.steps.js`:
    declaration scope, wording version, non-UK blank postcode, donor anonymous
    flag, partnership share count + sum, subscription-keyed gift aid + scope.
  - Reuses the existing payment-intent-keyed `Then` steps (amount, gift aid,
    claim status, linked declaration, donor type, business name, audit row).

## Persona matrix

Full journey (endpoint → webhook → DB), each a scenario with unique `pi_journey_*`:

1. Individual, once, Gift Aid, UK, `this_donation` scope → claimable, linked
   declaration, postcode stored.
2. Individual, once, Gift Aid, **non-UK** → linked declaration, **blank**
   postcode.
3. Individual, once, **no** Gift Aid, **anonymous** → donor `anonymous=true`,
   not eligible.
4. Individual, **monthly**, Gift Aid, `enduring` scope (`all_donations`),
   age-confirmed; a later `invoice.paid` books a further donation.
5. Company, once, consideration **not** given → `donor_type=company`,
   `gift_aid=false`, `claim_status=not_eligible`, business name stored.
6. Company, once, consideration **given** → `donation.flagged_for_trustees`
   audit row (no receipt).
7. **Partnership**, once, Gift Aid, 2 partners with shares summing to amount →
   2 partner-share rows summing to the amount.
8. **BACS**: complete with `payment_status: unpaid` → `not_eligible`; then
   `async_payment_succeeded` → `eligible` (same donation).

Endpoint-only rejects (assert `400`, no webhook): partnership shares that do not
sum (new). Monthly-without-age, company-asserting-Gift-Aid, and
company-missing-details are already covered by `checkout.feature`.

## Testing / verification

- `npm run lint && npm run build && npm run test:unit` green.
- Boot the app against the local dev DB (`nbcc-db` on :5435), run
  `npm run test:bdd` locally; confirm the new feature and all existing features
  stay green. Journey rows are cleared between runs via the cleanup hook.

## Workflow notes

- Branch `task-116-donation-journey-bdd`, PR title `[TASK-116] ...`, driven to a
  green `pr.yml` and self-merged (per CLAUDE.md PR workflow).
</content>
