# Ball bank transfer, stage 1 (TASK-484): implementation plan

> **Status (5 October 2026):** shipped as TASK-484 (#607) on 1 October 2026. Stages 2 to 5 followed
> the same day (TASK-485 to TASK-488, #608 to #611), then TASK-489 (#612), so "stages 2 to 5 still to
> come" further down was true only when this was written. The spec's Status note has the whole picture.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- **A buyer** can book Festive Ball seats or tables to pay by bank transfer, and is given the bank
  details, the amount, the reference and a pay-by date.
- **The admin screen** lists those bookings.
- **An admin** marks one paid, which sends the usual confirmation with its guest link.
- **Festive Ball editors** can give more time, or cancel, which emails the buyer.
- **A cancelled transfer booking** can be brought back when its money arrives.
- **Everything sits behind an admin-only switch,** which stays off.

**Architecture:**
- **A transfer booking is an ordinary `ball_bookings` row** with `payment_method = 'transfer'`,
  status `pending` until paid, and a `pay_by` date. It therefore counts for capacity exactly as a
  pending card booking does.
- **Pure rules** go in `src/ball/transfer.ts`, and **SQL** in `src/db/ball-transfer.ts`. The
  **emails** are in `src/ball/transfer-email.ts`, and the routes are a public `ballTransferRouter`
  and an admin `adminBallTransferRouter`. Nothing new is added to the 4,000-line `src/routes/admin.ts`
  beyond the cancel route's email.
- **The bank details** live on `ball_settings`, set by admins only.

**Tech stack:** Express and zod; node-pg-migrate (CommonJS) and pg; Vitest (unit, and jsdom for
`ball.js` and `app.js`); Cucumber BDD (Postgres, CI only).

**Spec:** `docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md`.

**Not in this stage:**
- the reminder, the Overdue flag and the last day for transfers (stage 2);
- invoices (stage 3), so the deadline is 7 days for everyone;
- the events@ email, the New pill and the ticket report (stage 4);
- staff adding bookings (stage 5).

---

## Files

| File | Change |
|---|---|
| `migrations/1790900000002_ball-bank-transfer.js` | **new.** `ball_bookings.payment_method`, `pay_by`, `marked_paid_by`; `ball_settings.transfer_on`, `transfer_account_name`, `transfer_sort_code`, `transfer_account_number`. |
| `src/ball/transfer.ts` | **new.** Pure: the bank details schema, sort code formatting, `transferReady`, `payByDate`, `TRANSFER_DAYS`. |
| `src/db/ball-transfer.ts` | **new.** Settings read and write; `createTransferBooking` (under the settings lock); `listAwaitingTransfers`; `markTransferPaid` (paid or reinstated, minting the guest token); `extendPayBy`; `abandonReplacedCheckout`. |
| `src/db/ball.ts` | Capacity: a pending CARD booking holds seats for one hour at most. The abandoned list and count are card only. `listBookings` and `cancelBooking` return `paymentMethod` (cancel also returns the buyer's name and email). |
| `src/ball/transfer-email.ts` | **new.** Pure: the bank details email and the "cancelled" email. |
| `src/ball/confirmation-email.ts` | `transferArrived` option, which adds one line. |
| `src/ball/transfer-send.ts` | **new.** Post-commit, best-effort senders for the three transfer emails. |
| `src/clients/email.ts` | `sendBallTransfer`, a verbatim send named "ballTransfer". |
| `src/clients/stripe.ts` | Stub: a `client_secret` that starts with the session id, as Stripe's does, and `sessions.expire`. |
| `src/routes/admin-authz.ts` | `authorizeSectionAsAdmin`: section edit access AND the admin role, read fresh. |
| `src/routes/ball-transfer.ts` | **new.** `POST /api/ball/bank-transfer`. |
| `src/routes/ball.ts` | Availability gains `transferOpen`. The checkout takes `replaces` (the duplicate-booking fix). |
| `src/routes/admin-ball-transfer.ts` | **new.** Bank details GET and PUT; the awaiting list; mark-paid; pay-by. |
| `src/routes/admin.ts` | The cancel route emails a transfer buyer whose unpaid booking is cancelled. |
| `src/app.ts` | Mounts the two new routers. |
| `ball.html`, `assets/js/ball.js`, `assets/css/ball.css` (or wherever `.ball-*` lives) | The "How would you like to pay?" choice, the bank details panel, and the fallback sending `replaces`. |
| `admin.html`, `assets/js/admin/app.js` | The Bank transfer settings, the Awaiting transfer list and its actions, the bookings table, and the abandoned-checkout wording. |
| Tests | `test/unit/ball-transfer.test.ts`, `ball-transfer-email.test.ts`, `ball-transfer-routes.test.ts`, `admin-ball-transfer-routes.test.ts`, `ball-transfer-form.test.ts` (jsdom), plus additions to `ball-confirmation-email.test.ts`, `admin-app.test.ts` and `backup-plan.test.ts` if counts change. BDD in `features/ball-bank-transfer.feature` and its steps. |
| `README.md` | A new section under the Festive Ball headings. |

**Before writing any buyer-facing words,** read README "Ball copy house rules (TASK-325)" and "What
the ball page may and may not say (TASK-316)", and `test/unit/ball-copy-standards.test.ts`. The
copy below follows them (no em dashes, plain words), but those tests are the authority.

---

### Task 1: The migration

**Files:** create `migrations/1790900000002_ball-bank-transfer.js`.

- [ ] **Choose the number.** Run `ls migrations | tail -3` and `gh pr diff 602 --name-only | grep migrations`.
  - The parked analytics PRs use `1791000000000` and `1791000000001`, so number this above both,
    whichever merges first. Golden rule: a migration must never sort before one production has
    already run.
  - Re-check at PR time.
- [ ] **Write it:**

```js
/* eslint-disable camelcase */

// TASK-484: paying for the Festive Ball by bank transfer (stage 1 of five; see
// docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md).
//
// Additive only (golden rule 2): new columns with defaults or nullable, and nothing else.
//   ball_bookings
//     payment_method  'card' for every existing row and every Stripe booking; 'transfer' for a booking
//                     paid by bank transfer, which stays 'pending' until an admin marks it paid.
//     pay_by          the date a transfer should arrive by (UK date). Null for card bookings.
//     marked_paid_by  who marked a transfer paid. Null for card bookings, which Stripe confirms.
//   ball_settings
//     transfer_on and the three bank details. Kept here, not in code: this repository is public.
//
// Numbered above the analytics migrations (1791000000000/1, in open PRs at the time) so that
// whichever merges first, this one never sorts before a migration production has already run.

exports.up = (pgm) => {
  pgm.addColumns("ball_bookings", {
    payment_method: { type: "text", notNull: true, default: "card" },
    pay_by: { type: "date" },
    marked_paid_by: { type: "text" },
  });
  pgm.addConstraint("ball_bookings", "ball_bookings_payment_method_check", {
    check: "payment_method IN ('card', 'transfer')",
  });
  pgm.createIndex("ball_bookings", ["payment_method", "status"]);

  pgm.addColumns("ball_settings", {
    transfer_on: { type: "boolean", notNull: true, default: false },
    transfer_account_name: { type: "text" },
    transfer_sort_code: { type: "text" },
    transfer_account_number: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_settings", [
    "transfer_on", "transfer_account_name", "transfer_sort_code", "transfer_account_number",
  ]);
  pgm.dropIndex("ball_bookings", ["payment_method", "status"]);
  pgm.dropConstraint("ball_bookings", "ball_bookings_payment_method_check");
  pgm.dropColumns("ball_bookings", ["payment_method", "pay_by", "marked_paid_by"]);
};
```

- [ ] **Check:**
  - `ls migrations | tail -2` shows it last.
  - `npx vitest run test/unit/backup-plan.test.ts` still passes: there are no new tables, so the
    counts are unchanged.
- [ ] **Commit:** `[TASK-484] Migration: bank transfer columns on bookings and settings`.

### Task 2: Pure rules (`src/ball/transfer.ts`)

**Files:** create `src/ball/transfer.ts` and `test/unit/ball-transfer.test.ts`.

- [ ] **Failing tests:**

```ts
import { describe, it, expect } from "vitest";
import { bankDetailsSchema, formatSortCode, transferReady, payByDate, TRANSFER_DAYS } from "../../src/ball/transfer";

describe("the bank details staff enter", () => {
  it("accepts a sort code with or without dashes, and stores it with them", () => {
    expect(bankDetailsSchema.parse({ accountName: "NBCC", sortCode: "123456", accountNumber: "12345678" }).sortCode).toBe("12-34-56");
    expect(bankDetailsSchema.parse({ accountName: "NBCC", sortCode: "12-34-56", accountNumber: "12345678" }).sortCode).toBe("12-34-56");
  });
  it("refuses a sort code or account number that is not one", () => {
    expect(bankDetailsSchema.safeParse({ accountName: "NBCC", sortCode: "12345", accountNumber: "12345678" }).success).toBe(false);
    expect(bankDetailsSchema.safeParse({ accountName: "NBCC", sortCode: "123456", accountNumber: "1234567" }).success).toBe(false);
    expect(bankDetailsSchema.safeParse({ accountName: "", sortCode: "123456", accountNumber: "12345678" }).success).toBe(false);
  });
  it("formats a stored sort code for reading", () => {
    expect(formatSortCode("123456")).toBe("12-34-56");
  });
});

describe("whether the page may offer a bank transfer", () => {
  const details = { accountName: "NBCC", sortCode: "12-34-56", accountNumber: "12345678" };
  it("does when switched on with every detail filled in", () => {
    expect(transferReady({ on: true, ...details })).toBe(true);
  });
  // Switched on with a detail missing would hand a buyer a booking they cannot pay.
  it("does not when any detail is missing, or when it is switched off", () => {
    expect(transferReady({ on: true, ...details, accountNumber: null })).toBe(false);
    expect(transferReady({ on: false, ...details })).toBe(false);
  });
});

describe("the date a transfer should arrive by", () => {
  it("is seven days on, as a UK date", () => {
    expect(TRANSFER_DAYS).toBe(7);
    expect(payByDate(new Date("2026-10-01T10:00:00Z"))).toBe("2026-10-08");
  });
  // 23:30 UTC on the 1st is already the 2nd in a British Summer Time October.
  it("counts from the UK date, not the server's", () => {
    expect(payByDate(new Date("2026-10-01T23:30:00Z"))).toBe("2026-10-09");
  });
});
```

- [ ] **Run:** `npx vitest run test/unit/ball-transfer.test.ts`. It fails because the module is missing.
- [ ] **Code:**

```ts
import { z } from "zod";
import { londonDate } from "./sales-report";

// TASK-484: the pure rules for paying for the Ball by bank transfer. No pool, no network: the
// clock is passed in. See docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md.

/** Days a buyer has to pay. Stage 3 gives an invoice 14; stage 2 caps both at a last day. */
export const TRANSFER_DAYS = 7;

const digits = (s: string) => s.replace(/[\s-]/g, "");

export function formatSortCode(raw: string): string {
  const d = digits(raw);
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
}

export const bankDetailsSchema = z.object({
  accountName: z.string().trim().min(1, "Give the account name").max(70),
  sortCode: z
    .string()
    .refine((s) => /^\d{6}$/.test(digits(s)), "A sort code is six digits")
    .transform(formatSortCode),
  accountNumber: z
    .string()
    .refine((s) => /^\d{8}$/.test(digits(s)), "An account number is eight digits")
    .transform(digits),
});
export type BankDetails = z.infer<typeof bankDetailsSchema>;

export interface TransferSettings {
  on: boolean;
  accountName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
}

/** On, and every detail there: otherwise a buyer would be given a booking they cannot pay. */
export function transferReady(s: TransferSettings): boolean {
  return s.on && Boolean(s.accountName && s.sortCode && s.accountNumber);
}

/** The UK date `days` days after `now`. */
export function payByDate(now: Date, days = TRANSFER_DAYS): string {
  const today = londonDate(now); // YYYY-MM-DD
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
```

  Check that `londonDate` returns `YYYY-MM-DD`. Read `UK_DATE` in `src/ball/sales-report.ts`; if it
  uses a different format, convert it here.
- [ ] **Run the test** and see it pass.
- [ ] **Commit:** `[TASK-484] The rules for paying by bank transfer`.

### Task 3: Capacity and the abandoned list count card checkouts only while they can still pay

This fixes two existing faults: the "holds no seats" wording, and seats held forever when Stripe's
expired message is lost.

**Files:** modify `src/db/ball.ts` (`SOLD_SQL`, `listAbandonedBookings`, `countAbandonedBookings`, `listBookings`, `BallBookingRow`).

- [ ] **Code.** Replace `SOLD_SQL`'s WHERE clause:

```ts
// Sold seats, split by how they were bought. A PAID booking always counts. A PENDING one counts
// while it may still become paid:
//   - a bank transfer (TASK-484) until an admin marks it paid or staff cancel it;
//   - a card checkout for one hour. Stripe expires the session at 30 minutes and its expired event
//     cancels the booking. If that event is ever lost, the seats would otherwise stay held for good.
//     The status is left alone, so a late "completed" still finds the booking pending and marks it paid.
const SOLD_SQL = `SELECT
    COALESCE(SUM(quantity) FILTER (WHERE kind = 'table'), 0) AS tables_sold,
    COALESCE(SUM(quantity) FILTER (WHERE kind = 'seat'),  0) AS loose_seats_sold
  FROM ball_bookings
  WHERE status = 'paid'
     OR (status = 'pending'
         AND (payment_method = 'transfer' OR created_at > now() - interval '1 hour'))`;
```

  In `listAbandonedBookings` and `countAbandonedBookings`, add `AND payment_method = 'card'` to the
  WHERE clause. Transfer bookings have their own list. Add `paymentMethod: string` to
  `BallBookingRow` and `payment_method` to the SELECTs in `listBookings` and `listAbandonedBookings`
  (mapped `paymentMethod: r.payment_method`). Fix the stale "15-minute reservation" comment above
  `createPendingBooking`: the code holds it for 2 minutes.
- [ ] **Test** (BDD, Task 13): "a card checkout left pending for over an hour no longer holds seats",
  and "a transfer booking keeps its seats however old". There is no local database, so no unit test
  can run this SQL.
- [ ] **Commit:** `[TASK-484] A card checkout holds seats for an hour at most; transfers until settled`.

### Task 4: The emails (pure)

**Files:** create `src/ball/transfer-email.ts` and `test/unit/ball-transfer-email.test.ts`; modify
`src/ball/confirmation-email.ts` and `test/unit/ball-confirmation-email.test.ts`.

- [ ] **Failing tests:**

```ts
import { describe, it, expect } from "vitest";
import { buildTransferDetailsEmail, buildTransferCancelledEmail } from "../../src/ball/transfer-email";

// Invented, like every fixture in this public repo.
const booking = {
  reference: "BALL-7KQ2MZ", kind: "table" as const, quantity: 1, seats: 10, buyerName: "Ada Test",
  ticketsPence: 100000, donationPence: 2000, totalPence: 102000, giftAid: true,
};
const bank = { accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678" };

describe("the bank details email", () => {
  const mail = buildTransferDetailsEmail(booking, bank, "2026-10-08");
  it("says how much, to which account, with which reference, by when", () => {
    for (const part of ["£1,020.00", "12-34-56", "12345678", "Night Before Christmas Campaign", "BALL-7KQ2MZ", "Thursday 8 October"]) {
      expect(mail.text).toContain(part);
      expect(mail.html).toContain(part);
    }
  });
  it("names the booking in the subject", () => {
    expect(mail.subject).toBe("How to pay for your Festive Ball booking BALL-7KQ2MZ");
  });
  it("says the seats are held and what happens when the money arrives", () => {
    expect(mail.text).toMatch(/held for you until Thursday 8 October/);
    expect(mail.text).toMatch(/guest/i);
  });
  it("escapes what the buyer typed", () => {
    expect(buildTransferDetailsEmail({ ...booking, buyerName: "<b>x</b>" }, bank, "2026-10-08").html).not.toContain("<b>x</b>");
  });
});

describe("the cancelled email", () => {
  const mail = buildTransferCancelledEmail(booking);
  it("says the booking is cancelled and what to do if they did pay", () => {
    expect(mail.subject).toBe("Your Festive Ball booking BALL-7KQ2MZ has been cancelled");
    expect(mail.text).toMatch(/already paid/i);
  });
});
```

  Add to `test/unit/ball-confirmation-email.test.ts`:

```ts
it("thanks a bank transfer buyer for the transfer, and only them", () => {
  const withLine = buildBallConfirmationEmail(paidBooking, { ...details, transferArrived: true });
  expect(withLine.text).toContain("Your bank transfer has arrived. Thank you.");
  expect(withLine.html).toContain("Your bank transfer has arrived. Thank you.");
  expect(buildBallConfirmationEmail(paidBooking, details).text).not.toContain("bank transfer");
});
```

  `paidBooking` and `details` are whatever that file's existing fixtures are called; use those.
- [ ] **Run** and see them fail.
- [ ] **Code.** Write `src/ball/transfer-email.ts` in the style of `confirmation-email.ts`:
  `ballEmailShell`, `factsCard`, `contactPanel` and `BALL_TEXT_FOOTER` from `./email-shell`, and
  `escapeHtml` from `./page`.
  - **`longDate("2026-10-08")`** gives "Thursday 8 October". Build it with
    `Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })`
    on `new Date(payBy + "T12:00:00Z")`.
  - **`money(pence)`** works as in `confirmation-email.ts`. Export that file's `money` and
    `describe`, and import them here, rather than copying them.
  - **The details email** (subject `How to pay for your Festive Ball booking ${reference}`):
    - a heading, "Thank you, {name}. Your seats are held".
    - "You have booked {describe}. Your seats are held for you until {longDate}. Please pay by bank
      transfer by then."
    - A facts card with:
      - Amount to pay {money(totalPence)}
      - Account name
      - Sort code
      - Account number
      - Payment reference {reference}
    - "Please use the reference exactly as it is written, so we can match your payment to your
      booking."
    - Money rows as in the confirmation: Tickets, then Donation to NBCC if there is one.
    - The Gift Aid note only when Gift Aid was added.
    - "What happens next": "As soon as your payment arrives we'll email to confirm your booking, with
      a link to tell us who's coming."
    - `contactPanel()`.
  - **The cancelled email** (subject `Your Festive Ball booking ${reference} has been cancelled`):
    - "We hadn't received payment for booking {reference}, so we've cancelled it and released the
      seats."
    - "If you have already paid, or would still like to come, reply to this email and we'll sort it
      out."
    - `contactPanel()`.
  - **`confirmation-email.ts`:** add `transferArrived?: boolean` to `BallEventDetails`. When it is
    true, insert `<p ${P}><b>Your bank transfer has arrived. Thank you.</b></p>` straight after the
    "Thank you, {name}…" paragraph, and the same line in the text version.
- [ ] **Run** `npx vitest run test/unit/ball-transfer-email.test.ts test/unit/ball-confirmation-email.test.ts test/unit/ball-copy-standards.test.ts test/unit/ball-email-brand.test.ts`. They should pass.
- [ ] **Commit:** `[TASK-484] The bank details, cancelled and transfer-arrived emails`.

### Task 5: The SQL (`src/db/ball-transfer.ts`)

**Files:** create `src/db/ball-transfer.ts`. Its tests are the route unit tests (mocked) and the BDD
in Task 13.

- [ ] **Code:**

```ts
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { canFulfil, seatsFor, type Order } from "../ball/capacity";
import type { BallBookingWrite } from "../ball/booking";
import type { TransferSettings, BankDetails } from "../ball/transfer";

// TASK-484: the reads and writes behind paying for the Ball by bank transfer. Every write that
// takes seats queues behind the same ball_settings row lock as checkout and holds (readCapacityState
// is shared through capacityStateFor), so a transfer booking can never oversell the room.

export async function getTransferSettings(): Promise<TransferSettings> {
  const r = await pool.query(
    `SELECT transfer_on, transfer_account_name, transfer_sort_code, transfer_account_number
       FROM ball_settings WHERE id = 1`,
  );
  const row = r.rows[0];
  return {
    on: row.transfer_on,
    accountName: row.transfer_account_name,
    sortCode: row.transfer_sort_code,
    accountNumber: row.transfer_account_number,
  };
}

export async function saveTransferSettings(
  update: { on?: boolean; details?: BankDetails },
  actor: string,
): Promise<TransferSettings> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (update.details) {
      await client.query(
        `UPDATE ball_settings SET transfer_account_name = $1, transfer_sort_code = $2,
                transfer_account_number = $3 WHERE id = 1`,
        [update.details.accountName, update.details.sortCode, update.details.accountNumber],
      );
    }
    if (update.on !== undefined) {
      await client.query(`UPDATE ball_settings SET transfer_on = $1 WHERE id = 1`, [update.on]);
    }
    // Which fields changed, never the numbers themselves: the audit log is shown to more people.
    await insertAudit(client, {
      actor,
      action: "ball.transfer_settings_changed",
      entity: "ball_settings",
      entityId: 1,
      data: { switchedOn: update.on ?? null, bankDetailsChanged: Boolean(update.details) },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return getTransferSettings();
}
```

  Continue in the same file with the functions below. Each uses
  `client.query("SELECT id FROM ball_settings WHERE id = 1 FOR UPDATE")` and the shared capacity read
  where it takes seats.
  - **Export `readCapacityState` from `src/db/ball.ts`** so it can be reused here. It is currently
    module-private: add `export`.
  - **`createTransferBooking(write: Omit<BallBookingWrite, "stripeSessionId">, payBy: string)`**
    returns `Promise<{ id: number } | null>`.
    - Inside the lock: `const state = await readCapacityState(client); if (!canFulfil(state, {kind, quantity})) → ROLLBACK, return null`.
    - Then `INSERT INTO ball_bookings (reference, kind, quantity, seats, buyer_name, buyer_first_name, buyer_surname, buyer_email, tickets_pence, donation_pence, fee_cover_pence, total_pence, gift_aid, newsletter_opt_in, status, terms_accepted_at, payment_method, pay_by) VALUES (…, 'pending', now(), 'transfer', $payBy) RETURNING id`.
    - `fee_cover_pence` is always 0.
  - **No per-email check.** The client decided a buyer who wants more must be able to book more,
    so there is deliberately no "one unpaid booking per email address".
  - **`listAwaitingTransfers()`**: pending transfers ordered by `pay_by, created_at`. Returns
    reference, kind, quantity, seats, buyerName, buyerEmail, totalPence, payBy (as `YYYY-MM-DD`, from
    `to_char(pay_by, 'YYYY-MM-DD')`) and createdAt.
  - **`markTransferPaid(reference, confirmTotalPence, actor, newToken)`** returns `MarkPaidOutcome`:

```ts
export type MarkPaidOutcome =
  | { ok: true; reinstated: boolean; booking: BallBookingWrite; guestToken: string }
  | { ok: false; reason: "not_found" | "not_transfer" | "already_paid" | "amount_mismatch" | "seats_gone" };
```

    In one transaction:
    1. Take the settings lock.
    2. `SELECT … FROM ball_bookings WHERE reference = $1 FOR UPDATE`.
    3. Refuse with the matching reason:
       - no row: `not_found`;
       - `payment_method <> 'transfer'`: `not_transfer`;
       - status `paid`: `already_paid`;
       - `total_pence <> confirmTotalPence`: `amount_mismatch`.
    4. If the status is `cancelled`, run
       `canFulfil(await readCapacityState(client), { kind, quantity })`. A cancelled booking's seats
       are not counted, so this asks whether there is room for it again. If not: `seats_gone`.
    5. `UPDATE … SET status = 'paid', paid_at = now(), marked_paid_by = $actor, guest_token = COALESCE(guest_token, $token) RETURNING …`.
    6. Audit with `ball.transfer_marked_paid` or `ball.transfer_reinstated`, data
       `{ reference, totalPence }`.
    7. Return the row mapped to `BallBookingWrite` (`stripeSessionId: ""`) and the guest token.
  - **`extendPayBy(reference, payBy, actor)`** returns `"ok" | "not_found" | "not_open"`. It works
    only on a pending transfer, and audits `ball.transfer_pay_by_changed` with
    `{ reference, from, to }`.
  - **`abandonReplacedCheckout(reference)`** returns `Promise<string | null>`: the
    `stripe_session_id` of a PENDING CARD booking with that reference, or null. The route checks the
    client secret against it and expires the Stripe session first. Then **`cancelReplacedCheckout(sessionId)`**:
    `UPDATE ball_bookings SET status = 'cancelled' WHERE stripe_session_id = $1 AND status = 'pending' AND payment_method = 'card'`.
- [ ] **Typecheck:** `npx tsc --noEmit -p .`
- [ ] **Commit:** `[TASK-484] SQL for bank transfer bookings`.

### Task 6: Senders

**Files:** modify `src/clients/email.ts`; create `src/ball/transfer-send.ts`.

- [ ] **Code.** In `email.ts`, after `sendBallRunUp`:

```ts
// TASK-484: the bank transfer emails (how to pay, and cancelled). Their own name in logs, like the
// reminder and run-up, so they can be told apart from the confirmation in a bounce report.
export async function sendBallTransfer(message: BallConfirmationMessage): Promise<void> {
  await sendVerbatim("ballTransfer", null, message);
}
```

  `src/ball/transfer-send.ts` has three best-effort functions, each catching and logging as
  `sendBallConfirmationEmail` does in `src/db/stripe-webhook.ts:1091`:
  - **`sendTransferDetails(booking, bank, payBy)`** builds `buildTransferDetailsEmail` and calls
    `sendBallTransfer` from `config.BALL_FROM_EMAIL`.
  - **`sendTransferCancelled(booking)`**.
  - **`sendTransferArrived(booking, guestToken)`** reads `getSettings()` and builds
    `buildBallConfirmationEmail(booking, { arrivalTime, includedNote, guestLink: <BALL_BASE_URL>/ball/guests/<token>, calendarUrl, transferArrived: true })`.
    It sends through `sendBallConfirmation`, the same as card buyers.
- [ ] **Typecheck and commit:** `[TASK-484] Senders for the bank transfer emails`.

### Task 7: Admin-only authorisation

**Files:** modify `src/routes/admin-authz.ts`; test in `test/unit/admin-ball-transfer-routes.test.ts` (Task 9).

- [ ] **Code:**

```ts
// TASK-484: section edit access AND the admin role, both read from the database on this request.
// For the few actions the client reserved to admins whatever the matrix says (marking money
// arrived, setting the bank details). The token's role claim is not trusted: it may be a day old.
export async function authorizeSectionAsAdmin(
  req: Request,
  res: Response,
  section: Section,
): Promise<AdminSessionClaims | null> {
  const result = await authorizeSession(req, res);
  if (!result) return null;
  if (result.row.role !== "admin" || !can(effectivePermissions(result.row), section, "edit")) {
    res.status(403).json({ error: "Only an admin can do that" });
    return null;
  }
  return result.claims;
}
```

  Confirm that `authorizeSession`'s `row` carries `role`: `effectivePermissions(result.row)` already
  reads it.
- [ ] **Commit** with Task 9.

### Task 8: Public route, `POST /api/ball/bank-transfer`, and availability

**Files:** create `src/routes/ball-transfer.ts` and `test/unit/ball-transfer-routes.test.ts`; modify
`src/routes/ball.ts` (availability) and `src/app.ts`.

- [ ] **Failing tests,** with `../../src/db/ball`, `../../src/db/ball-transfer` and
  `../../src/ball/transfer-send` mocked, in the style of `admin-whats-new-routes.test.ts`. Export the
  handler as `postBankTransfer`. Assert:
  - **409, "Bank transfer isn't available"**, when `getTransferSettings` is off or incomplete.
    Nothing is written.
  - **409 when sales are closed**, using `getAvailability().salesOpen` false.
  - **400** on a body that fails `purchaseSchema`.
  - **A second transfer booking from the same email address is accepted (201).** There is
    deliberately no per-email limit.
  - **409, "There are not enough seats left for that booking"**, when `createTransferBooking`
    returns null.
  - **201 on success**, with body `{ reference, totalPence, payBy, accountName, sortCode, accountNumber }`.
    - `totalPence` excludes any card fee even when `coverFee: true` was sent.
    - `sendTransferDetails` was called once.
  - **429** on the sixth request from one IP inside an hour.
- [ ] **Code:**
  - Parse with `purchaseSchema`, then force `coverFee: false`.
  - Price with `orderTotalPence({ order, donationPence, coverFee: false, cardFee: avail.cardFee })`.
  - Get the reference from `makeReference(randomBytes(8))` and the seats from `seatsFor`.
  - `payBy = payByDate(new Date())`.
  - Rate limit with an in-memory per-IP limiter: 5 an hour, copied from `src/routes/subscribe.ts`'s
    `overLimit`.
  - The reason for these limits goes in a comment: a bot could otherwise hold the whole room for a
    week.
  - After the insert, `void sendTransferDetails(...)`.
  - Mount it in `src/app.ts` beside `ballRouter`.
- [ ] **Availability.** In `ballRouter.get("/api/ball/availability")`, add
  `transferOpen: a.salesOpen && transferReady(await getTransferSettings())`. Never return the bank
  details here. Add a test in `ball-transfer-routes.test.ts` that the availability JSON has
  `transferOpen` and no `sortCode` or `accountNumber` key.
- [ ] **Run, pass, commit:** `[TASK-484] Public route: book to pay by bank transfer`.

### Task 9: Admin routes

**Files:** create `src/routes/admin-ball-transfer.ts` and `test/unit/admin-ball-transfer-routes.test.ts`;
modify `src/routes/admin.ts` (cancel) and `src/app.ts`.

- [ ] **Failing tests.** Mock the db modules and `getUserAuthRow`. A token-for-role helper, as in
  `admin-contact-routes.test.ts`, sets the row's `role` and `permissions`. Assert:
  - **`GET /api/admin/ball/transfer-settings`** needs ball view. It returns
    `{ on, accountName, sortCode, accountNumber, ready }`.
  - **`PUT /api/admin/ball/transfer-settings`:**
    - 403 for an editor granted ball edit;
    - 400 on a bad sort code;
    - 400 when switching on with details missing (`transferReady` false after the save);
    - 200 for an admin.
  - **`GET /api/admin/ball/transfers`** needs ball view and returns `{ results }`.
  - **`POST /api/admin/ball/bookings/:reference/mark-paid { confirmTotalPence }`:**
    - 403 for an editor with ball edit;
    - 400 without a numeric `confirmTotalPence`;
    - 404, 409 or 409 for `not_found`, `not_transfer` or `already_paid`;
    - 409 for `amount_mismatch` ("That isn't the amount for this booking");
    - 409 for `seats_gone` ("Its seats have been sold since it was cancelled. Refund the transfer by
      hand.");
    - 200 `{ reinstated }` with `sendTransferArrived` called once.
  - **`POST /api/admin/ball/bookings/:reference/pay-by { payBy }`:**
    - needs ball edit, so an editor with ball edit gets 200;
    - 400 for a date before today (UK) or not `YYYY-MM-DD`;
    - 409 for `not_open`.
  - **Cancel** (in `admin.ts`, existing tests in `ball-admin-view.test.ts` or wherever cancel is
    tested): a pending transfer cancelled calls `sendTransferCancelled`, and a card one does not.
    Extend `CancelOutcome`'s ok branch with `paymentMethod`, `buyerName`, `buyerEmail` and
    `reference`, and select those in `cancelBooking`.
- [ ] **Code.** Wrap every handler body in try/catch returning 500, as `admin-whats-new.ts` does.
  `newGuestToken()` comes from `./ball`. Mount the router in `src/app.ts`.
- [ ] **Run, pass, commit:** `[TASK-484] Admin routes: bank details, awaiting list, mark paid, more time`.

### Task 10: The duplicate pending booking on the card fallback

**Files:** modify `src/clients/stripe.ts` (stub), `src/routes/ball.ts` and `assets/js/ball.js`. Tests
go in `test/unit/ball-transfer-form.test.ts` (jsdom, the client half) and BDD (the server half).

- [ ] **Stub:**
  - `client_secret: \`${id}_secret_preview_…\`` with the existing suffix, which is how Stripe's
    begin. Compute the id first.
  - Add `expire: async (id: string) => ({ id, status: "expired" })`.
- [ ] **Server.** In `POST /api/ball/checkout-session`, before the capacity check, read optional
  `req.body.replaces` (`{ reference: string, clientSecret: string }`, zod-validated separately from
  `purchaseSchema`). When it is present:
  1. `const sid = await abandonReplacedCheckout(reference)`.
  2. If `sid` exists and `clientSecret.startsWith(sid + "_secret_")`:
     `try { await stripe.checkout.sessions.expire(sid); await cancelReplacedCheckout(sid); } catch { /* already paid or gone: leave it */ }`.

  Comment why it is done in that order: expiring first means a session someone did pay can never be
  cancelled under them, because Stripe refuses to expire a completed session.
- [ ] **Client.** `hostedRedirect(replaces)` sets `body.replaces = replaces` when given. In the
  embedded branch, every fallback after a 201 calls
  `hostedRedirect({ reference: data.reference, clientSecret: data.clientSecret })`. `post("embedded")`
  rejecting before any 201 stays a plain `hostedRedirect()`.
- [ ] **jsdom test** in `test/unit/ball-transfer-form.test.ts`:
  - Load `ball.html`'s body and evaluate `ball.js`, as `admin-app.test.ts` does for the admin.
  - Stub `window.Stripe` so that `initEmbeddedCheckout` rejects.
  - Stub fetch so the first `/api/ball/checkout-session` answers 201 with
    `{ reference: "BALL-AAAAAA", clientSecret: "cs_x_secret_y", publishableKey: "pk" }`.
  - Submit a valid form.
  - Expect the second POST's body to carry `replaces: { reference: "BALL-AAAAAA", clientSecret: "cs_x_secret_y" }`.
- [ ] **Commit:** `[TASK-484] The card fallback no longer leaves a second booking holding seats`.

### Task 11: The Ball page form

**Files:** `ball.html`, `assets/js/ball.js`, the Ball stylesheet; test in `test/unit/ball-transfer-form.test.ts`.

- [ ] **Failing jsdom tests:**
  - **With availability `transferOpen: false`,** the `#ballPayMethod` fieldset stays hidden and
    submit posts to `/api/ball/checkout-session` as before.
  - **With `transferOpen: true`,** the fieldset shows.
  - **Choosing Bank transfer:**
    - hides the cover-fee label (`input[name=coverFee]`'s `.ball-check`) and unticks it;
    - takes the fee out of the total;
    - sets the button text to "Book and get bank details".
  - **Submitting** posts to `/api/ball/bank-transfer` with no `coverFee: true`.
  - **On 201,** the form is hidden and `#ballTransferDone` shows the reference, amount, account
    name, sort code, account number and pay-by date ("Thursday 8 October"), with focus moved to its
    heading.
  - **On 409,** the error box shows the server's message.
- [ ] **Markup** (in `ball.html`, just above `#ballError`):

```html
<!-- TASK-484: shown by ball.js only when /api/ball/availability says transferOpen, which needs
     an admin to have entered the bank details and switched it on. Without JavaScript, or with it
     switched off, the form is card only, exactly as before. -->
<fieldset class="ball-choice ball-pay" id="ballPayMethod" hidden>
  <legend>How would you like to pay?</legend>
  <label class="ball-option">
    <input type="radio" name="payMethod" value="card" checked />
    <span class="ball-option-body"><b>Card</b><span class="ball-note">Pay now, securely through Stripe.</span></span>
  </label>
  <label class="ball-option">
    <input type="radio" name="payMethod" value="transfer" />
    <span class="ball-option-body"><b>Bank transfer</b><span class="ball-note">We'll hold your seats for 7 days and give you our bank details and a reference.</span></span>
  </label>
</fieldset>
```

  Then, after the form, the `#ballTransferDone` section: hidden, with `tabindex="-1"` on its
  heading. It has a heading ("Your seats are held"), a `<dl>` for the five details plus the pay-by
  date, the line "We've emailed these to you as well. Please use the reference exactly as written,
  so we can match your payment.", and "As soon as your payment arrives we'll email to confirm your
  booking, with a link to tell us who's coming."
- [ ] **Script.** `payMethod()` reads the radio. `recalculate()` leaves the fee out when it is
  `transfer`, and hides and unticks `coverFee`'s label. The submit handler branches on `transfer`:
  - It POSTs to `/api/ball/bank-transfer` with the same body minus `uiMode` and `coverFee`.
  - On 201 it fills and shows `#ballTransferDone`, hides the form, and calls
    `focus({ preventScroll: false })` on the heading.
  - On anything else it shows the error and reloads availability.
  - `loadAvailability` toggles `#ballPayMethod.hidden = !data.transferOpen`.
- [ ] **Run** `npx vitest run test/unit/ball-transfer-form.test.ts test/unit/ball-page.test.ts test/unit/ball-copy-standards.test.ts test/unit/ball-page-copy.test.ts`.
- [ ] **Browser check** with a stand-in. Copy `scratchpad/events-standin.mts`, serving `ball.html`
  and answering the availability with `transferOpen: true` and the bank-transfer POST. Check:
  - 320, 375 and 1280px;
  - choosing transfer hides the fee and changes the total and the button;
  - the details panel reads clearly;
  - nothing scrolls sideways.
- [ ] **Commit:** `[TASK-484] The Ball page offers bank transfer, once it is switched on`.

### Task 12: The admin screen

**Files:** `admin.html` and `assets/js/admin/app.js`; tests in `test/unit/admin-app.test.ts`.

- [ ] **Failing jsdom tests** (a new `describe("bank transfer (TASK-484)")`; stub the new endpoints
  in `respond()`):
  - **The Bank transfer settings** show the saved details. Their Save button and switch are enabled
    for an admin and disabled for an editor with ball edit. A note says "Only an admin can change
    these".
  - **"Awaiting transfer"** lists each booking: reference, name and email, what was bought,
    amount, and pay-by date.
  - **An admin** sees Mark as paid, Give more time and Cancel. **An editor with ball edit** sees
    Give more time and Cancel only.
  - **Mark as paid** confirms with "Has £1,020.00 arrived for BALL-7KQ2MZ (Ada Test)?". On OK it
    POSTs `{ confirmTotalPence: 102000 }`; on Cancel it sends nothing.
  - **The search box** filters the list by reference, name or amount (typing "1020" or "1,020"
    finds £1,020.00).
  - **In the bookings table,** a cancelled transfer shows "Mark as paid" for an admin only. It
    confirms with "This booking was cancelled. If its seats are still free it comes back as paid,
    and they're emailed their confirmation. Has £… arrived?".
  - **The abandoned fold** reads "No money was taken. Their seats are kept for up to an hour in
    case they are still paying, then go back on sale." It no longer says "no seats are held".
- [ ] **Markup.**
  - **Under "Set up",** a `<h3 class="admin-subhead">Bank transfer</h3>` holds:
    - a note: "The account buyers pay into. They're shown these only after booking, never on the
      open page. Only an admin can change them.";
    - `#ballTransferForm` with Account name, Sort code and Account number inputs;
    - a checkbox "Offer bank transfer on the ticket page";
    - Save, and a status line.
  - **Under "Where things stand", before the bookings,** a
    `<h3 class="admin-subhead">Awaiting transfer</h3>` holds a search input `#ballTransferSearch`
    (label "Find a payment by reference, name or amount") and `#ballTransfers`.
- [ ] **Script:**
  - `loadBallTransfers()` and `ballTransfersTable(rows)` use the TASK-483 card pattern: a wrapper
    div, a `data-label` on every cell, and cells that wrap with no inner scrolling.
  - Wire `onTransferAction` (delegated) for `data-mark-paid`, `data-pay-by` and `data-cancel-booking`.
    Reuse `onCancelBookingClick`.
  - "Give more time" uses `window.prompt("New pay-by date (YYYY-MM-DD)", <pay_by + 7 days>)`.
  - Admin-ness is `currentRole === "admin"`. The server enforces it either way.
  - Call it from `loadBall()`.
- [ ] **Run** `npx vitest run test/unit/admin-app.test.ts test/unit/admin-ball-layout.test.ts test/unit/admin-fits-a-phone.test.ts`.
- [ ] **Browser check:**
  - extend the stand-in with the admin endpoints;
  - check as an admin and as an editor, at 375 and 1280px;
  - Mark as paid → confirm → the row leaves the list;
  - nothing scrolls sideways.
- [ ] **Commit:** `[TASK-484] Admin: bank details, awaiting transfer, mark paid, more time`.

### Task 13: BDD against Postgres (CI)

**Files:** create `features/ball-bank-transfer.feature` and `features/steps/ball-bank-transfer.steps.js`.
Reuse "the ball is reset to {int} tables of {int} with {int} held back", the @admin user step and
the 2FA login pattern from `ball-report.steps.js`. Clean up rows by the invented
`…transfer.bdd@example.com` addresses.

```gherkin
@admin @ball-transfer
Feature: Paying for the Festive Ball by bank transfer (TASK-484)

  Background:
    Given the ball is reset to 10 tables of 10 with 0 held back
    And an admin user "ann.transfer.admin.bdd@example.com" with role "admin" and password "transfer-pw-123"
    And an admin user "ed.transfer.admin.bdd@example.com" with role "editor" and password "transfer-pw-123"
    And "ed.transfer.admin.bdd@example.com" has Festive Ball edit access

  Scenario: Switched off, the page offers card only
    When I request the ball availability
    Then the ball availability should not offer bank transfer
    When a buyer books 1 table to pay by bank transfer
    Then the transfer booking answer is 409

  Scenario: Only an admin sets the bank details
    When "ed.transfer.admin.bdd@example.com" sets the bank details and switches transfer on
    Then the admin answer is 403
    When "ann.transfer.admin.bdd@example.com" sets the bank details and switches transfer on
    Then the admin answer is 200
    And the ball availability should offer bank transfer

  Scenario: A transfer booking holds its seats and is marked paid by an admin
    Given bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    Then the transfer booking answer is 201 with the bank details and a pay-by date 7 days away
    And the ball availability should show 9 tables remaining
    When "ed.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    Then the admin answer is 403
    When "ann.transfer.admin.bdd@example.com" marks it paid confirming the wrong amount
    Then the admin answer is 409
    When "ann.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    Then the admin answer is 200
    And the booking is paid with a guest link, marked paid by "ann.transfer.admin.bdd@example.com"

  Scenario: A buyer who wants more can book again before paying
    Given bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    And the same buyer books 1 seat to pay by bank transfer
    Then the transfer booking answer is 201 with the bank details and a pay-by date 7 days away
    And the ball availability should show 9 tables remaining

  Scenario: A cancelled transfer booking comes back when its money arrives, if its seats are free
    Given bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    And "ed.transfer.admin.bdd@example.com" cancels it
    And "ann.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    Then the admin answer is 200
    And the booking is paid with a guest link, marked paid by "ann.transfer.admin.bdd@example.com"

  Scenario: A cancelled transfer booking cannot come back once its seats are sold
    Given the ball is reset to 1 tables of 10 with 0 held back
    And bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    And "ed.transfer.admin.bdd@example.com" cancels it
    And a paid ball checkout completes for 1 table
    And "ann.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    Then the admin answer is 409

  Scenario: More time is given by a Festive Ball editor
    Given bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    And "ed.transfer.admin.bdd@example.com" gives it until 14 days from today
    Then the admin answer is 200
    And the booking's pay-by date is 14 days from today

  Scenario: A card checkout left pending for over an hour no longer holds seats
    Given a card checkout for 1 table was started 2 hours ago and never finished
    Then the ball availability should show 10 tables remaining

  Scenario: A transfer booking keeps its seats however old it is
    Given a bank transfer booking for 1 table was made 3 days ago
    Then the ball availability should show 9 tables remaining

  Scenario: An inline checkout replaced by the hosted page leaves one booking
    When I start an inline ball checkout for 1 seat
    And the buyer falls back to the hosted page for the same order
    Then exactly one pending ball booking should hold seats
```

- [ ] **Steps.**
  - **The "has Festive Ball edit access" step** writes
    `UPDATE users SET permissions = jsonb_set(…'{ball}','"edit"')`. Read the column type and the
    shape of the stored map in `migrations/*permissions*.js` first.
  - **Booking times** are set by `INSERT … created_at = now() - interval '2 hours'`.
  - **The cleanup** resets `transfer_on = false` and nulls the bank details in `After`, so other
    features see the shipped state.
- [ ] **Dry run:** `npx cucumber-js --dry-run features/ball-bank-transfer.feature`. Expect no
  undefined or ambiguous steps.
- [ ] **Commit:** `[TASK-484] BDD: bank transfer bookings against a real database`.

### Task 14: README, full suite, review, ship

- [ ] **README.** Add "### Paying by bank transfer (TASK-484)" after "Cancelling a booking (TASK-323)".
  Cover:
  - the switch, and that it ships off;
  - where the bank details live, and that only admins can set them;
  - what a buyer sees;
  - the 7 days;
  - 5 an hour per connection and why, and that there is deliberately no per-email limit;
  - the Awaiting transfer list;
  - Mark as paid being admin-only with the amount check;
  - more time and cancel, and the emails;
  - reinstating;
  - capacity: transfers until settled, card checkouts for an hour;
  - the fallback fix;
  - stages 2 to 5 still to come.

  Update "The admin Festive Ball screen" and the abandoned-checkout lines wherever the README
  repeats "no seats are held".
- [ ] **Full checks:** `npm run lint`, `npx tsc --noEmit -p .` and `npm run test:unit`. The only
  expected failure is perf-budget, the Windows CRLF artefact.
- [ ] **Re-check the task number and migration order:**
  - `gh pr list --state all --limit 5` and `git ls-remote --heads origin "task-48*"`;
  - `ls migrations | tail -3` on `origin/main`, and the open PRs' migrations;
  - merge `origin/main` if it has moved.
- [ ] **Open the PR** `[TASK-484] Paying for the Festive Ball by bank transfer (stage 1, switched off)`
  and bind it to the session.
- [ ] **Run an independent review** in the background, and also the `migration-safety-reviewer`
  agent on the migration.
- [ ] **Fix the findings, merge on green, and check the deploy:**
  - `/health` shows the merge SHA, and the migration exit code is 0;
  - `/api/ball/availability` has `transferOpen: false`;
  - `POST /api/ball/bank-transfer` answers 409;
  - the admin screen shows the Bank transfer settings.
- [ ] **Update the to-do list** (`nbcc-open-todos.md`): stage 1 done.
