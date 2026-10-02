# Admin Overview stage 1: Needs you — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin Overview opens with "Needs you": every waiting item the person may see, most urgent first, each one click from its screen.

**Architecture:** A pure catalogue and wording (`src/admin/overview.ts`: `needsLines`), an orchestrator that runs only the sources a person may see, each independently (`src/admin/overview-sources.ts`: `gatherNeeds(perms, readers, now)`), the real readers wired to the same database functions and rules each screen already uses (`src/routes/admin-overview.ts`), and the screen (`admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css`).

**Tech Stack:** Express + TypeScript, Vitest (unit and jsdom), Cucumber BDD (CI only). No migration.

Spec: `docs/superpowers/specs/2026-10-03-admin-overview-design.md`. Ships as TASK-507.

---

## The sources (each with the gate its own screen uses, and the code it reuses)

| Key | Level | Gate | Count from |
|---|---|---|---|
| `transfersOverdue` | 1 | ball: view | `listAwaitingTransfers()` where `isOverdue(payBy, londonDate(now))` |
| `monthlyFailing` | 1 | donations: view | `listMonthlySupporters()` where `state === "past_due"` |
| `giftAidReady` | 1 | claims: view | `listEligibleForClaim()` (count, and total of `amount_pence`) |
| `emailFailures` | 1 | email-audit: view | `listRecentEmailFailures(14, 200)` |
| `fundraisingDueBack` | 1 | fundraising: view | `requestViews(...)` with a `dueBack` view, per fundraiser |
| `contactWaiting` | 2 | contact: view | `countUnanswered()` |
| `fundraisingNew` | 2 | fundraising: view | `listAllFundraisers()` where `status === "new"` |
| `fundraisingChanges` | 2 | fundraising: view | `editWaiting` |
| `fundraisingFinished` | 2 | fundraising: view | `finishedRequestedAt && status === "approved"` |
| `fundraisingRequests` | 2 | fundraising: view | `requestsToDo(...)` |
| `fundraiserCalls` | 2 | fundraising: view | `callStates(...).due` |
| `storiesNew` | 2 | stories: view | `listStories({ status: "new" })` |
| `businessCalls` | 2 | business-supporters: edit | `listBusinessFulfilments()` with `callDue(...)` as the route does |
| `outreachMine` | 2 | outreach: view | `listOutreachForTodo()`, mine, through `whatIsNeeded` |
| `thankYouLetters` | 2 | thank-you: view | `listThankYouEligible(DEFAULT)` where not `alreadyThanked` |
| `transfersWaiting` | 2 | ball: view | awaiting transfers not overdue |
| `giftAidAdjustments` | 3 | claims: view | `listAdjustmentDueDonations()` |
| `declarationsAwaiting` | 3 | claims: view | `listAwaitingDeclarationDonations()` |
| `declarationsReview` | 3 | claims: view | `listDeclarationsDueReview()` |
| `retentionExpiring` | 3 | claims: view | `listRetentionExpiryDeclarations()` |
| `gasdsDeadline` | 3 | gasds: view | `listGasdsDeadlineDonations()` |
| `ballGuestsMissing` | 3 | ball: view | `summariseGuestProgress(listGuestProgress())`, only when `guestDetailsLockAt` is within 21 days |

The fundraising sources share one read of the fundraisers, calls and request rows per request.

## Tasks

- [ ] **1. Wording and order** (`test/unit/admin-overview.test.ts`, `src/admin/overview.ts`). Test first: each key's sentence in singular and plural ("1 contact message is waiting for a reply" / "3 contact messages are waiting for a reply"); money shown for Gift Aid ready; zeros left out; levels 1, 2, 3 in that order and catalogue order within a level; each line names its screen (`view` and `button`).
- [ ] **2. Gathering** (`src/admin/overview-sources.ts`). Test first: a source whose section the person cannot see is never called; a source that throws is listed in `failed` by its screen name and the rest still count; a source can return several keys (the fundraising one).
- [ ] **3. The route** (`src/routes/admin-overview.ts`, mounted in `src/app.ts`): `GET /api/admin/overview` needs a session (401), answers `{ updatedAt, needs, failed }`. The real readers, as in the table. Unit test with the database modules mocked: an admin with everything waiting sees the lines; a viewer sees no business, email or analytics lines.
- [ ] **4. The screen.** Test first (`test/unit/admin-app.test.ts`): "Needs you" lines with their dots and buttons; a button opens its screen; the quiet day; "Could not check: …"; the whole thing failing; recent donations cut to 5; the five old cards gone. Check in headless Chrome at 1280 and 375.
- [ ] **5. BDD, README, review, ship.** `features/admin-overview.feature`: an admin sees a waiting contact message and a new fundraising sign up; a viewer without contact access does not see the contact line; no session is 401.
