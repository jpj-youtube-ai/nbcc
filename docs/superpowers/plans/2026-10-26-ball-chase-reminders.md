# Festive Ball chase reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every-other-day reminders, with a countdown, to Ball bookers still missing guest names or meal choices, and a matching chase list for the volunteers, all from the existing 8am job.

**Architecture:** A pure planner (`src/ball/chase.ts`, clock passed in, like `src/ball/run-up.ts`) decides the round day, who is incomplete and how to group them; pure email builders (`src/ball/chase-email.ts`); a runner (`src/ball/chase-runner.ts`) wires the database, mailer and claim-the-day idempotency (the pattern of `src/ball/sales-report-runner.ts`) and is called from `src/scripts/send-reminders.ts` after the run-up pass. TASK-338's guest chase and last-call stages are switched off. A small admin card in the Ball admin's Emails section edits the volunteers' list and sends tests.

**Tech Stack:** TypeScript, Express, Postgres (node-pg-migrate), Zod, Vitest (jsdom for the admin script), Cucumber (CI only; no local database).

**Spec:** `docs/superpowers/specs/2026-10-26-ball-chase-reminders-design.md` (read it first; this plan argues from it).

## Global Constraints

- Round days: the UK days **7, 5, 3 and 1** before the deadline day get a reminder; days **7, 5, 3, 1 and 0** get the volunteers' list. Deadline = the existing `guestDetailsLockAt` setting. Nothing at all when it is null, after the deadline day, or on/after the Ball day (`BALL_DAY`, `src/ball/sales-report-runner.ts`).
- Count days by the date in Europe/London (`londonDate`, `src/ball/sales-report.ts`), never by subtracting hours.
- Incomplete = `guestsNamed < seats`, or any named guest fails `hasChosen(choice, menu)` (`src/ball/menu.ts`). With no choosable course only names count.
- Reminder scope: `status = 'paid'`, `buyer_email <> ''`, `guest_token` not null. One email per lower-cased buyer address per round, covering all its incomplete bookings.
- A booking whose `reminder_sent_at` falls on today's London date (the week-to-go email went this morning) is left out of today's reminder.
- Exact copy: the action box comes first; "If we haven't heard from you by 10am on Wednesday 4th November, we'll choose for you." (time and date words from the deadline setting; dates in the house style of `src/email/dates.ts`). Subjects: "`N` days to go: your Festive Ball guests and meals"; on day 1 "Last chance: your Festive Ball guests and meals by 10am tomorrow".
- Volunteers' list addresses: typed in the admin, must end `@nbcc.scot`, at most 10. No real names, emails or phone numbers anywhere in code, tests, fixtures or docs (the repo is public).
- Copy rules: no en or em dashes in visible wording, no new hyphenated words; touch targets 44px on a phone; nothing scrolls sideways; no box gets its own scrollbar.
- Migration additive only, and its file must sort LAST in `migrations/` (above `1791200000290`).
- README updated in the same branch. Tests with every task.

## Review Focus

1. **The clocks went back on 25 October.** The deadline 2026-11-04 10:00 London is 10:00Z; round days must come out as 28 Oct, 30 Oct, 1 Nov, 3 Nov whatever the hour the job runs. Test in Task 1 with `now` at 08:00 London on each day and at 23:30 London the day before.
2. **The job or a staff test running twice in one morning.** No booker or volunteer gets a second email that day; a failed send can be retried the same day. Tested in Task 4 (BDD: run the pass twice).
- 3. **A booker with two bookings, one complete and one not.** One email listing only the incomplete booking. Task 1 and Task 2 tests.
- 4. **Menu text edited so an old choice no longer matches.** That guest counts as not chosen and the booking is reminded. Task 1 test using `hasChosen`.
- 5. **The volunteers' list is empty, or the deadline is moved or cleared after rounds began.** Reminders still go with no list; a cleared deadline sends nothing; a moved one follows the new date. Task 1 and Task 4 tests.

---

### Task 1: The pure planner

**Files:**
- Create: `src/ball/chase.ts`
- Test: `test/unit/ball-chase.test.ts`

