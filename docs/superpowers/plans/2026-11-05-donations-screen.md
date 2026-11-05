# Admin > Donations, a clear gift log: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Admin > Donations becomes a day by day gift log in Head Elf HQ's look, every gift with a click
down of everything we know, more filters, and two new things recorded for new gifts: what brought the
person (QR code, email, search ...) and how they paid (Apple Pay, Visa ending 4242 ...).

**Spec:** `docs/superpowers/specs/2026-11-05-donations-screen-design.md` (read it first).

**Base:** branch `donations-redesign`, cut from `origin/task-591-head-elf-hq` (PR #716, Head Elf HQ, not
merged yet). Its Donations changes are the starting point: `listDonations` in `src/db/admin.ts` returns
gifts UNION ALL elf payments (`kind` "donation" | "elf", `elf_reference`, `elf_family_id`, `entry_pence`,
`gift_pence`; donor_id null on elf rows), ordered by created_at DESC; `?source=elf_school`; the
`elfSchool` sources line; `#donationsElfFilter`. Keep all of that working, including elf-hq.js's
"Every payment, in Donations" (ticks `#donationsElfFilter`, dispatches change, clicks the donations nav
link) and the hand-off button `data-elf-family` -> sessionStorage `nbcc_elf_hq_family` -> selectView("elf").

## Global constraints

- Express + TypeScript, node-pg-migrate (CommonJS), Vitest, Cucumber (CI only: there is NO local Postgres;
  SQL is proven by CI BDD). Windows, CRLF checkouts: edit with the Edit/Write tools or Python scripts that
  normalise `\r\n`, never sed for multi line edits, never heredocs for code.
- Migration: ONE additive file `migrations/1791200000370_donation-arrival-and-payment.js` (above 360),
  nullable columns only on `donations`.
- Recording arrival and payment details must never stop, delay or roll back a gift: write after the
  commit, best effort, errors only logged. No change to amounts, Gift Aid or claims.
- The repo is public: invented names and data in tests only (example.com).
- `test/unit/perf-budget.test.ts` caps donate.html's first paint (main.js + styles.css) at 262KB with
  about 150 bytes spare: add at most ~60 bytes to `assets/js/main.js` and nothing to `assets/css/styles.css`.
- Plain English in every word staff see, no dashes as punctuation, never "families" in public copy.
- Run only the affected unit tests locally (`npx vitest run <files>`), plus `npx tsc --noEmit -p .` and
  `npm run lint`. perf-budget and footer-master fail on Windows only (CRLF); say so, do not "fix" them.
- Commit per task with a message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Never push, never merge.

## Task 1: Record what brought someone to give

Files: `src/donations/arrival.ts` (new, pure), migration (above), `src/routes/api.ts` (checkout),
`src/db/stripe-webhook.ts` + `src/db/stripe-webhook-model.ts` (post-commit write), the five giving
scripts `assets/js/main.js`, `assets/js/red-bag.js`, `assets/js/ball-donate.js`, `assets/js/ball-bags.js`,
`assets/js/fundraiser.js`, `privacy.html`, tests `test/unit/donation-arrival.test.ts` (+ existing webhook
and checkout tests updated if needed).

