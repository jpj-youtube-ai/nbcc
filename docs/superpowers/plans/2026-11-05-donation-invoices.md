# Invoices for donations: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** staff send an invoice from Admin > Giving > Invoices; the person pays by card or bank transfer from a private invoice page; a paid invoice becomes one normal donation labelled "Invoice INV-0012".

**Architecture:** pure rules, page, emails and checkout params in `src/invoices/`; storage and the one settle path (shared by card and bank transfer) in `src/db/invoices.ts`; admin and public routes in `src/routes/invoices.ts`; the Stripe webhook hands sessions tagged `product: "donation_invoice"` to `handleInvoiceEvent` before anything else sees them.

**Tech stack:** Express + TypeScript, Postgres (node-pg-migrate), zod, Stripe Checkout, Vitest (+ jsdom for the admin screen), Cucumber.

**Spec:** `docs/superpowers/specs/2026-11-05-donation-invoices-design.md`

## Global constraints

- Plain English in every word a person sees; no dashes as punctuation in copy; never "families".
- The charity: `CHARITY_NAME` "Night Before Christmas Campaign" (NBCC), `OSCR_NUMBER` SC047995 (`src/legal/registration.ts`). Emails use `ABOUT_NBCC_SHORT` exactly.
- Amount: 100 to 5,000,000 pence (£1 to £50,000). What it's for: 1 to 120 characters, starts "Donation to NBCC". Note: up to 500. Name, business or group name: up to 120. Due date: today or later, default today + 30 days (UK date).
- Invoice number: `INV-` + id padded to 4 digits (`INV-0012`, `INV-12345` beyond 9999). It is the bank transfer reference.
- Token purpose string `donation-invoice:<id>`, HMAC with `config.ADMIN_SESSION_SECRET` (never the Ball's `invoice:`).
- Permissions: section `donations`; view sees, edit sends / emails again / marks paid / cancels / changes bank details.
- Payer kinds: `person`, `business`, `group`. Donor type in `donations`/`donors`: person = `individual`; business and group = `company` (never Gift Aid, claim status `not_eligible`).
- Donation `source = 'invoice'` and new nullable `donations.invoice_id`. `payment_channel = 'online'`, `payment_status = 'paid'`, `gasds_eligible = false`, `mode = 'once'`.
- Emails: the invoice email and the group receipt from `config.MAIL_FROM` with `replyTo: config.GIVING_FROM_EMAIL`; staff "paid twice" note to `config.GIVING_FROM_EMAIL`. Links from `config.PORTAL_BASE_URL`.
- Migrations additive only, numbered above the newest on main (currently 320): `1791200000330_donation-invoices.js`. Re-check order against main right before merging.
- Repo is public: invented names and addresses only in tests and pictures.

## Review focus

1. A Stripe event for an invoice delivered twice, or Mark paid racing a card payment: exactly one donation per payment, the second real payment recorded and flagged, never lost. (Task 3 tests.)
2. A business or group invoice with Gift Aid details posted to its page by hand: refused; no declaration ever stored or used. (Task 3 and 4 tests.)
3. A token for another invoice id, a Ball invoice token, or a tampered token: 404, nothing shown. (Task 1 and 4 tests.)
4. Pay pressed on a paid or cancelled invoice (stale page): no Stripe session made; the page is shown again with its state. (Task 4 test.)
5. Amount typed as "£1,250.50", "1250.5", "0", "abc" or above £50,000 in the admin form: the first two accepted as 125050 pence, the rest refused with a field message. (Task 1 test.)

---

### Task 1: Pure rules, token, page, emails and checkout params (`src/invoices/`)

**Files:** create `src/invoices/model.ts`, `src/invoices/token.ts`, `src/invoices/page.ts`, `src/invoices/emails.ts`, `src/invoices/checkout.ts`; tests `test/unit/invoices-model.test.ts`, `test/unit/invoices-page.test.ts`, `test/unit/invoices-emails.test.ts`.

**Produces:**
- `model.ts`: `PAYER_KINDS = ["person","business","group"] as const`, `type PayerKind`; `invoiceNumber(id: number): string`; `parseAmountPence(raw: unknown): number | null` (accepts "1,250.50", "£50", 50; at most 2 decimals); `invoiceInputSchema` and `parseInvoiceInput(body: unknown, today: string): { ok: true; value: InvoiceInput } | { ok: false; field: string; error: string }` where `InvoiceInput = { payerKind; contactName; orgName: string|null; email; address: string|null; postcode: string|null; considerationGiven: boolean|null; description; note: string|null; amountPence; dueOn: string }` (orgName required for business/group; address and a valid UK postcode required for business/group, optional for a person but a postcode, when given, must be valid; considerationGiven required true/false for a business, null otherwise); `DEFAULT_DESCRIPTION = "Donation to NBCC"`; `defaultDueOn(today: string): string` (+30 days); `type InvoiceStatus = "waiting"|"paid"|"cancelled"`; `displayState(inv: { status; dueOn; cancelledAt: string|null }, today: string): "waiting"|"overdue"|"paid"|"cancelled"|"paid-after-cancel"`; `bankSettingsSchema` reused from `src/ball/transfer.ts` (`bankDetailsSchema`).
- `token.ts`: `signDonationInvoiceToken(id: number, secret: string): string`, `verifyDonationInvoiceToken(token: string, secret: string): number` (throws).
- `page.ts`: `renderDonationInvoicePage(data: InvoicePageData): string` with `InvoicePageData = { number; token; issuedOn; dueOn; state: ReturnType<typeof displayState>; paidOn: string|null; paidBy: "card"|"transfer"|null; payerKind; contactName; orgName; address; postcode; description; note; amountPence; bank: BankDetails|null; giftAid: DeclarationFields|null; justPaid: boolean; message: string|null }`. Same look as `src/ball/invoice-page.ts` (inline style, print button, A4 print). Forms post (urlencoded) to `/invoice/<token>/pay` and `/invoice/<token>/gift-aid`. The Gift Aid box only for a person while waiting, with `SINGLE_DONATION_WORDING` text. `justPaid` shows "Thank you. Your payment is being confirmed and this page will say Paid shortly."
- `emails.ts`: `buildInvoiceEmail(o: { number; contactName; orgName; amountPence; description; note; dueOn; link }): { subject; html; text }` (subject `Your invoice from NBCC: INV-0012`, `ABOUT_NBCC_SHORT`, button "View and pay your invoice", `questionsBox`); `buildGroupReceiptEmail(o: { number; orgName; contactName; amountPence; paidOn; link; reference }): { subject; html; text }` (subject `Thank you: invoice INV-0012 is paid`); `buildInvoicesPaidTwiceNote(rows: { number; orgOrName; amountPence }[]): { subject; lines: string[] }`; `invoiceLink(token: string, base: string): string`.
- `checkout.ts`: `buildInvoiceSessionParams(o: { invoiceId; number; amountPence; description; email; baseUrl; token; now?: Date }): Stripe.Checkout.SessionCreateParams` (`mode:"payment"`, `payment_method_types:["card"]`, one line item, `customer_email`, `metadata` and `payment_intent_data.metadata` `{ product: "donation_invoice", invoiceId: String(id) }`, success `…/invoice/<token>?paid=1`, cancel `…/invoice/<token>`, `expires_at` now + 30 min).

- [ ] Write failing tests: number padding; amount parsing (Review focus 5); each field error; business needs considerationGiven and address+postcode; group needs orgName; displayState overdue only when waiting and dueOn < today, paid-after-cancel; token round trip, another id's token and a Ball `signInvoiceToken` token fail; page shows Paid stamp and no forms once paid, "cancelled" and no bank details once cancelled, Gift Aid box only for a waiting person, bank block only with bank details, everything escaped; emails carry the exact subject, short description, button link, note when given; session params carry the metadata, amount and urls.
- [ ] Run `npx vitest run test/unit/invoices-*.test.ts`: fail.
- [ ] Implement.
- [ ] Run again: pass. `npm run lint`, `npx tsc --noEmit`.
- [ ] Commit `Invoices: rules, private link, page, emails and checkout`.

### Task 2: Migration and storage (`src/db/invoices.ts`)

**Files:** create `migrations/1791200000330_donation-invoices.js`, `src/db/invoices.ts`; modify `test/unit/backup-plan.test.ts` (99 → 101 and its history comment); test `test/unit/invoices-migration.test.ts`.

Migration: `donation_invoices` (id serial pk; payer_kind text check in kinds; contact_name, org_name, email, address, postcode, description, note text; consideration_given boolean; amount_pence int check 100..5000000; issued_on date; due_on date; status text default 'waiting' check in statuses; paid_on date; paid_by text check in ('card','transfer'); cancelled_at timestamptz; paid_twice_at timestamptz; paid_twice_alerted_at timestamptz; gift_aid jsonb; gift_aid_at timestamptz; donation_id int references donations; last_sent_at timestamptz; send_count int default 0; created_by, created_at default now, updated_by, updated_at), index on status; `donation_invoice_settings` (id int pk check id = 1, account_name, sort_code, account_number text, updated_by, updated_at); `donations.invoice_id` int references donation_invoices, nullable, partial index where not null.

**Produces (db):** `listInvoices(): Promise<InvoiceRow[]>`; `getInvoice(id): Promise<InvoiceRow|null>`; `createInvoice(input: InvoiceInput, issuedOn: string, actor: string): Promise<InvoiceRow>` (writeWithAudit `invoice.created`); `markSent(id, actor): Promise<void>` (audit `invoice.sent`); `cancelInvoice(id, actor): Promise<InvoiceRow|null>` (only from waiting; audit `invoice.cancelled`); `saveGiftAid(id, fields: DeclarationFields|null): Promise<"saved"|"not-person"|"not-waiting"|"missing">`; `getInvoiceSettings(): Promise<BankDetails|null>`; `saveInvoiceSettings(bank: BankDetails|null, actor): Promise<void>` (audit `invoice_settings.updated`); `invoiceDonationLabels` not needed (the donations list joins). `InvoiceRow` is camelCase of the table.

- [ ] Failing migration test (tables, checks, the donations column, nothing dropped) and backup count 101.
- [ ] Implement migration and db functions (no DB locally: SQL proven in CI BDD).
- [ ] `npx vitest run test/unit/invoices-migration.test.ts test/unit/backup-plan.test.ts`: pass. Commit `Invoices: tables and storage`.

### Task 3: Settling a payment (card and bank transfer) and receipts

**Files:** create `src/invoices/settle.ts` (pure decisions), add `settleInvoice` to `src/db/invoices.ts`, create `src/invoices/webhook.ts` (`handleInvoiceEvent`), modify `src/db/stripe-webhook.ts` (dispatch it first), `src/db/stripe-webhook-model.ts` (`DONATION_SOURCES` gains `"invoice"`), `src/donors/confirmation.ts` (optional `invoice: { number; url }` line at the top), `src/donors/receipt.ts` (same optional line), `src/clients/email.ts` (`sendInvoiceEmail`, `sendInvoiceReceipt`, `sendInvoiceStaffNote` with literal kinds `invoice`, `invoiceReceipt`, `invoiceStaff`); tests `test/unit/invoices-settle.test.ts`, `test/unit/invoices-webhook.test.ts`, `test/unit/donation-source.test.ts` (array).

**Produces:** `settleInvoice(client: PoolClient, id: number, pay: { by: "card"|"transfer"; paidOn: string; sessionId: string|null; paymentIntentId: string|null; actor: string }): Promise<SettleOutcome | null>` where `SettleOutcome = { outcome: "paid"|"paid-twice"|"paid-after-cancel"|"already-recorded"; donationId: number|null; invoice: InvoiceRow; receipt: () => Promise<void> }`. It locks the row `FOR UPDATE`; `already-recorded` when a donation with this `stripe_session_id` and `invoice_id` exists (redelivery under a new event id); otherwise inserts the donor and donation with `insertDonorAndDonation` (declaration only for a person whose `gift_aid` is stored, with `SINGLE_DONATION_WORDING`, scope single, confirmedTaxpayer true), sets `source='invoice'`, `invoice_id`, and updates the invoice (first payment: status paid, paid_on, paid_by, donation_id; later payment: paid_twice_at). Audits `invoice.paid` / `invoice.paid_twice`. `receipt` sends, after commit: person → `sendDonationConfirmation` with the invoice line; business → `classifyCompanyGift` then `sendCompanyReceipt` with the invoice line, or the trustees flag audit as the webhook does today; group → `buildGroupReceiptEmail`. `markInvoicePaidByTransfer(id, paidOn, actor): Promise<SettleOutcome|null>` wraps it in its own transaction. `sendInvoicesPaidTwiceAlert(): Promise<number>` emails rows with `paid_twice_at` and no `paid_twice_alerted_at`, then stamps them.
`handleInvoiceEvent(client, event): Promise<{ action: string; afterCommit: (() => Promise<void>) | null } | null>`: only `checkout.session.completed` with `metadata.product === "donation_invoice"`; unpaid session → `invoice-not-paid`; unknown id → `invoice-unknown` (logged, returns so the money path is not mistaken for a gift without its invoice; the payment is still in Stripe).

- [ ] Failing tests: pure outcome choice (waiting → paid, paid → paid-twice, cancelled → paid-after-cancel); the webhook with a mocked pool: one donation for a new event, `already-recorded` for the same session under a second event id, a business invoice never writes a declaration even with `gift_aid` stored, a person with stored Gift Aid writes one, metadata from a non-invoice session returns null; receipts: person gets the confirmation with "This pays invoice INV-0012", group gets the group receipt, business with considerationGiven gets no receipt and the trustees audit.
- [ ] Implement; run the tests and the existing webhook tests (`npx vitest run test/unit/*webhook*.test.ts test/unit/donation-source.test.ts test/unit/invoices-*.test.ts`): pass.
- [ ] Commit `Invoices: a payment becomes one donation, with the right receipt`.

### Task 4: Routes (`src/routes/invoices.ts`) and the Overview, Donations and catalogue hooks

**Files:** create `src/routes/invoices.ts`; modify `src/app.ts` (mount), `src/db/admin.ts` (listDonations and search return `invoice_id`), `src/db/overview-numbers.ts` and `src/admin/gift-sources.ts` (bucket `invoices`, line name "Invoices"), `src/email/catalogue.ts` (group "Invoices": invoice email, group receipt, paid twice note), `test/unit/email-catalogue-guard.test.ts` if it lists folders, `src/admin/whats-new.ts` (area `invoices`, section donations view, a FEATURES entry); tests `test/unit/invoices-routes.test.ts`, existing gift-sources and overview tests updated.

Routes:
- `GET /api/admin/invoices` (donations view) → `{ invoices: (row + number + state + link)[], bank: BankDetails|null, today }`.
- `POST /api/admin/invoices` (edit) → 400 `{ error, field }` or 201 `{ id, number, link }`; sends the email; a failed send still 201 with `{ sent: false }` and the screen says "Saved but the email did not go. Press Email it again."
- `POST /api/admin/invoices/:id/resend` (edit), `POST /api/admin/invoices/:id/mark-paid` `{ paidOn }` (edit; waiting or cancelled only, paidOn a real date not in the future), `POST /api/admin/invoices/:id/cancel` (edit; waiting only), `PUT /api/admin/invoices/bank` `{ accountName, sortCode, accountNumber }` or `{ clear: true }` (edit).
- Public `GET /invoice/:token` (`Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, 404 page on a bad token), `POST /invoice/:token/gift-aid` and `POST /invoice/:token/pay` (urlencoded; pay re-reads the invoice and, only while waiting, saves or clears the Gift Aid details for a person, makes the session with idempotency key `donation-invoice-<id>-<minute>` and answers 303 to its url; otherwise re-renders the page with a message). 10 posts an hour per address on the public posts (the site's existing limiter, if one exists for public forms; else a small in-memory one).

- [ ] Failing route tests (mocked db, as `qr-codes-routes.test.ts`): 401/403 per level; field errors; create sends; mark-paid refuses a future date and a paid invoice; cancel only from waiting; public 404s (Review focus 3); pay on a paid or cancelled invoice makes no session (Review focus 4); Gift Aid on a business refused (Review focus 2).
- [ ] Implement; run `npx vitest run test/unit/invoices-routes.test.ts test/unit/*gift-sources*.test.ts test/unit/*overview*.test.ts test/unit/email-catalogue*.test.ts test/unit/whats-new*.test.ts`: pass.
- [ ] Commit `Invoices: admin and public routes, Overview line and email catalogue`.

### Task 5: The admin screen

**Files:** modify `admin.html` (Giving nav: `data-view="invoices" data-view-gate="donations"`; `#view-invoices` with the send form, bank details box, filter, list; Donations source filter checkbox `#donationsInvoiceFilter`), `assets/js/admin/app.js` (`loadInvoices`, `wireInvoices`, draw cards, actions; Donations pill "Invoice INV-0012" from `d.invoice_id`; the new checkbox in the three filter id lists), `assets/css/admin.css` (`#view-invoices` rules; status pills with text colours at 4.5:1 or better); test `test/unit/admin-app.test.ts` (new describe "Invoices").

Screen words come from the spec. Mark paid and Cancel each open an inline confirm row in the card (no modal). Copy link uses `navigator.clipboard` with a fallback of selecting the link text. Status messages use `is-ok` / `is-error`.

- [ ] Failing jsdom tests: nav item shows for donations view; form hidden without edit; business shows the "anything in return" question and orgName; group hides the question; sending posts the right body and draws the new card; a 400 puts the message by its field; Mark paid posts the date; Cancel asks first; the filter; the Donations pill and filter.
- [ ] Implement; run `npx vitest run test/unit/admin-app.test.ts test/unit/admin-screen-styles.test.ts test/unit/admin-shell.test.ts`: pass.
- [ ] Commit `Invoices: the admin screen`.

### Task 6: BDD, README, pictures, ship

**Files:** create `features/admin-invoices.feature`, `features/steps/admin-invoices.steps.js`; modify `README.md` (section "Invoices for donations (TASK-NNN)").

Scenarios: permissions (401, view 200, view cannot send 403); send then open the page by its link (200, shows INV number) and a bad token 404; bank transfer: mark paid makes exactly one donation labelled invoice (Donations list with `source=invoice` shows it once) and a second mark paid is refused; card: a signed `checkout.session.completed` for the invoice records one donation, the same session again under a new event id adds nothing, the page then says Paid; a business invoice refuses Gift Aid on its page; cancel then pay shows the cancelled page.

- [ ] Write the feature and steps; push a draft PR so CI runs BDD (no local Postgres).
- [ ] README section.
- [ ] Pictures on a stand-in server with invented data: admin screen (laptop and phone), invoice page for a person and a business, paid and cancelled, each email. Send to Jaimie for a yes.
- [ ] Whole-branch review by a fresh reviewer; fix; full unit suite; `/ship` on Jaimie's yes.