**Interfaces:**
- Consumes: `hasChosen`, `choosableCourses`, `MenuCourse` (`src/ball/menu.ts`); `londonDate` (`src/ball/sales-report.ts`).
- Produces:
  - `interface ChaseBooking { id: number; reference: string; status: "paid" | "pending"; paymentMethod: string; buyerName: string; buyerFirstName: string | null; buyerEmail: string; buyerPhone: string | null; guestToken: string | null; seats: number; choices: Array<string | null>; reminderSentOn: string | null /* YYYY-MM-DD London */ }` (`choices` has one entry per named guest, as `listMenuProgress` reads them).
  - `chaseDay(now: Date, lockAt: Date | null, ballDay: string): { daysToDeadline: number; reminder: boolean; list: boolean } | null` (null when nothing goes today).
  - `missing(b: ChaseBooking, menu: MenuCourse[]): { unnamed: number; unchosen: number }` (`unchosen` counts named guests only).
  - `isIncomplete(b, menu): boolean`.
  - `interface ReminderGroup { email: string; firstName: string; bookings: Array<ChaseBooking & { unnamed: number; unchosen: number }> }`
  - `planReminders(bookings: ChaseBooking[], menu: MenuCourse[], today: string): ReminderGroup[]` (paid, emailable, has token, incomplete, not `reminderSentOn === today`; grouped by lower-cased trimmed email; `firstName` from the first booking's `buyerFirstName` or `buyerName`'s first word).
  - `interface ChaseList { toChase: Row[]; cannotEmail: Row[]; awaitingPayment: Row[]; complete: number; unnamed: number; unchosen: number }` where `Row = ChaseBooking & { unnamed: number; unchosen: number }`; `planList(bookings, menu): ChaseList` (each section sorted by `unnamed + unchosen` descending, then reference; `awaitingPayment` = `status "pending"` and `paymentMethod "transfer"`, all of them, missing counted as all seats unnamed).
  - `export const REMINDER_DAYS = [7, 5, 3, 1]; export const LIST_DAYS = [7, 5, 3, 1, 0];`

- [ ] **Step 1: Write the failing tests**, including at least:
  - `chaseDay` with lockAt `2026-11-04T10:00:00Z`, ballDay `2026-11-07`: 2026-10-28T08:00Z gives `{7, reminder true, list true}`; 10-29 gives null; 10-30 `{5,…}`; 11-01 `{3,…}`; 11-03 `{1, true, true}`; 11-04T08:00Z `{0, reminder false, list true}`; 11-05 null; lockAt null gives null; 2026-10-27T23:30Z (23:30 London on the 27th) gives null.
  - A lockAt of 2026-11-08 (after the Ball) still never returns a day on or after 2026-11-07.
  - `missing`: 10 seats, choices `[BOTH, ONLY_MAIN, null]` with a two-course menu gives `{ unnamed: 7, unchosen: 2 }`; a menu with no choosable course gives `unchosen: 0`.
  - `planReminders`: two bookings for `A@Example.com` and `a@example.com`, one complete, gives one group with one booking; a booking with `reminderSentOn` equal to today is left out; pending, no-email and no-token bookings are never in a group.
  - `planList`: sections and sort order as above; `complete` counts paid complete bookings.
  Use invented fixtures only (example.com, invented names).
- [ ] **Step 2:** `npx vitest run --minWorkers=1 --maxWorkers=3 test/unit/ball-chase.test.ts`. Expected: FAIL, cannot find `src/ball/chase`.
- [ ] **Step 3:** Implement `src/ball/chase.ts` (pure: no pool, no network, no clock of its own).
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `src/ball/chase.ts test/unit/ball-chase.test.ts` with message "Ball chase: the pure planner".

### Task 2: The two emails

**Files:**
- Create: `src/ball/chase-email.ts`
- Modify: `src/email/catalogue.ts` (two Ball entries; retire the wording of `ball-guest-chase` and `ball-guest-last-call` by removing those two entries, since Task 4 switches them off)
- Test: `test/unit/ball-chase-email.test.ts`; update `test/unit/email-catalogue*.test.ts` only where they pin the removed entries.