- Migration columns on `donations`: `arrival_channel text` (qr | email | newsletter | search | social |
  other_websites | direct | site), `arrival_source text` (e.g. "Google", "facebook.com", or for `site` the
  path of our page they came from, e.g. "/get-involved"), `arrival_campaign text` (utm_campaign, e.g.
  "c12" for named QR code 12, "donate" for the page QR, an email kind), `given_on text` (the giving
  page's path, e.g. "/donate", "/fill", "/fundraise/sams-santa-dash"). Plus Task 2's columns in the same file:
  `pay_method text` (card | bacs_debit | card_present | bank_transfer | other), `pay_wallet text`
  (apple_pay | google_pay | link | samsung_pay | other, null for none), `card_brand text`, `card_last4
  text`, `card_country text`, `pay_checked_at timestamptz`. Index on arrival_channel and pay_method
  (partial, not null). Comment each column.
- `giftArrival(o: { givingPage: string | null; cameFrom: string | null; ownHosts: string[] }): { channel;
  source: string | null; campaign: string | null; givenOn: string | null } | null`. givingPage is the
  checkout request's `Referer` header (our page, with its query string); cameFrom is `document.referrer`
  sent by the page. utm tags are read from givingPage's query, else from cameFrom's query when cameFrom is
  our own site. Use `classifyArrival` from `src/analytics/channel.ts` (referrer = cameFrom); "internal"
  becomes channel "site" with source = cameFrom's path (no query); a cameFrom on stripe.com or a payment
  return path is not "site" but treated as no referrer. givenOn = givingPage's path (no query), only when
  givingPage is on our own hosts; trim every value to 100 characters. Returns null when the request has
  `DNT: 1` or `Sec-GPC: 1` (pass a `doNotTrack: boolean` in o). Own hosts: whatever the analytics code
  already uses (`ownSiteHosts` in `src/email/tracked-links.ts` or the analytics config); reuse, do not invent.
- Checkout: `checkoutBodySchema` accepts optional `cameFrom: string` (max 2000; never required, unknown
  stays dropped). `postCheckoutSession` computes the arrival from `req.get("referer")`, body.cameFrom,
  DNT/Sec-GPC headers and stamps metadata keys `arrChannel`, `arrSource`, `arrCampaign`, `givenOn` (only
  those present; Stripe values max 500 chars) into the session metadata built by `buildSessionParams`.
  Keep `buildSessionParams` pure: pass the arrival in as an argument.
- Webhook: after commit, for action `donation.created` only (first gift of a checkout), best effort with
  the same time limit pattern as `tagDonationSource`, run `UPDATE donations SET arrival_channel=$2,
  arrival_source=$3, arrival_campaign=$4, given_on=$5 WHERE stripe_session_id=$1 AND arrival_channel IS
  NULL` from the session metadata (pure mapper `arrivalFromCheckoutSession(session)` in
  stripe-webhook-model.ts). Monthly renewals copy nothing.
- Front end: each giving script adds `cameFrom: document.referrer` to the JSON body it POSTs to
  `/api/checkout-session` (main.js: smallest possible addition, measure bytes; others normally).
- privacy.html, "What we collect" list: add one item: "where you came from when you gave, such as one of
  our QR codes, an email or another website, and how you paid (for a card, only its type, country and
  last four digits, which our payment provider tells us);". Keep the footer untouched.
- Tests: giftArrival cases: QR landing on /donate (utm on givingPage) -> qr/c12; QR to home then Donate
  (utm on same-site cameFrom) -> qr; from /get-involved -> site, "/get-involved"; Google -> search/Google;
  facebook -> social/Facebook; newsletter -> newsletter; utm_medium=email -> email; no referrer -> direct;
  back from stripe.com -> direct; DNT -> null; foreign givingPage -> givenOn null; long values trimmed.
  Checkout: metadata carries the keys; DNT carries none. Webhook mapper reads them; the post-commit write
  happens only for donation.created and never throws.

## Task 2: Record how they paid

Files: `src/donations/pay-details.ts` (new, pure), `src/db/donation-pay-details.ts` (new),
`src/db/stripe-webhook.ts`, `src/db/invoices.ts`, tests `test/unit/donation-pay-details.test.ts`.

- `payDetailsFromCharge(charge: Stripe.Charge | null): PayDetails | null` with `PayDetails = { method:
  "card" | "bacs_debit" | "card_present" | "other"; wallet: string | null; brand: string | null; last4:
  string | null; country: string | null }` from `charge.payment_method_details` (type, card.brand,
  card.last4, card.country, card.wallet?.type, card_present.brand/last4/country). Never anything else.
- `fillPayDetails(donationId: number, deps?)`: reads the donation's stripe_payment_intent_id,
  stripe_charge_id, stripe_session_id; finds the charge (charge id -> `stripe.charges.retrieve`; payment
  intent -> `stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] })`; else session ->
  `stripe.checkout.sessions.retrieve(id, { expand: ["payment_intent.latest_charge"] })`); writes the five
  columns and `pay_checked_at = now()`; when nothing can be found still stamps pay_checked_at so it is not
  asked again. Never throws (returns null on error). Skips rows whose pay_method is already set.
- Webhook: after commit, fire and forget (not awaited, errors caught) `fillPayDetails` for a donation just
  created by checkout.session.completed (one off), for a renewal (invoice paid, it has a charge id), and
  set card_present details at once for an in-person gift from the event's charge (it is in the event).
- `settleInvoice` (src/db/invoices.ts): a transfer payment sets `pay_method = 'bank_transfer'` in its
  UPDATE of the new donation; a card payment leaves it for fillPayDetails (call it after commit in the
  invoice webhook's afterCommit, fire and forget).
- Tests: payDetailsFromCharge for card, Apple Pay, Google Pay, BACS, card present, null; fillPayDetails
  picks charge id, then payment intent, then session, writes once, stamps when not found, never throws.

## Task 3: The list API and a gift's details

Files: `src/db/admin.ts` (listDonations), `src/routes/admin.ts` (getAdminDonations), new
`src/db/donation-details.ts` + route `GET /api/admin/donations/:kind/:id/details` (kind donation | elf)
in a new `src/routes/admin-donation-details.ts` mounted in `src/app.ts`, tests.

- listDonations returns, per gift row, also: `fee_cover_pence`, `arrival_channel`, `arrival_source`,
  `arrival_campaign`, `given_on`, `pay_method`, `pay_wallet`, `card_brand`, `card_last4`,
  `fundraiser_title` + `fundraiser_slug` (LEFT JOIN fundraisers), `pledge_id` (LEFT JOIN sponsor_pledges ON
  donation_id), `invoice_id` (kept), `donor_type`, `business_name`. Elf rows return NULL for these.
- New filters (each validated against a fixed list; junk ignored, as source is): `q` (name or email,
  ILIKE, escaped, max 100), `from` / `to` (UK dates YYYY-MM-DD, inclusive, by created_at in
  Europe/London), `method` (card | apple_pay | google_pay | bacs_debit | bank_transfer | card_present),
  `came` (an arrival_channel value, or `unknown` for NULL), `giftAid` (yes | no), plus the existing
  status, channel, paymentStatus, mode, source. Also `source=donate_page` (source IS NULL, online, no
  fundraiser, no invoice) and `source=fundraiser` (fundraiser_id IS NOT NULL) and `source=card_reader`
  (payment_channel in_person). Elf rows: kept only when no method, came or giftAid filter is set, and q
  matches their name or email; from/to apply to them too. Keep `ORDER BY created_at DESC`.
- `getDonationDetails(kind, id)`: for a gift, everything in the spec's click down: the row's fields plus
  declaration summary (exists, scope, revoked), claim batch (id, status, submitted_at), refunds from
  audit_log (action names already used by the refund code: find them), the donor (name, email,
  email_consent, donor_type, business_name, billing address for a company), other gifts from the same
  email (count and total), fundraiser title + slug, pledge id, invoice number + link (linkFor from
  src/db/invoices.ts), a Stripe dashboard link (`https://dashboard.stripe.com/payments/<pi>` when there is a
  payment intent, else the charge), the arrival with a staff label: a named QR code's name (`c12` -> name
  from qr_codes) or a page QR's page title (reuse labelQrScans / SITE_PAGES from src/site/qr.ts). If
  pay_checked_at is NULL it calls fillPayDetails first (awaited, 3 second limit) and reads again. For an
  elf row: the elf row's fields and the family id for the HQ hand-off. Route needs donations: view.
- Tests: SQL shape and params for each filter (mock the pool, as test/unit/donations-mode-filter.test.ts
  does), elf rows kept/dropped by filter, the details route's auth (401/403), 404 for an unknown id, the
  lazy fill called only when pay_checked_at is NULL, QR naming.

## Task 4: The screen

Files: `admin.html` (#view-donations), new `assets/css/admin-donations.css` (linked in admin.html head
after admin.css; every selector starts `.gl-` or is `#view-donations`), new `assets/js/admin/gift-log.js`
(UMD like assets/js/admin/elf-hq.js, builds DOM with an el() helper, exports pure helpers for tests),
`assets/js/admin/app.js` (loadDonations hands over to the gift log; donationsTable stays for Overview and
Search), tests `test/unit/admin-gift-log.test.ts` (jsdom) and updates to pinned tests.

- Look: Head Elf HQ's values (assets/css/admin-elf-hq.css .hq-root tokens: ink #3A0B0B, maroon, crimson,
  holly, gold, cream, card #FFFDFA, 2.5px ink line, 3px 4px 0 ink pop shadow that presses to 1px 1px on
  :active, Playfair Display headings, 4pt spacing), no elf art, no side stripes, no gradient text, no
  modals, nothing scrolls inside a box, motion only under prefers-reduced-motion: no-preference and only
  transform/opacity. Phone first: cards stack; container query on the log.
