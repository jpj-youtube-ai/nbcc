# Email audit: remove the addresses that are dead. Implementation plan

> Executed inline, test first, in the session that wrote it (superpowers:executing-plans). Each task
> is: write the tests named, watch them fail, write the code, watch them pass, commit. Where what
> was built differs, the "As built" section at the end says so.

**Goal:** from the Email audit's red band, staff can remove an address's problems, with or without
blocking the address, and put them back. Design:
`docs/superpowers/specs/2026-10-05-email-audit-remove-design.md`.

**Shape:** one new table (`email_audit_removals`); the band's query hides what has been removed; two
routes; the band drawn as one block an address. No existing table is altered and no code on the
path an email takes when it is sent is touched (the Festive Ball rule, until 8 November 2026).

**Stack:** node-pg-migrate, `pg` through `src/db/pool.ts`, Express handlers in `src/routes/admin.ts`,
the admin's plain JavaScript in `assets/js/admin/app.js`, Vitest (pool mocked; jsdom for the
screen), Cucumber for the end to end scenarios (CI only: there is no database on this machine).

---

## Files

| File | Change |
|---|---|
| `src/email/audit-removals.ts` | new: `isCharityAddress` |
| `migrations/1791200000280_email-audit-removals.js` (written as 260, see As built) | new table and its index |
| `src/db/email-audit-removals.ts` | new: record a removal, put back, why an address is blocked |
| `src/db/email-log.ts` | the band's rule, the mark in the list, retention and erasure for the new table |
| `src/routes/admin.ts` | `POST /api/admin/email-log/remove` and `/put-back` |
| `assets/js/admin/app.js`, `assets/css/admin.css`, `admin.html` | the band as blocks, the controls, the status line, the mark |
| `features/email-audit.feature`, `features/steps/email-audit.steps.js` | five scenarios |
| `README.md` | the Email audit section and the route list |

## Task 1: which addresses are the charity's own

`src/email/audit-removals.ts`:

```ts
export type AuditRemovalKind = "stop" | "tidy";
/** One of the charity's own addresses (nbcc.scot or a subdomain): tidied away, never blocked. */
export function isCharityAddress(email: string): boolean
```

Test `test/unit/email-audit-removals-rules.test.ts`: `events@nbcc.scot`, `Events@NBCC.scot` and
`newsletter@news.nbcc.scot` are the charity's; `ada@example.org`, `ada@notnbcc.scot`,
`ada@nbcc.scot.example.org` and an empty string are not.

## Task 2: the table

`migrations/1791200000280_email-audit-removals.js` (written as 260; must sort last: check at merge time).

```js
pgm.createTable("email_audit_removals", {
  id: "id",
  email: { type: "text", notNull: true },                       // lowercased, as email_log.recipient is
  kind: { type: "text", notNull: true, check: "kind IN ('stop', 'tidy')" },
  blocked: { type: "boolean", notNull: true, default: false },  // this removal is what blocked the address
  removed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  removed_by: { type: "text", notNull: true },
  put_back_at: { type: "timestamptz" },
  put_back_by: { type: "text" },
});
pgm.createIndex("email_audit_removals", "email", { where: "put_back_at IS NULL" });
```

Test `test/unit/email-audit-removals-migration.test.ts` (the house pattern): sorts last; creates the
table with those columns and the check; additive only; touches neither `email_log` nor
`email_suppressions`.

## Task 3: the database modules

`src/db/email-audit-removals.ts`:

```ts
recordAuditRemoval(email, kind, actor, blocked): Promise<void>
  // INSERT INTO email_audit_removals (email, kind, blocked, removed_by) VALUES (lower($1), $2, $3, $4)
putBackAuditRemovals(email, actor): Promise<{ putBack: number; blocked: boolean }>
  // UPDATE ... SET put_back_at = now(), put_back_by = $2 WHERE email = lower($1) AND put_back_at IS NULL RETURNING blocked
blockedReason(email): Promise<string | null>
  // SELECT reason FROM email_suppressions WHERE lower(email) = lower($1) AND removed_at IS NULL
```