**Interfaces:**
- Consumes: `ReminderGroup`, `ChaseList` (Task 1); `ballEmailShell`, `contactPanel`, `BALL_TEXT_FOOTER` (`src/ball/email-shell.ts`); `escapeHtml` (`src/ball/page.ts`); the brand colours (`src/email/brand.ts`); `emailDate` and `raiseOrdinals` (`src/email/dates.ts`) for date words: plain "Wednesday 4th November" in subjects and the text part, the ending raised in HTML (the house style; new emails use it even though the older Ball emails keep `readableDate` until after the Ball). The time words ("10am", "4.30pm") come from the deadline in Europe/London.
- Produces:
  - `buildChaseReminderEmail(i: { group: ReminderGroup; daysToDeadline: number; deadline: Date; guestLink: (token: string) => string }): { subject: string; html: string; text: string }`
  - `buildChaseListEmail(i: { list: ChaseList; daysToDeadline: number; deadline: Date; guestLink: (token: string) => string; test?: boolean }): { subject: string; html: string; text: string }`
  - `exampleReminderGroup(): ReminderGroup` and `exampleChaseList(): ChaseList` (invented data, used by the catalogue and the admin tests in Task 5).

- [ ] **Step 1: Write the failing tests:**
  - reminder subject is "7 days to go: your Festive Ball guests and meals" at 7, and "Last chance: your Festive Ball guests and meals by 10am tomorrow" at 1;
  - the html's first content block after the shell's header is the action box: it contains "by 10am on Wednesday 4<sup>th</sup> November" in the html and "by 10am on Wednesday 4th November" in the text, the missing lines ("7 of your 10 seats still need a name", "2 of your guests still need to choose their meals"; singular forms "1 of your 2 seats still needs a name", "1 of your guests still needs to choose"), and the button linking `guestLink(token)`; the greeting comes after it (assert index of the button < index of "Hello");
  - its text part says "If we haven't heard from you by 10am on Wednesday 4th November, we'll choose for you." (the html the same with the ending raised) and neither part says "ring" or "call you";
  - a group with two bookings shows both references, each with its own link and missing lines;
  - only-names case (unchosen 0) has no meals line; the text part carries the same facts; a name with `<script>` is escaped;
  - list subject "Festive Ball chase list: N bookings to chase, 7 days to go" (day 0: "Festive Ball chase list: N bookings to chase before 10am today"); each row shows name, phone or "no phone given", email, reference, "6 of 10 seats named", "4 of 6 meals chosen", link; the three section headings "To chase", "Paid, but we cannot email them", "Waiting for their bank transfer"; an empty section is left out; `test: true` puts "This is a test with made-up bookings" at the top;
  - no visible en or em dash in any output.
- [ ] **Step 2:** Run the new test file. Expected: FAIL.
- [ ] **Step 3:** Implement `src/ball/chase-email.ts` and the catalogue entries `ball-chase-reminder` (audience public, logKinds `["ballRunUp"]`, versions: usual at 7 days, last chance at 1 day, names only, two bookings) and `ball-chase-list` (audience staff, logKinds `["ballChaseList"]`, versions: usual, deadline morning, test). Remove `ball-guest-chase` and `ball-guest-last-call`.
- [ ] **Step 4:** Run the new file plus `test/unit/email-catalogue.test.ts test/unit/email-catalogue-guard.test.ts test/unit/email-catalogue-wording-pass.test.ts test/unit/admin-all-emails-panel.test.ts`. Expected: PASS (fix only pins on the removed entries).
- [ ] **Step 5:** Commit with message "Ball chase: the reminder and the volunteers' list emails".

### Task 3: Storage

**Files:**
- Create: `migrations/1791200000300_ball-chase.js`
- Create: `src/db/ball-chase.ts`
- Modify: `src/clients/email.ts` (add `sendBallChaseList`, kind `ballChaseList`, modelled on `sendBallReport`; add the kind wherever email kinds are listed or constrained, including any DB check constraint, in this migration if one exists)
- Test: `test/unit/ball-chase-settings.test.ts` (the recipients schema)