- The scoreboard: one tile per sources line (from /api/admin/donations/source-totals) showing this month
  and all time; each tile is a `<label>` wrapping the EXISTING source checkbox (`#donationsRedBagFilter`,
  `#donationsBallFilter`, `#donationsBallBagsFilter`, `#donationsInvoiceFilter`, `#donationsElfFilter`) plus
  new ones for the Donate page, fundraiser pages and the card reader; ticking one unticks the others (keep
  oneSourceFilter). Pressed tile = ticked.
- The filter bar: search box, from and to dates, and selects: Type, Paid by, Came from, Gift Aid,
  Payment (keep `#donationsPaymentFilter` and `#donationsModeFilter` ids), Claim. Active filters as chips
  with a cross; "Clear all". Changing any filter goes back to page one.
- The log: day headings ("Today", "Yesterday", "Thursday 5 November" in UK time); one card per row: amount
  (large), donor name, time ("2:34pm"), a "given on" badge (Donate page, Fill a Red Bag, Festive Ball, Red
  bags at the Ball, the fundraiser's title, Invoice INV-0012, Card reader, Elf Detective School), a "paid
  by" badge (Apple Pay, Google Pay, Visa ending 4242, Direct Debit, Bank transfer, Card reader, or nothing
  when unknown), marks for Monthly, Gift Aid, and any payment state other than paid. Elf rows show their
  reference. Keep "Load more" or the existing pager (`#donationsPager`, Prev/Next, "1-25 of 120").