`src/db/email-log.ts`:

- `HIDDEN_FROM_BAND`, one SQL fragment used by both readers, for a row aliased `l`:

  ```sql
  SELECT 1 FROM email_audit_removals r
   WHERE r.email = l.recipient AND r.put_back_at IS NULL
     AND (l.created_at <= r.removed_at
          OR (r.kind = 'stop' AND EXISTS (
                SELECT 1 FROM email_suppressions s
                 WHERE lower(s.email) = l.recipient AND s.removed_at IS NULL)))
  ```

- `listRecentEmailFailures`: `FROM email_log l ... AND NOT EXISTS (HIDDEN_FROM_BAND)`.
- `listEmailLog`: `FROM email_log l LEFT JOIN LATERAL (the newest removal that hides the row, for
  problem rows only) rm ON true`, exposing only `removed_at`, `removed_by`, `removed_kind`, so the
  filters' unqualified column names stay unambiguous and the older tests' patterns still match.
  Rows gain `removedAt`, `removedBy`, `removedKind` (null when not removed).
- `pruneEmailLog` also deletes removals made on or before the same cutoff; `eraseEmailLogFor`
  without `kinds` also deletes the address's removals (with `kinds` it does not: the address still
  has other rows).

Tests: `test/unit/email-audit-removals.test.ts` (the three functions) and, added to
`test/unit/email-log.test.ts`, the band's rule, the list's mark, retention and erasure.

## Task 4: the routes

`src/routes/admin.ts`, both `authorizeSection(req, res, "email-audit", "edit")`:

- `postAdminEmailLogRemove`: body `{ email, stop }` (strict). 400 "A valid email address is needed";
  400 "The charity's own addresses are never blocked" for `stop` on one. For `stop`:
  `blocked = await suppressEmail(email, "manual", "Removed from the Email audit by <actor>")`, then
  `recordAuditRemoval(email, "stop", actor, blocked)`. For tidy: `recordAuditRemoval(email, "tidy",
  actor, false)` and nothing else. 200 `{ removed: true, stopped, blockedNow }`.
- `postAdminEmailLogPutBack`: body `{ email }`. 404 "That address has not been removed" when nothing
  was. Unblocks (`unsuppressEmail`) only when a put back removal had `blocked` true and
  `blockedReason` is still `manual`. 200 `{ putBack: true, unblocked, stillBlocked }`.

Test `test/unit/admin-email-audit-remove.test.ts`: no token 401; an editor (no access) and someone
with view only 403, nothing written; each refusal; what a stop and a tidy write; an own address is
tidied and never blocked; put back unblocks only what Remove blocked; a failure is a 500.

## Task 5: the screen

`loadEmailAudit` in `assets/js/admin/app.js`:

- The band groups its rows by address, newest first, one `<li class="email-fail-item">` each: the
  address and name, the controls (`[data-audit-stop]`, an `.admin-btn`; `[data-audit-tidy]`, an
  `.admin-link`), and its problems as a list (status pill, type, subject, date, the reason).
- One of the charity's own: "Tidy away" only, and "One of the charity's own addresses, so it is
  never blocked."
- Remove and stop emails asks first (`window.confirm`), naming the address, what stops, what still
  goes, and how many problems leave.
- While a press is being saved the band is `aria-busy` and ignores presses; then the audit loads
  again.
- `#emailAuditSaid` in `admin.html` (a `.ty-status`, which keeps a line of room when empty; not
  `#emailAuditStatus`, which is the Status filter) says
  what was done, with Put back; or "Could not do that. Please try again."
- In the full list a removed row says "Removed, emails stopped, by ... on ..." or "Tidied away by
  ... on ..." under its status, with Put back for someone who may edit.

Test `test/unit/admin-email-audit-remove-ui.test.ts` (jsdom harness): the blocks; the controls and
who sees them; the confirmation and its cancel; what each press sends and says; the own address; a
double press sends one; the mark and Put back; the three things Put back can say; failure.