**Interfaces:**
- Produces:
  - Migration: `ball_settings.chase_recipients jsonb NOT NULL DEFAULT '[]'`; table `ball_chase_sends (id serial pk, kind text NOT NULL CHECK (kind IN ('reminder','list')), sent_on date NOT NULL, recipient text NOT NULL, status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','sent')), booking_ids int[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (kind, sent_on, recipient))`. Down drops both.
  - `chaseRecipientsSchema` in `src/db/ball-chase.ts` (or `src/ball/chase.ts` if kept pure): `recipientsSchema` from `src/ball/sales-report.ts` plus a refine that every email ends `@nbcc.scot` (message "Only nbcc.scot addresses: this list carries people's phone numbers.") and max 10.
  - `listChaseBookings(): Promise<ChaseBooking[]>` (paid bookings, plus pending bank-transfer ones; choices aggregated as `listMenuProgress` does; `reminderSentOn` = `to_char(reminder_sent_at AT TIME ZONE 'Europe/London','YYYY-MM-DD')`).
  - `getChaseRecipients(): Promise<Recipient[]>`, `saveChaseRecipients(list: Recipient[], actor: string): Promise<void>` (with a `recordAudit` row).
  - `claimChaseSend(kind: "reminder" | "list", sentOn: string, recipient: string): Promise<number | null>` (INSERT ... ON CONFLICT DO NOTHING RETURNING id; null when already claimed), `markChaseSent(id: number, bookingIds: number[]): Promise<void>`, `releaseChaseClaim(id: number): Promise<void>` (deletes a `claimed` row).
  - `sendBallChaseList(o: { to: string[]; from: string; replyTo: string; subject: string; html: string; text: string }): Promise<void>`.

- [ ] **Step 1:** Write the failing schema test: an `@nbcc.scot` list saves tidied and sorted; `someone@example.com` is refused with the message above; 11 addresses refused; a duplicate refused.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Write the migration, `src/db/ball-chase.ts` and the sender. Then check `ls migrations | sort | tail -2` shows the new file last.
- [ ] **Step 4:** Run the test, `npx tsc --noEmit`, `npm run lint`. Expected: PASS and clean. Dispatch the `migration-safety-reviewer` agent on the migration.
- [ ] **Step 5:** Commit with message "Ball chase: storage, the volunteers' list setting and its sender".

### Task 4: The daily pass, and switching off the old chase

**Files:**
- Create: `src/ball/chase-runner.ts`
- Modify: `src/scripts/send-reminders.ts` (a new try/catch block right after the run-up pass, same shape as its neighbours, logging a one-line summary)
- Modify: `src/ball/run-up.ts` (`guestStageFor` returns null: the chase and final-call stages are retired, comment saying TASK-576 replaced them; keep the types so old stamps still read)
- Modify: `test/unit/` tests that pin the retired stages (find with `grep -rln "final-call\|stageFor\|guestStageFor" test/unit`), updating them to assert the stages never fire
- Modify: `features/ball-guests.feature` or create `features/ball-chase.feature` + steps in `features/steps/ball.steps.js`
- Modify: `admin.html` + `assets/js/admin/app.js`: remove the "Email everyone outstanding" button and its note from the Guests and menu section (the route stays, now sending only the week-to-go email); update `test/unit/admin-ball-*.test.ts` that reference `#ballChase`

**Interfaces:**
- Consumes: Tasks 1 to 3; `getSettings` (`src/db/ball.ts`, `guestDetailsLockAt`, `menuOptions`), `parseMenu`, `BALL_DAY`, `config.BALL_BASE_URL`, `config.BALL_FROM_EMAIL`, `sendBallRunUp`.
- Produces: `runBallChase(now = new Date()): Promise<{ day: number | null; reminders: number; failed: number; listSent: boolean }>`.

