# Ball bank transfer, stage 5: staff add a booking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff with Festive Ball edit can add a bank transfer booking in the admin, for phone and email orders, with the same fields and the same emails as the public form, ticking that the buyer agreed to the terms.

**Architecture:** The booking logic in `postBankTransfer` moves into `placeTransferBooking` (`src/ball/place-transfer-booking.ts`), shared by the public route and a new admin route `POST /api/admin/ball/transfer-bookings`. The public route keeps its rate limit and public rules; the staff route needs Festive Ball edit and records who added it. A form under Awaiting transfer calls it.

**Tech Stack:** Express + TypeScript, Postgres (no migration), Vitest (unit and jsdom), Cucumber BDD (CI only).

Spec: `docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md` ("Phone and email bookings", "Who marks a booking paid").

## Decisions (defaults, said to Jaimie)

- **Works with the public switch off**, once the bank details are entered: staff can take a phone order, or Jaimie can make a test booking, before the ticket page offers it. It ignores "Close sales now" as holds do. It still needs room, and is refused after the last day for transfers.
- **No Gift Aid and no newsletter on the staff form.** A Gift Aid declaration made over the phone needs its own written record, and a newsletter sign-up records consent from the buyer's own hand. Both are sent false.
- **The terms tick is required:** "The buyer has agreed to the ticket terms".
- **Who added it:** an audit row `ball.transfer_booking_added` with the staff member, and the events@ email says who added it. No new column.

## Tasks

- [ ] **1. Share the booking logic.** Move it into `placeTransferBooking(raw, { now, addedBy })`, returning `{ ok: true, reference, totalPence, payBy, bank, invoiceUrl? }` or `{ ok: false, status, body }`. With `addedBy` null the public rules apply (switch on, sales open); with it set only the bank details are needed, and Gift Aid and newsletter are forced false. The existing `ball-transfer-routes.test.ts` must stay green unchanged (refactor under test).
- [ ] **2. Record who added it.** `createTransferBooking(write, payBy, invoice, addedBy)` writes the audit row when `addedBy` is set. `buildTransferStaffEmail` takes `addedBy` and says "Added by … in the admin, for a phone or email order." Test first.
- [ ] **3. The staff route.** Test first (`test/unit/admin-ball-transfer-add.test.ts`): 401 without a session; 403 for view only; 201 for Festive Ball edit, with the switch off; Gift Aid and newsletter false; the terms must be ticked (400); refused without bank details (409, "Enter the bank details under Set up first"); the buyer and events@ emails sent, the second naming who added it.
- [ ] **4. The form.** Test first (`admin-app.test.ts`): an "Add a bank transfer booking" button for Festive Ball edit, none for view only; it opens the form; invoice fields appear when ticked; it posts the right body; the answer shows the reference, the amount and the pay-by date, and the Awaiting list reloads.
- [ ] **5. BDD, README, review, ship.** BDD: an editor with Festive Ball edit adds a booking while the switch is off, and it holds its seats and is listed; a viewer cannot.
