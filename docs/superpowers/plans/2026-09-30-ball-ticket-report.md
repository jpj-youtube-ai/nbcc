# Festive Ball ticket report: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Twice a week (Tuesday and Thursday, 8am UK) one branded email with anonymous Festive Ball ticket numbers goes to recipients managed on Admin → Events.

**Architecture:** A pure module decides the figures, whether a report is due, and the email's words. A small DB module reads the inputs and records sends; the existing daily 8am job calls a runner that joins them. The admin manages the switch and recipients through one new router. SES gains an optional `alsoTo` list so one message can go to several people.

**Tech Stack:** Express + TypeScript, zod, node-postgres, node-pg-migrate, Vitest (jsdom), Cucumber against Postgres in CI, the admin's plain JS.

Spec: `docs/superpowers/specs/2026-09-30-ball-ticket-report-design.md`. Every person in every test is invented.

---

## File map

- Create `src/ball/sales-report.ts` (pure) and `test/unit/ball-sales-report.test.ts`.
- Modify `src/clients/ses-request.ts` (`alsoTo`), `src/clients/email.ts` (`sendBallReport`), with tests.
- Create `migrations/1789100000004_ball-report.js`; update `test/unit/backup-plan.test.ts` counts and README.
- Create `src/db/ball-report.ts`.
- Create `src/ball/sales-report-runner.ts`; modify `src/scripts/send-reminders.ts`.
- Create `src/routes/admin-ball-report.ts`; modify `src/app.ts`.
- Create `features/ball-report.feature`, `features/steps/ball-report.steps.js`.
- Modify `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css`, `test/unit/admin-shell.test.ts`.

### Task 1: The pure report (`src/ball/sales-report.ts`)

Exports:

```ts
export const REPORT_WEEKDAYS: readonly number[] = [2, 4]; // Tuesday, Thursday (0 = Sunday)
export const MAX_RECIPIENTS = 10;
export const recipientsSchema; // z.array({ email: trimmed, lowercased, valid; label: trimmed, max 60 }), max 10, emails unique
export type Recipient = { email: string; label: string };

export interface SalesInputs {
  totalSeats: number;          // 400
  seatsSold: number;           // paid only
  tablesSold: number;          // whole tables, paid
  singleSeatsSold: number;     // seats bought one at a time, paid
  seatsRemaining: number;      // from availability()
  tablesRemaining: number;     // from availability()
  heldSeats: number;           // kept back for guests
  soldSinceLast: number | null;// null before the first scheduled report
  soldLast7Days: number;
  soldPrevious7Days: number;
  waitingList: number;         // people
}
export interface ReportContext { today: string /* YYYY-MM-DD, UK */; eventDate: string /* 2026-11-07 */; test: boolean }

export function londonDate(at: Date): string;            // YYYY-MM-DD in Europe/London
export function londonWeekday(at: Date): number;          // 0..6 in Europe/London
export function nextUpdateAfter(today: string, eventDate: string): string | null; // next Tue/Thu after today, or null when that is after the Ball
export function daysToGo(today: string, eventDate: string): number;
export function reportDue(o: { now: Date; reportOn: boolean; recipients: number; eventDate: string; sentToday: boolean }): boolean;
export function renderReport(inputs: SalesInputs, ctx: ReportContext): { subject: string; html: string; text: string };
```

Tests (`test/unit/ball-sales-report.test.ts`), each failing before the module exists:
- `londonDate`/`londonWeekday` read the UK day (23:30 UTC in summer is the next day).
- `nextUpdateAfter`: Tuesday → Thursday; Thursday → next Tuesday; Wednesday → Thursday; Thursday 5 Nov → null (Tuesday 10 Nov is after the Ball).
- `daysToGo`: 7 Oct → 31; the day itself → 0.
- `reportDue`: true only on Tue/Thu with the switch on, recipients, not sent today, and today on or before the Ball; false for each missing condition, and on the Saturday of the Ball and after.
- `recipientsSchema`: trims and lowercases; refuses a bad address, an 11th recipient, a duplicate, a 61-character label.
- `renderReport`:
  - subject "Festive Ball tickets: Tuesday 7 October update", with "[Test] " at the front for a test;
  - opens with "Hello," then the next update's day and date, and "call us on 01292 811 015 or email events@nbcc.scot";
  - the last-update wording when `nextUpdateAfter` is null;
  - every figure line: sold of total with percent, whole tables and single seats; since the last update, or "This is the first update"; the two 7-day windows; still available with whole tables; kept back for guests; the waiting list ("nobody yet" at 0); days to go;
  - no "£", no "@" other than events@nbcc.scot; everything escaped; house style (no hyphen between words, no en or em dash);
  - the text version carries the same lines.