## Task 6: end to end

`features/email-audit.feature`: tidy away and it leaves the band; fail again and it is back; remove
and stop blocks the address and a later failure stays out; put back returns it and unblocks; an
editor cannot remove (403).

## Task 7: README

The Email audit section (what the band does now, the rule, the table) and the route list.

## Task 8: verify, review, show Jaimie, ship

Lint, build, the affected tests, `npx cucumber-js --dry-run`. Real Chrome with a stand-in at 1280
and 390px. The migration-safety reviewer and an independent review. Pictures to Jaimie. Then
`/ship`: the number at PR time, and check the migration still sorts last against main.

---

## As built

Where this differs from the tasks above, this is what was built.

- **Names.** The band's rule is two fragments in `src/db/email-log.ts`, `PROBLEM` and
  `REMOVAL_HIDES` (the plan called it `HIDDEN_FROM_BAND`). The line that says what was done is
  `#emailAuditSaid`: `#emailAuditStatus` was already the Status filter's select.
- **The line above the band is as tall empty as full.** Measured in Chrome, `.ty-status` keeps
  14px while empty and the line with words and Put back in it is 22px, so the band moved 8px at
  the first press. `#emailAuditSaid` is 22px in both.
- **The phone.** The band as blocks fits a phone. The full list under it does not, and did not
  before this: its three fixed columns are wider than the screen. Raised as its own task.

**From the migration-safety review** (verdict: safe with changes; all taken):

- `test/unit/backup-plan.test.ts` counts the tables in the three databases, and the README's
  "There are THREE databases" paragraph states the same numbers: 88 and 85 became 89 and 86. The
  first push failed CI on exactly this; it is not a file an "affected tests" list would name.
- The migration's table comment is stored in the database for good, so the task number went into
  it, and into every other line of this branch, before anything merged.
- The migration test asserted that its file was the LAST migration. That turns red for whoever
  adds the next one. It now asserts that it sorts after `1791200000250_donation-source.js`, as the
  other migration tests do.
- Two older paths forget a person in the log without `eraseEmailLogFor`: a sponsor's unpaid pledge
  (`src/db/pledges.ts`) and a cleared team invite (`src/db/fundraising-teams.ts`). The daily prune
  now also deletes any removal whose address no longer has a row in the log.
- Another session's branch also had a migration numbered 1791200000260, which it renumbered to
  1791200000270 so the names would not tie. That one (the Fill a Red Bag lists, TASK-563) then
  reached main and production first, while this was in review. A migration that sorts before one
  production has already run stops every deploy at the migrate step, and CI's empty database
  cannot show it. So this one became `1791200000280_email-audit-removals.js` before merging, its
  test asserts that it sorts after 270, and the backup plan counts both new tables: 90 in all, 87
  in the main database.

**From the code review** (verdict: with fixes; two important, the rest smaller; all taken):

- **Addresses a strict check refuses.** The routes took `z.string().email()`, and the log holds
  addresses that fails: a trailing full stop, two dots, an address in angle brackets. Those are
  refused by the provider on every send and never bounce, so they are the ones most in need of
  removing, and the buttons on them answered 400. The routes now take whatever the log holds
  (`auditAddress`), and only `stop` asks that it could be an address (`looksLikeAddress`, the loose
  shape addresses come into the site by). A cleared team invite's rows ("deleted team invitee")
  can be tidied and not blocked, on the screen and by the route.
- **A problem is dated by when it went wrong.** The rule compared the removal with the send's
  time (`created_at`). A bounce or a spam report lands on its row later with its own time
  (`delivery_at`), so a newsletter sent on Tuesday, tidied away on Wednesday and marked as spam on
  Thursday stayed hidden. The rule now uses `COALESCE(delivery_at, created_at)`.
- **Still blocked means by the block of that time.** A stopped address that was unblocked under
  Newsletter and blocked again later by a new bounce went back to hiding everything. The rule now
  asks that the block was made on or before the removal.
