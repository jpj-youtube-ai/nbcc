# Ball bank transfer, stage 2 (TASK-485): deadlines, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** the deadline decisions from `docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md`:
- a reminder email 2 days before a transfer booking's pay-by date;
- an "Overdue" flag on the admin's Awaiting transfer list once the date has passed;
- a "last day for transfers to arrive", set in the admin. Every deadline shortens to fit it, and
  after it the page offers card only.

Nothing is cancelled automatically (the client's choice): staff decide.

**Architecture:**
- **Pure rules** go in `src/ball/transfer.ts`.
- **The reminder pass** goes in `src/ball/transfer-reminders.ts`, with the same pure pass plus
  wiring split as the run-up, and joins the existing daily 8am job (`src/scripts/send-reminders.ts`)
  in its own try/catch.
- **One additive migration:** `ball_bookings.transfer_reminder_sent_at` and
  `ball_settings.transfer_last_day`.
- The switch stays off.

## Tasks (test first throughout)

1. **Migration** `1791000000002_ball-transfer-deadlines.js` (renumbered above the analytics migrations, which merged first; originally planned below the parked analytics
   migrations (`1791000000000/1`), like stage 1's). Add:
   - `ball_bookings.transfer_reminder_sent_at timestamptz` (nullable);
   - `ball_settings.transfer_last_day date` (nullable).
2. **Rules** (`test/unit/ball-transfer.test.ts`):
   - `transferPayBy(now, lastDay, days = 7)` is the earlier of today plus `days` and `lastDay`;
   - `transferWindowOpen(now, lastDay)` is true while there is no last day or today (UK) is on or
     before it;
   - `publicTransferOpen(salesOpen, settings, now)` also needs the window to be open;
     `TransferSettings` gains `lastDay`;
   - `isOverdue(payBy, today)` is true when `today > payBy`;
   - `reminderDue({ payBy, createdDay, remindedAt }, today)` holds when:
     - no reminder has been sent;
     - today is within the 2 days before the date, inclusive;
     - today is not past the date;
     - the booking was made before today, so someone booking with a short deadline is not
       reminded on the day they booked.
3. **The reminder email** (`buildTransferReminderEmail` in `src/ball/transfer-email.ts`):
   - subject: "Reminder: please pay for your Festive Ball booking BALL-X by Thursday 8 October";
   - the same bank details, amount and reference as the first email;
   - "If you've already paid, thank you, there's nothing more to do.";
   - add it to the copy-standards surfaces.
4. **The pass** (`src/ball/transfer-reminders.ts`, `runTransferReminderPass({ list, send, markSent, today })`):
   - it sends to each booking with `reminderDue`, and marks it sent only once the send succeeds;
   - one failure does not stop the rest;
   - it returns `{ considered, sent, failed }`;
   - unit tests use fakes.

   The wiring (`runTransferReminders()`) reads the bank details, and skips everything when they
   are not set. Add it to `send-reminders.ts`.
5. **The SQL** (`src/db/ball-transfer.ts`):
   - `getTransferSettings` and `saveTransferSettings` handle `lastDay`;
   - `listTransfersForReminder()` lists pending transfers not yet reminded, with the UK date they
     were made;
   - `markTransferReminderSent(id)`;
   - `listAwaitingTransfers` adds `reminded: boolean`.
6. **Routes:**
   - `POST /api/ball/bank-transfer` refuses after the last day: 409 "Bank transfer has closed.
     Please pay by card." It uses `transferPayBy(now, lastDay)`.
   - The availability feed uses the window.
   - `PUT /api/admin/ball/transfer-settings` takes `lastDay` (a real date, or `null` to clear it),
     admin only.
   - `GET /api/admin/ball/transfers` adds `overdue` (from `isOverdue` with the UK date).
7. **Admin screen:**
   - a "Last day for transfers to arrive" date input in the Bank transfer form;
   - the Awaiting transfer rows show an "Overdue" pill (`admin-pill`, crimson tint) next to the
     date when overdue, and "Reminder sent" in the small print when reminded;
   - jsdom tests.
8. **BDD:**
   - a last day in the past means the feed says off and a booking gets 409;
   - a last day 3 days on means a new booking's pay-by is that day;
   - a transfer booking whose date has passed is listed as overdue.
9. **README** (extend "Paying by bank transfer"), full suite, review, ship.