Order inside `runBallChase`: compute `chaseDay`; if null return. Reminders first: for each `ReminderGroup`, `claimChaseSend("reminder", today, email)`; null means skip; send; `markChaseSent`; on a failed send `releaseChaseClaim` and count it. Then the list, if `list` and recipients exist: claim `("list", today, "*")`, read bookings again (so this morning's state is shown), send one email to all recipients, mark or release.

- [ ] **Step 1: Write the failing BDD scenarios** (run the compiled runner with a chosen `now`, as `features/steps/fundraising-teams.steps.js:227` runs `dist/fundraising/team-runner.js`; check sends in `email_log`):
  - deadline set to 2026-11-04T10:00:00Z, the menu set, an incomplete paid booking and a complete one: running the pass at 2026-10-28T08:00:00Z logs one `ballRunUp` email, to the incomplete booker only; running it again the same morning logs no more;
  - at 2026-10-29T08:00:00Z nothing is sent;
  - with two `@nbcc.scot` recipients saved, one `ballChaseList` email is logged that morning, and again at 2026-11-04T08:00:00Z, when no reminder goes;
  - with the deadline cleared, nothing is sent;
  - the old run-up pass at a date inside the old chase window sends no chase email.
- [ ] **Step 2:** `npm run build` then `npx cucumber-js --dry-run`. Expected: the new steps resolve (BDD itself runs only in CI).
- [ ] **Step 3:** Implement the runner, the hook, the run-up change and the admin removal.
- [ ] **Step 4:** Run the affected unit files (`ball-run-up*`, `admin-ball-*`, `ball-chase*`), `npx tsc --noEmit`, `npm run lint`, `npm run build`, dry run. Expected: PASS and clean.
- [ ] **Step 5:** Commit with message "Ball chase: the daily pass, and the old guest chase retired".

### Task 5: The admin card

**Files:**
- Create: `src/routes/admin-ball-chase.ts` (mounted in `src/app.ts` beside `adminBallReportRouter`)
- Modify: `admin.html` (a new `<article class="ball-email" aria-labelledby="ballChaseHead">` first in the Emails section's `.ball-emails`), `assets/js/admin/app.js`, `assets/css/admin.css` only if the existing `.ball-email` and `ev-report` list styles do not cover it
- Test: `test/unit/admin-ball-chase-card.test.ts` (jsdom, the harness style of `test/unit/admin-ball-sections.test.ts`); BDD scenarios for the routes

**Interfaces:**
- Consumes: Tasks 1 to 4; `authorizeSection(req, res, "ball", "view" | "edit")`.
- Produces:
  - `GET /api/admin/ball-chase` (ball view): `{ recipients: Recipient[]; deadline: string | null; nextRound: { day: string; daysToDeadline: number; reminders: number } | null; lastSends: Array<{ kind: string; sentOn: string; count: number }> }`.
  - `PUT /api/admin/ball-chase` (ball edit): body `{ recipients }`, 400 with the schema's message on a bad address, 200 with the GET shape.
  - `POST /api/admin/ball-chase/test` (ball edit): body `{ which: "reminder" | "list" }`, sends the example email (Task 2's examples, `test: true` for the list) to the signed-in staff member's own address only; 200 `{ sentTo }`.
- Card copy (exact): heading "Chasing guests and meals"; note "Automatic. At 8am on the 7th, 5th, 3rd and last day before the guest details deadline, everyone who has paid and still has a seat without a name or a guest who hasn't chosen gets a reminder with a countdown. The chase list goes to the people below on those mornings and on the deadline morning."; a line built from `nextRound` ("Next reminder: Wednesday 28 October, to 23 bookers.") or "Set the guest details deadline in Set up to start the reminders."; the list editor (name, email, Add, Save) for the volunteers; buttons "Send me a test reminder" and "Send me a test chase list" (44px).
- [ ] **Step 1:** Write the failing jsdom test (the copy above shows; Save PUTs the list; a refusal message shows inline with `is-error`, not `err`; the two test buttons POST the right `which`) and the failing BDD scenarios (an editor saves two nbcc.scot addresses; an `example.com` address gets 400; a viewer cannot PUT; the test endpoint logs one email to the signed-in admin).
- [ ] **Step 2:** Run the jsdom test and the dry run. Expected: FAIL / resolves.
- [ ] **Step 3:** Implement routes and card.
- [ ] **Step 4:** Run the new and affected admin unit tests, tsc, lint, build, dry run. Check the card in the browser at 1280 and 375 widths (stand-in server or the jsdom harness): nothing scrolls sideways, buttons 44px.
- [ ] **Step 5:** Commit with message "Ball chase: the admin card for the volunteers' list and tests".

### Task 6: README and the finish

**Files:**
- Modify: `README.md` (the Ball section beside TASK-338's run-up and the menu email: the rounds, the copy decisions, the volunteers' list and its nbcc.scot rule, the retired chase, the release order "set the deadline after it is live")

- [ ] **Step 1:** Write the README section.
- [ ] **Step 2:** Run the full unit suite once (`npx vitest run --minWorkers=1 --maxWorkers=3`; expected failures only the known Windows pair `perf-budget` and `footer-master`), lint, build, dry run.
- [ ] **Step 3:** Commit, then finish with the repo's /ship steps (task number at PR time, CI green on the head, squash merge, deploy by SHA, live check of `/health`).
