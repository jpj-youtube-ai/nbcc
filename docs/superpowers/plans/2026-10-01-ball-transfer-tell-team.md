# Ball bank transfer, stage 4: telling the team — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When someone books the Festive Ball to pay by bank transfer, the team hears about it three ways: an email to events@nbcc.scot, the New pill on Festive Ball (and on the booking's row), and a line in the twice-weekly ticket report.

**Architecture:** A pure staff-email builder beside the buyer emails, sent best effort after the booking commits, as the buyer's bank-details email already is. The pill's "latest arrival" query for `ball` also counts transfer bookings by when they were made. The ticket report gains three counted figures from the same bookings query it already runs, through a pure counter beside `countSales`.

**Tech Stack:** Express + TypeScript, Postgres (node-pg-migrate, none needed here), Vitest (unit and jsdom), Cucumber BDD (CI only).

Spec: `docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md` ("Being told"). Bank transfer stays switched OFF.

---

## File structure

- Create `src/ball/transfer-staff-email.ts`: `buildTransferStaffEmail(booking, { payBy, invoice, adminUrl })`, pure.
- Modify `src/clients/email.ts`: `sendBallTransferStaff` (kind `ballTransferStaff`).
- Modify `src/email/tracked-links.ts`: `ballTransferStaff` is staff only (links untagged).
- Modify `src/ball/transfer-send.ts`: `sendTransferStaffNotice`, to `config.BALL_FROM_EMAIL`, Reply-To the buyer.
- Modify `src/routes/ball-transfer.ts`: call it after a booking.
- Modify `src/db/whats-new.ts`: the `ball` arrival also counts transfer bookings by `created_at`.
- Modify `assets/js/admin/app.js`: a row pill on Awaiting transfer, by `createdAt`.
- Modify `src/ball/sales-report.ts`: `countAwaitingTransfers`, three `SalesInputs` fields, one line under "Sold".
- Modify `src/db/ball-report.ts`: select `payment_method, total_pence`, fill the new fields.
- Tests: `test/unit/ball-transfer-staff-email.test.ts` (new), `ball-transfer-routes.test.ts`, `tracked-links` test, `ball-sales-report.test.ts`, `admin-app.test.ts`; BDD in `features/ball-bank-transfer.feature`.
- README: "Telling the team (TASK-487, stage 4)".

## Task 1: the events@ email

- [ ] Test (`test/unit/ball-transfer-staff-email.test.ts`): the subject names the reference, amount and buyer; the body gives what was booked, the exact amount, pay-by date, the buyer's email, the company and invoice link when invoiced (none otherwise), and the admin link; the buyer's name is escaped; the text part has no markup.
- [ ] Run it: fails (module missing).
- [ ] Write `buildTransferStaffEmail` using `ballEmailShell`, `factsCard`, `money`, `describe`, `longDate`.
- [ ] Run: passes.
- [ ] Test (`tracked-links`): `linkTagsForKind("ballTransferStaff")` is null. Fails, then add it to `STAFF_ONLY_KINDS`.
- [ ] Test (`ball-transfer-routes`): a booking calls `sendTransferStaffNotice` once with the booking, pay-by and invoice; a refused booking does not.
- [ ] Add `sendBallTransferStaff`, `sendTransferStaffNotice` (best effort, logs a failure), and call it from the route.
- [ ] Commit `[TASK-487] An email to events@ for each new bank transfer booking`.

## Task 2: the New pill

- [ ] `ball` in `LATEST` (`src/db/whats-new.ts`) becomes the later of the latest paid booking and the latest transfer booking made:
  `SELECT max(at) AS at FROM (SELECT paid_at AS at FROM ball_bookings WHERE status = 'paid' AND paid_at > $1 UNION ALL SELECT created_at FROM ball_bookings WHERE payment_method = 'transfer' AND created_at > $1) x`.
  It is SQL, so it is tested by BDD: a new transfer booking lights Festive Ball for an admin who had opened it before.
- [ ] Test (`admin-app.test.ts`): an Awaiting transfer row made after the last visit carries the New pill; an older one does not. Fails, then add `rowNewPill("ball", t.createdAt)` after the reference.
- [ ] Commit `[TASK-487] The New pill for a new bank transfer booking`.

## Task 3: the ticket report

- [ ] Test (`ball-sales-report.test.ts`): `countAwaitingTransfers` counts pending transfer bookings only (not paid, cancelled, or pending card); the report says "12 more seats are booked and waiting for a bank transfer (2 bookings)" under Sold, says nothing when there are none, and uses the singular for one. **No money:** the report deliberately carries none (Jaimie's rule, TASK-464), so the "total" is in seats.
- [ ] Run: fails.
- [ ] Add `paymentMethod` to `BookingRow` (optional), `countAwaitingTransfers`, two `SalesInputs` fields, the line, and the query change in `readSalesInputs`.
- [ ] Run: passes. Commit `[TASK-487] The ticket report counts bookings waiting for a bank transfer`.

## Task 4: BDD, README, review, ship

- [ ] BDD: after a transfer booking, the admin's whats-new says Festive Ball is new.
- [ ] README section.
- [ ] `npm run lint && npm run build && npm run test:unit`; independent review; `/ship`.