- The click down: the card is a button with aria-expanded; opening fetches the details once and shows the
  groups in the spec (The gift, How it was paid, Where it came from, Gift Aid, Refunds, The donor, Links:
  Open the donor, the fundraiser page, the invoice, Stripe, Open in Head Elf HQ). Unknowns for gifts before
  the recording started: "Not noted (we started noting this on 6 November 2026)".
- Keep: "Donations are unavailable." on failure and the 403 wording (test/unit/admin-could-not-load.test.ts),
  the Payment label words (H.paymentLabel), the New pills on new rows, the Overview and Search tables.
- Update on purpose, with a comment saying why, every test that pinned the old Donations table: list them
  (admin-app, admin-fits-a-phone, admin-red-bag, ball-donate-admin, admin-could-not-load, elf tests).

## Task 5: BDD, README, pictures, review, ship

- features/admin-donations-log.feature: a checkout with arrival tags -> the gift lists arrival_channel qr
  and given_on /donate; the details endpoint answers for a gift and for an elf payment; filters
  came=qr and method=bank_transfer find what they should; 401/403.
- README section "The Donations log (Admin > Giving > Donations)"; spec "As built".
- Pictures on a stand-in with invented data (laptop, phone, a click down, filters in use) to Jaimie.
- Fresh whole-branch review; fix; push; PR only after #716 has merged (merge main in first).