- **Only an address with a problem can be removed** (404 otherwise; the check was tightened again
  in the second pass, below, and is `hasProblemToRemove` now). Before,
  the route would block any address handed to it.
- **Put back** asks first when the removal stopped emails, since it can start them again. Its
  answer carries `blockedBecause` in place of `stillBlocked`, and the screen says which reason.
  When a Put back fails, the line that says so keeps a Put back, with the keyboard on the line.
- **Refusals say what they are.** 403, "You can no longer change the Email audit."; a 404 on Put
  back, "That address had already been put back." and the list is drawn again; "Please try again"
  only where that could work. The lock is checked before the question is asked, so a press made
  while another is being saved asks nothing.
- **Newsletter > Blocked addresses.** Its Unblock asked as if every block were a bounce or a spam
  report; for a staff block it now says staff. The count's label names staff too. Its route
  (`postAdminSuppressionLift`) took only a well formed address, so a badly formed one that staff
  had blocked could never come off the list there: it takes any address now. Measured in Chrome,
  the reason and its detail ran together ("Blocked by staffRemoved from the Email audit by ...");
  the detail takes a line of its own in that list.
- **Not taken as code: one transaction for the block and the removal.** The two writes are in
  that order on purpose (blocked before hidden), and a failure between them leaves the address
  blocked with its problems still showing, which staff can see and press again. The second press
  finds it blocked already and records `blocked` false, so that Put back would leave the staff
  block in place and say "It is still blocked by staff", with where to unblock it.
- **Fixtures.** The acting staff address in the tests was on the charity's real domain. It is on
  `nbcc.test` now (`staff@nbcc.test`, `kenny@nbcc.test`).
- **End to end**, on real PostgreSQL: a bounce a minute after a tidy shows (its time is worked out
  by the database from the removal, so the scenario does not depend on two clocks agreeing); an
  address unblocked under Newsletter shows the next time it fails; a badly formed address is
  stopped and then unblocked; an address with no problem is a 404; the daily prune forgets a
  removal whose address has no email left in the log and keeps one that has.

**From the code review's second pass** (verdict: ready; six smaller points):

- **Only what is still showing can be removed.** The check before a removal asked whether the log
  had ever held a problem for the address. So a second member of staff, on a screen drawn before a
  colleague pressed Remove and stop emails, could still press Just tidy away on the same address:
  two removals in force, the list marked with the newer one (the tidy), and a Put back that undid
  both, lifted the colleague's block, and asked nothing because it took itself for a tidy. The
  check is now `hasProblemToRemove` (`src/db/email-log.ts`): a problem that no removal already
  hides, by the band's own rule. The second press is a 404, "That address has nothing left to
  remove.", and the band drawn again shows what the colleague did. Two presses that land in the
  same instant can still both pass the check; that is left.
- **The stop that outlived its block, proven end to end.** The scenario for an address unblocked
  under Newsletter passed with or without the new condition, since nothing blocked the address
  again in it. A second scenario blocks it again with a bounce and asks that what follows shows.
- **A bounce hidden by a tidy made after it** had no scenario, and is the commonest case. It has
  one. The bounce step takes its time from the database's clock, which is the clock a removal is
  stamped by.
- **The Put back question** said "Its problems return to the list at the top." The band holds 14
  days, so for an older removal nothing returns. It says "Any problems it had in the last 14 days
  return".
- **The keyboard after a refusal.** On a 404 the list is drawn again and the button that was
  pressed goes with it. The keyboard now goes to the line that says why, as it does on success.
- **Known and left: Put back is two writes too.** The removals are stamped as put back, then the
  block is read and lifted. If the database fails between the two, the screen says "Could not do
  that. Please try again.", the second press is told "That address had already been put back.",
  and the staff block is still there. Newsletter > Blocked addresses shows it and lifts it. It
  takes a database error between two statements, so it is written down here and not built round.
- **Known and left: the block list is never pruned.** A staff block stays on it for good, as a
  bounce's does. How long a block is kept is a question for the block list as a whole.
