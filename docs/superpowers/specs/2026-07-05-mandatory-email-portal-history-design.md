# Mandatory email + portal for all donors + history dashboard — design

- **Requirements:** revises REQ-039 (contact capture) and REQ-061 (self-serve portal)
- **Date:** 2026-07-05
- **Status:** approved, pre-implementation
- **Builds on:** TASK-123 (portal self-request route), which this partly supersedes

## Problem

Three linked gaps:

1. **Email is optional and consent-gated.** `donors.email` is stored only when the
   donor ticks marketing consent (REQ-039). Donors who skip it have no stored email,
   so we cannot send them a thank-you or a portal link.
2. **The portal only reaches subscription donors.** TASK-123's self-request route
   looks donors up via Stripe (subscription customers only); a one-off donor cannot
   get in.
3. **The portal shows no history.** A donor cannot see the donations they have made.

## Decisions

- **Email is mandatory and always stored.** The consent checkbox now means *marketing
  only*; it no longer gates storage. A thank-you/receipt is transactional and sends to
  every donor.
- **Enforcement is server-side** (plus the no-JS form gains a required email field), so
  every donor row has an email.
- **Identity = aggregate by email at read time.** No schema change. A donor who made N
  payments is N `donors` rows sharing an email; the portal sums donations across all
  rows with that email. The magic-link token targets the **newest** donor row (the
  canonical row for edits); the dashboard aggregates by that row's email.

## Part A — Mandatory email

- **`donate.html`** — individual `#donorEmail`: remove the "(optional)" span, add
  `required` + `aria-required="true"` + the `give-req` asterisk, mirroring the existing
  `#companyContactEmail` field. The `#emailConsent` checkbox stays; its copy already
  reads as a marketing opt-in ("NBCC can email me about my gift…").
- **`assets/js/main.js`** — the give widget blocks submit and surfaces the required
  state for the email field, matching how it already handles the company contact email.
- **`src/routes/api.ts`** — the checkout-session body: `email` becomes a valid, required
  address for the individual/partnership paths. Enforce with a `superRefine`: email
  required unless `donorType === "company"` (a company carries its own required
  `company.contactEmail`). A missing/invalid email → 400. This revises the no-JS base
  contract to include email.
- **`src/db/stripe-webhook-model.ts`** — in `donationFromCheckoutSession`, change
  `email: consented && md.email ? md.email : null` to always persist `md.email`.
  `emailConsent: consented` is unchanged (marketing only). The company branch is
  unchanged.
- **`confirmationEmailFor` (same file)** — drop the `donor.emailConsent !== true`
  condition; return the payload whenever `donor.email` is present. The thank-you now
  sends to every donor (transactional), not only consenting ones.

## Part B — Self-request keyed off stored email (all donors)

- **`src/db/portal.ts`** — add `findNewestDonorIdByEmail(email): Promise<number | null>`:
  case-insensitive match (`LOWER(email) = LOWER($1)`), newest row (`ORDER BY id DESC
  LIMIT 1`), or null.
- **`src/routes/portal.ts`** — `postRequestAccess` replaces the Stripe lookup
  (`findSubscriptionIdsByEmail` → `findDonorBySubscriptionIds`) with
  `findNewestDonorIdByEmail`. Match → `issuePortalAccessToken(donorId)` →
  `portalMagicLink` → `sendPortalMagicLink`. Unchanged: always the identical generic
  200 (no enumeration), 400 only on a malformed email, best-effort send, rate limiting.
  Now covers one-off donors.
- **Cleanup** — remove the now-unused `findSubscriptionIdsByEmail` export and its stub
  additions (`customers.list`, `subscriptions.list`) in `src/clients/stripe.ts`, the
  `test/unit/portal-stripe-lookup.test.ts` test, and `findDonorBySubscriptionIds` in
  `src/db/portal.ts` if no other caller remains. (The Stripe subscription *cancel* path
  is separate and stays.)

## Part C — History dashboard

- **`src/db/portal.ts`** — add `getDonorDonationHistory(email): Promise<{ totalPence:
  number; count: number; donations: Array<{ date: string; amountPence: number; mode:
  "once" | "monthly"; giftAid: boolean; status: string }> }>`. Aggregates all donations
  `JOIN donors ON donors.id = donations.donor_id WHERE LOWER(donors.email) =
  LOWER($1)`, newest first. `totalPence`/`count` computed over the same set. Excludes
  nothing by status here — the UI labels each row's status (a refund shows as such).
- **Portal GET snapshot (`getDonorPortalSnapshot` / route)** — extend the returned
  object with a `history` block from `getDonorDonationHistory`, resolved via the token's
  canonical donor row's email. The existing single-donor details + status fields are
  unchanged.
- **`portal.html` + `assets/js/main.js`** — render a donations table (date, amount,
  monthly/one-off, Gift Aid, status), the total donated, and the count, styled to match
  the existing portal sections.

## Edits & actions — MVP semantics (explicit)

The token targets the **newest** donor row. PATCH details, cancel Gift Aid, and cancel
subscription act on that canonical row exactly as today. Aggregation is a read-only
view by email. Changing email via the portal re-keys future aggregate reads (older
rows keep their historical email and drop out of the aggregate) — accepted for MVP.

## Error handling

- Donate: missing/invalid individual email → 400 (Zod), consistent with the existing
  company-email rejection.
- Self-request: unchanged — generic 200 for match/no-match/error; 400 only on malformed
  email.
- Portal read: a token whose canonical donor has no donations still returns a valid
  snapshot with an empty history (`count: 0`, `totalPence: 0`).

## Testing

- **Unit (Vitest, DB-free):**
  - api checkout schema: individual/partnership without email → fail; company without
    top-level email → pass; malformed email → fail.
  - `confirmationEmailFor`: returns a payload when email present and `emailConsent`
    false (no longer gated); returns null when email absent.
  - `donationFromCheckoutSession`: stores `email` when consent is false but an email was
    supplied.
- **BDD (`features/`):**
  - a one-off individual donation without an email → 400.
  - self-request for a one-off donor (stored email, no subscription) → generic 200 and a
    portal token is created.
  - unknown email → identical generic 200, no token (enumeration guard).
  - portal read for a donor with several donations shows the correct count and total.

## Out of scope

- Back-filling existing null-email donor rows.
- Deduping donor rows / a people-identity table (aggregate-by-email chosen instead).
- Per-row Gift Aid / subscription management across the aggregate (canonical row only).

## No-change confirmations

No migration (the `email` column already exists; we always populate it now). No new
config or secret. `/health` untouched. `SPEC.md` is generated from the requirement log —
the REQ-039 / REQ-061 text updates happen on the board, not by hand-editing SPEC.md.