### Task 2: One message to several people

- `SesMessage` gains `alsoTo?: string[]`; `buildSesSendRequest` sends `ToAddresses: [to, ...alsoTo]`. Test: the request carries every address; without `alsoTo` it is unchanged.
- `sendAndLog` logs one row per address when `alsoTo` is present (the email log lists each person).
- `sendBallReport({ to: string[], from, replyTo, subject, html, text })`, kind `ballReport`.

### Task 3: The data (`migrations/1789100000004_ball-report.js`)

```js
exports.up = (pgm) => {
  pgm.addColumns("ball_settings", {
    report_on: { type: "boolean", notNull: true, default: false },
    report_recipients: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
  });
  pgm.createTable("ball_report_sends", {
    id: "id",
    sent_on: { type: "date", notNull: true },
    kind: { type: "text", notNull: true },
    recipients: { type: "text[]", notNull: true, default: pgm.func("'{}'::text[]") },
    figures: { type: "jsonb" },
    status: { type: "text", notNull: true, default: "claimed" },
    sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    sent_by: { type: "text", notNull: true },
  });
  pgm.addConstraint("ball_report_sends", "ball_report_sends_kind_check", { check: "kind IN ('scheduled', 'test')" });
  pgm.addConstraint("ball_report_sends", "ball_report_sends_status_check", { check: "status IN ('claimed', 'sent')" });
  pgm.createIndex("ball_report_sends", "sent_on", { unique: true, where: "kind = 'scheduled'", name: "ball_report_sends_one_scheduled_a_day" });
};
```

`test/unit/backup-plan.test.ts`: 48 across the three databases, 46 in the main one, with `ball_report_sends`.

### Task 4: DB (`src/db/ball-report.ts`)

- `getReportSettings(): { reportOn, recipients, updatedAt, lastSends }` (the last scheduled and last test send).
- `saveReportSettings({ reportOn, recipients }, actor)`: one transaction, `audit_log` row `ball_report.settings_saved` with the counts and whether it was switched on or off.
- `readSalesInputs(now, since)`: paid sums from `ball_bookings` (seats, whole tables, single seats, since, last 7 days, the 7 before), `getCapacityState()` + `availability()`, waiting list count.
- `lastScheduledSendAt()`, `claimScheduledSend(sentOn, by)` (INSERT … ON CONFLICT DO NOTHING RETURNING id), `markSendSent(id, recipients, figures)`, `releaseClaim(id)`, `recordTestSend(...)` with its audit row.

### Task 5: The runner and the daily job

`runBallSalesReport(now = new Date())`: read settings; `reportDue`; claim; read inputs (since = last scheduled send); render; `sendBallReport` to every recipient; mark sent, or release the claim and rethrow on a failed send. `send-reminders.ts` calls it in its own try/catch after the run-up, logging counts only.

### Task 6: The admin API (`src/routes/admin-ball-report.ts`)

- `GET /api/admin/ball-report` (`events:view`): settings, last sends, and `preview` (the email rendered with today's numbers).
- `PUT /api/admin/ball-report` (`events:edit`): `{ reportOn, recipients }` validated by `recipientsSchema`; switching on with no recipients is refused.
- `POST /api/admin/ball-report/test` (`events:edit`): the real email, "[Test]" subject, to the signed-in person only; recorded as a test.

### Task 7: Scenarios (`features/ball-report.feature`)

No session 401; a viewer can read but not save (403); an editor saves two recipients and they read back lowercased with an audit row; a bad address or duplicate is refused with the field named; switching on with nobody is refused; a test send goes to the signed-in person only, is recorded as a test and lands in the email log.

### Task 8: The panel

Inside `#view-events`: `<section id="ballReport">` with the switch, the note about shared addresses, the recipients list (email + label, remove), an add row, Save, "Send a test to me", last sent, and the preview in an iframe sized to its content (no inner scroll). Shell test first; `canEdit("events")` decides whether it is editable.

### Task 9: README, checks, ship

README section beside the Ball's run-up; lint, build, unit; draft PR early to claim the number; code review; merge with Jaimie's go.
