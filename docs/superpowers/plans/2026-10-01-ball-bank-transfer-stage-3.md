# Ball bank transfer, stage 3 (TASK-486): invoices, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** the invoice decisions from `docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md`.
Choosing bank transfer offers "My company needs an invoice". Ticking it:
- asks for the company name and address (required), and optionally a purchase order number, an
  accounts team email and a phone number;
- gives 14 days to pay instead of 7, still capped by the last day for transfers;
- hides Gift Aid (decided 2026-10-01). A donation on a company invoice is the company's money, and
  Gift Aid is only for an individual taxpayer's own.

The invoice is a private printable page at a signed link, `/ball/invoice/<token>`, like the
thank-you letter. Its number is the booking reference, and it carries:
- the charity's registered name, number and postal address (`src/legal/registration.ts`);
- the company's details and PO number;
- the booking date;
- the lines: tickets, then any donation shown separately;
- the total, "Not registered for VAT", and the date to pay by;
- the bank details and the reference.

Once the booking is paid it says Paid, and if cancelled, Cancelled. The bank details email, the
reminder and the cancelled email link the invoice (where there is one) and copy in the accounts
email. When an admin marks it paid, the confirmation links the invoice too, now marked Paid.

**Architecture:**
- **Pure:** `invoiceSchema` and `TRANSFER_DAYS_INVOICE` (`src/ball/transfer.ts`),
  `src/ball/invoice-token.ts` (an HMAC of the booking id, the letter-token pattern) and
  `src/ball/invoice-page.ts` (the HTML).
- **SQL:** the five invoice columns, written by `createTransferBooking` and read by
  `getBookingForInvoice`.
- **Route:** `GET /ball/invoice/:token`, in `src/routes/ball-transfer.ts`.
- **Emails:** an `invoiceUrl` option and `cc`.
- **The public form, the done screen, and the admin's Awaiting list:** company name and an Invoice
  link.

## Tasks (test first throughout)
1. **Migration** `1791000000003_ball-transfer-invoices.js`: add `ball_bookings.invoice_company`,
   `invoice_address`, `invoice_po`, `invoice_accounts_email` and `invoice_phone`, all nullable text.
2. **Rules:**
   - `invoiceSchema`: company 1-120 characters, address 1-400, po up to 60, accountsEmail an email
     or empty, phone up to 40, all trimmed.
   - `TRANSFER_DAYS_INVOICE = 14`.
   - `transferPayBy(now, lastDay, days)` already takes the days.
3. **Token:** `signInvoiceToken(id, secret)` and `verifyInvoiceToken(token, secret)`. Unit tests
   cover the round trip, a tampered token and a malformed one.
4. **The page,** `renderInvoicePage(invoice)`, unit-tested:
   - the number, both parties, the PO, the lines, the total, the VAT line, the bank details and the
     pay-by date;
   - the Paid and Cancelled states;
   - escaping;
   - a Print button;
   - print CSS, and `noindex`;
   - the copy standards.
5. **SQL:**
   - `createTransferBooking` writes the invoice fields;
   - `getBookingForInvoice(id)` returns the booking with its invoice fields, status, `paid_at` and
     created day;
   - `listAwaitingTransfers` adds `company` and `invoice: boolean`;
   - `listTransfersForReminder` and the mark-paid and cancel paths return what the emails need
     (`invoiceUrl` built from the id, and the accounts email).
6. **Public route:**
   - `POST /api/ball/bank-transfer` accepts an optional `invoice` and validates it;
   - with an invoice it forces `giftAid: false` and gives 14 days (capped);
   - the answer adds `invoiceUrl` when there is one.

   Then `GET /ball/invoice/:token`: 404 for a bad token or no invoice, 200 with the page otherwise,
   `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.
7. **Emails:**
   - `buildTransferDetailsEmail`, the reminder and the cancelled email take an optional
     `invoiceUrl` and add a "Your invoice" link;
   - `buildBallConfirmationEmail` takes `invoiceUrl` and links the paid invoice;
   - `BallConfirmationMessage` gains `cc?`, and the senders cc the accounts email.
8. **The form** (`ball.html` and `ball.js`):
   - with Bank transfer chosen, an "I need an invoice for my company" tick shows the invoice fields;
   - ticking it hides and unticks Gift Aid, and says 14 days;
   - submit sends `invoice`;
   - the done screen links the invoice;
   - jsdom tests.

   Once transfer is on, a line in the "Booking bigger, or paying by invoice?" card points to the new
   option.
9. **Admin:** the Awaiting list shows the company under the name and an "Invoice" link (jsdom test).
10. **BDD:**
    - an invoice booking gets 14 days, has no Gift Aid, and its invoice page shows the company and
      the reference;
    - a tampered token gets 404;
    - after it is marked paid, the page says Paid.
11. **README**, the full suite, review and ship.
