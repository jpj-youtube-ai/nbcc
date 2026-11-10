# Elf Detective School wave 2, Plan 2b: the photo check, alerts, emails, the worker and Finds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything that runs around the doors without a developer: head elves check photos and read the log, hear about waiting photos by one text and one email at a time, see who found each door and when, the daily emails, alerts and proud moments go by themselves from an in app worker, and every photo is deleted from 31 January of the year after its December.

**Architecture:** One migration adds `elf_head_elves` (mobiles and the alerts tick), `elf_alerts` (what went and when) and `elf_sends` (every timed send claimed once). Texts use the client the texts plan shipped. The rules for alerts, posts and what is due are pure in `src/elf/`; the worker `src/elf/worker.ts` ticks every 30 seconds on the newsletter sender's pattern with an injectable moment, claims each send in `elf_sends`, stores automatic snow days through Plan 2a's `markAutomaticSnowDays`, and sweeps for promotions earned any way. The photo check and Finds are routes in a new `src/routes/admin-elf-finds.ts` and a Finds tile in `assets/js/admin/elf-hq.js`. The practice door Plan 2a built is what the BDD uses to play a photo through the check and the alerts.

**Tech Stack:** TypeScript on Express, Postgres with node-pg-migrate, zod, Vitest (jsdom for the admin script), Cucumber BDD (CI only).

**Spec:** `docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md` (binding): decisions 8, 9, 10, calls C7, C8, C13, C14, "Head Elf HQ: the photo check", "Alerts", "Head Elf HQ: Finds on the evening", "Emails in wave 2", and October decisions 6, 16 and 18 as the wave 2 design keeps them. The mockup to match is `.superpowers/sdd/2026-11-10-elf-wave-2/mockups/photo-check.html` (not in git). **Plan 2a (`2026-11-10-elf-wave-2-game-1.md`) and the texts plan (`2026-11-10-elf-wave-2-texts.md`) merge first**: this plan reuses `DoorRun` (with `contactEmail` and `closesAt`), `runsFor`, `loadDoorRuns`, `loadPractice`, `markAutomaticSnowDays`, `finderParts`, `familyDoorsDone`, `doorCounts`, `elf_photos`, `elf_photo_files`, `elf_visits`, `sendText`, `smsConfigured`, and Plan 1's `readinessOf` and `addElfDoorName`.

## Global Constraints

- The repository is public. Invented names only, in every test, fixture, BDD step and example sentence: never a real person's name, NBCC's own team included ("Head Elf" as a title is fine; a head elf in a test is "Alex Example"); `01632 960 123` for a phone number and `07700 900 123` for a mobile (both Ofcom's reserved ranges); `@example.org` or `@example.com` for email. Never a real place, clue or prize anywhere committed. Every sample email in the catalogue uses "Example" people and the pretend place "Pine Cone Café, Ayr".
- "Elf Detective School" always in full when it means the game; never "the school".
- Plain English with no dashes in any words a person reads; money wording uses "could". Words about a clue time say "tonight" only when it is after midday; a 10am clue is "today" or "this morning". Emails keep NBCC's email look (`src/email/brand.ts`) and go from `events@nbcc.scot` on the apex, never `news.nbcc.scot`. No link in an email changes anything when followed. A clue picture is never attached to or linked from an email.
- Head Elf HQ's CSS house rules (top of `assets/css/admin-elf-hq.css`, enforced by `test/unit/admin-elf-hq-css.test.ts`); `el()` and text only in the admin script; `is-ok` and `is-error`; no inner scrollbars; every screen works at 390 and 360 pixels wide.
- Children's safety: head elves see a family's full names; a public post names a detective only through `detectiveNames`; neither alert shows the photo or the family's name. Removed families (`removed_at` set) are out of every count and finder line.
- Every admin route: `res.setHeader("Cache-Control", "no-store")`, `authorizeSection(req, res, "elf", "view" | "edit")`, a try/catch answering 500 `{ error: "Admin is temporarily unavailable" }`; the actor is `actorOf(claims)`. A head elf's name on a screen is `users.full_name`, the email only when it is blank. Audit rows never carry a place name, a photo or a mobile number.
- Every timed send is claimed in `elf_sends` before it goes, so it goes once however many tasks run; a send that throws is retried at most three times, ten minutes apart, and a stuck row never blocks the rows after it.
- Config goes through `src/config/schema.ts`, `.env.example`, SSM in `infra/modules/app/main.tf` and the task definition in `infra/modules/app/ecs.tf` (this plan adds none; the texts plan added the texts').
- Migrations only add. This plan's migration is `migrations/1791200000440_elf-alerts.js`; before the pull request check it sorts after the newest migration on main and renumber it if not.
- Tests first; unit tests touch no database and set the clock with `vi.setSystemTime`; BDD runs only in CI. No BDD date bombs: the `@elf-school` hooks (Plan 2a) set `elf_settings.year` to next year and `doors_on` by SQL and restore both; the worker's tick takes an injectable `at`, and BDD passes midday so quiet hours never bite.
- Locally `perf-budget` and `footer-master` fail on Windows line endings; those two are not real failures. Run `npm run lint` and `npx tsc --noEmit` before each commit. Commit only the files the task names, never `.mcp.json`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- README.md is updated in Task 7, with the list of words for Jaimie.

## Review Focus

Each line names the test that pins it.

1. Two tasks tick at the same second with ten families still to get the clue email: every family gets it exactly once. Task 6's `claimSend` SQL test (`ON CONFLICT (kind, key) DO UPDATE … RETURNING`) and its worker test "when `claimSend` answers false for the second it sends two".
2. A photo sent at 8:59pm starts an alert at once; one sent at 9:01pm waits for 8am; a head elf who clears the queue at 6:05pm after a 6:04pm alert and a new photo at 6:10pm gets nothing until 6:34pm. Task 3's `photoAlertDue` tests.
3. A text that Amazon refuses never stops the email, and Settings > Alerts says whose text did not go. Task 6's worker test "when `sendText` throws" and Task 3's jsdom test of `textsFailed`.
4. A called off door gets no 9am reminder and no clue email, and the morning email calls it a snow day. Task 6's `dueNow` tests with `snowDay: true` and Task 2's morning email test.
5. The 8am email on 8 December names door 7's place only because door 7 is open; built when yesterday's door is "found-hidden" or "snow", it names no place, and the finder is the public name. Task 2's `yesterdayPost` tests.

---

### Task 1: The alert and send tables

**Files:**
- Create: `migrations/1791200000440_elf-alerts.js`
- Test: `test/unit/elf-admin-migrations.test.ts` (add a `describe` for 440)

**Interfaces:**
- Produces the tables:
  - `elf_head_elves`: `user_id integer PRIMARY KEY REFERENCES users ON DELETE CASCADE`; `mobile text CHECK (mobile IS NULL OR mobile ~ '^\+447[0-9]{9}$')` (kept as E.164); `alerts_on boolean NOT NULL DEFAULT true`; `updated_at timestamptz NOT NULL DEFAULT now()`; `updated_by text`.
  - `elf_alerts`: `id serial PRIMARY KEY`; `kind text NOT NULL CHECK (kind IN ('photo', 'test'))`; `sent_at timestamptz NOT NULL DEFAULT now()`; `year integer NOT NULL`; `door integer`; `emails integer NOT NULL DEFAULT 0`; `texts integer NOT NULL DEFAULT 0`; `texts_failed text[] NOT NULL DEFAULT '{}'` (the names whose text did not go); index `(kind, sent_at)`.
  - `elf_sends`: `kind text NOT NULL`; `key text NOT NULL`; `claimed_at timestamptz NOT NULL DEFAULT now()`; `sent_at timestamptz`; `attempts integer NOT NULL DEFAULT 1`; `last_error text`; primary key `(kind, key)`; index `(kind, sent_at)`.

- [ ] **Step 1: Write the failing test.** `up` creates the three tables with exactly those columns (assert the mobile check, the kind check, the `(kind, key)` primary key); `down` drops them; the file sorts last.
- [ ] **Step 2: Run it.** `npx vitest run test/unit/elf-admin-migrations.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the migration** in the style of `migrations/1791200000310_elf-school.js`.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): tables for alerts and claimed sends`.

### Task 2: The emails and the social posts

**Files:**
- Modify: `src/elf/emails.ts`, `src/email/catalogue.ts`, `src/clients/email.ts`, `src/email/tracked-links.ts` (the staff kinds)
- Create: `src/elf/posts.ts`
- Test: `test/unit/elf-emails.test.ts` (extend), `test/unit/elf-posts.test.ts`, `test/unit/email-catalogue-guard.test.ts` (must keep passing)

**Interfaces:**
- Consumes: `emailShell`, `heading`, `bodyP`, `bodyList`, `button`, `note`, `card`, `quoteBox` (brand.ts); `clockWords`, `longDayWords`; `ElfFact`; `detectiveNames`, `DetectiveNameParts` (names.ts); `doorPicture` (Plan 1); `DoorState`, `isOpen`; `sendVerbatim` (email.ts, as `sendElfWelcome` uses it).
- Produces, in `posts.ts` (C14):
  - `function whenWords(clue1At: Date): "tonight" | "today"` ("tonight" when the London hour is 12 or later).
  - `function doorPost(o: { door: Door; clue1At: Date; joinUrl: string }): string`: `Door ${n} of NBCC Elf Detective School opens ${when}! The first clue comes out at ${time} in Detective HQ, with two more across the ${when === "tonight" ? "evening" : "morning"}. Not a detective yet? Join at ${joinUrl}`
  - `function yesterdayPost(o: { door: Door; elfName: string; state: DoorState; finders: DetectiveNameParts[]; foundAt: Date | null; place: { name: string; town: string } | null }): string | null`: null unless `isOpen(state)` and `place` is set; `by` is `detectiveNames(finders)`; found: `Door ${n} is open! ${by} found ${elf} at ${place}, ${town} at ${time}. ${elf} stays there all December: call in, type the word on the tag for a candy cane stamp, and add your picture to the door.`; revealed: `Door ${n} is open! Nobody found ${elf} in time, so ${elf} is waiting at ${place}, ${town}. The first detective to type the word on its tag wins the prize.`
  - `function postPicture(year: number, door: Door, siteOrigin: string): string | null`: `doorPicture`'s path on the site origin, or null for the mystery star.
- Produces, in `emails.ts`, each a `BuiltEmail`:
  - `buildElfClueEmail(o: { grownUpName; door; elfName; clue: { words: string | null; pictureAlt: string | null }; clue1At; clue2At; clue3At; revealAt; hqUrl; fact: ElfFact | null; giveUrl })`: subject `Door ${n}: the first clue is out`; words in a quote box; a picture only clue reads `Clue 1 is a picture: ${alt}. See it in Detective HQ.`; words and a picture add `See the picture in Detective HQ.` after the words; `Clue 2 comes out at ${time} and clue 3 at ${time}, in Detective HQ. The hiding place is shown at ${revealAt}.`; the button `Open Detective HQ`; `If you are reading this a little late, the clue has been in Detective HQ since ${clue1At}.`; the fact's `grownUp` under `Did you know?`; a small line `Every pound could help a child wake up to a Red Bag Full of Joy.` linking `giveUrl`.
  - `buildElfPlaceReminderEmail(o: { contactName: string | null; placeName; elfName; door; clue1At; closesAt: string | null; phone: string })`: subject `Today is your Elf Detective School day`; `${Tonight or Today} at ${time}, please put ${elf} and the poster out together, with ${elf} wearing its tag. Until then keep them both out of sight.`; the staff card's three steps in short; `Anything at all, ring NBCC on ${phone}.`
  - `buildElfMorningEmail(o: { day: Date; today: { door; ready: boolean; toDo: string[]; clue1At; snow: boolean } | null; yesterday: { door; finders: DetectiveNameParts[]; foundAt: Date | null; place: { name; town } | null; state: DoorState; snow: boolean } | null; photosWaiting: number; posts: { today: string | null; yesterday: string | null }; pictures: { today: string | null; yesterday: string | null }; adminUrl })`: subject `Elf HQ: ${longDayWords(day)}`; `Today's door`: `Door ${n} is ready. The first clue comes out at ${time}.`, or `Door ${n} is NOT ready: ${toDo joined}. Fix it in Doors before ${time}, or it becomes a snow day.`, or `Door ${n} is a snow day.`; `Yesterday`: `${by} found door ${n}'s elf at ${time}.` (the public name), or `Nobody found door ${n}'s elf; its place was shown.`, or `Door ${n} was a snow day.`; `${photosWaiting} photos waiting to be checked` with the button `Open Head Elf HQ`; `Today's posts, ready to copy`: each post in a `card` with its picture as an `img` of the committed door picture when there is one; a null yesterday post reads `Yesterday's find is not public yet, so there is no post for it.`
  - `buildElfFindAlertEmail(o: { door; elfName; detectives: string[] (full names); grownUpName; at; placeName; adminUrl })`: subject `Door ${n}'s elf has been found`; `${names} (${grownUp}'s family) found ${elf} at ${place} at ${time}.`; button `Open Finds`. Head elves only (C7).
  - `buildElfPhotoAlertEmail(o: { door: Door | 0; adminUrl })`: subject `A photo is waiting to be checked`; `A family has sent a photo from ${door 0 ? "the practice door" : `door ${n}`} of Elf Detective School. Nobody sees it until a head elf approves it.`; button `Check the photos`; `You get one of these when photos start waiting, not one for every photo.`
  - `buildElfTestAlertEmail(o: { name: string; adminUrl })`: subject `Your test alert from Elf Detective School`; `Hi ${name}, this is the email half of a test alert. If you gave a mobile number, a text has gone too.`
  - `buildElfProudEmail(o: { kind: "won" | "promoted" | "graduated"; grownUpName; detectiveName: string; elfName?: string; door?: Door; rank?: Rank; hqUrl; giveUrl })`: subjects `You found ${elfName}!`, `${detectiveName} is now a ${rank}`, `${detectiveName} has graduated!`; a warm thank you, then `If Elf Detective School has given your family a smile, a little more could help another family this Christmas.` with the button `Give a little more` to `giveUrl` (`/donate`).
  - `const ELF_PHOTO_TEXT = "Elf Detective School: a photo is waiting for a head elf to check. nbcc.scot/admin"` and `const ELF_TEST_TEXT = "Elf Detective School: this is your test alert. nbcc.scot/admin"`.
- Produces, in `email.ts`: `sendElfClue`, `sendElfPlaceReminder`, `sendElfMorning`, `sendElfFindAlert`, `sendElfPhotoAlert`, `sendElfTestAlert`, `sendElfProud`, each `(name: string | null, message: FundraiseEmailMessage) => Promise<void>` through `sendVerbatim` with the kinds `elfClue`, `elfPlaceReminder`, `elfMorning`, `elfFindAlert`, `elfPhotoAlert`, `elfTestAlert`, `elfProud`; the four staff kinds join `STAFF_ONLY_KINDS`.
- Produces, in `catalogue.ts`: entries in the `elf` group, in sending order: `elf-clue` (versions "Words", "A picture only", "Words and a picture"), `elf-place-reminder` (versions "An evening clue", "A morning clue"), `elf-morning` (versions "A door ready, yesterday found", "A door not ready, yesterday a snow day"), `elf-find-alert` (audience staff), `elf-photo-alert` (staff), `elf-test-alert` (staff), `elf-proud` (versions "A prize won", "Promoted", "Graduated").

- [ ] **Step 1: Write the failing tests.** Each builder's subject and the sentences above; the clue email for a picture only clue contains the alt words and no `<img>` and no `/elf/hq/clue/`; with words and a picture it contains "See the picture in Detective HQ."; `whenWords` at 5:30pm is "tonight" and at 10am "today", and the reminder for a 10am clue contains "Today at 10am" and never "tonight"; `doorPost` for a 10am clue contains "opens today" and "morning"; `yesterdayPost` is null for "found-hidden", "snow" and a null place, and with an unticked Ruby reads "Detective R. Tinselfoot found"; the morning email with `posts.yesterday` null contains "not public yet", with `today.snow` contains "is a snow day", and its yesterday line uses the public name; no built email contains a `news.nbcc.scot` address; `ELF_PHOTO_TEXT` is under 160 characters; the catalogue guard passes.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/elf-emails.test.ts test/unit/elf-posts.test.ts test/unit/email-catalogue-guard.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): the December emails, the two daily posts and their catalogue entries`.

### Task 3: The alert rules and Settings > Alerts

**Files:**
- Create: `src/elf/alerts.ts`, `src/db/elf-alerts.ts`
- Modify: `src/routes/admin-elf.ts`, `assets/js/admin/elf-hq.js`, `assets/css/admin-elf-hq.css`
- Test: `test/unit/elf-alerts.test.ts`, `test/unit/elf-db-alerts.test.ts`, `test/unit/admin-elf.test.ts` (extend), `test/unit/admin-elf-hq-js.test.ts` (extend)

**Interfaces:**
- Consumes: `listUsers` and `ManagedUser` (`src/db/admin-users.ts`; its name field is `full_name`, and it carries `role`, `status` and `permissions`), `effectivePermissions`, `can`; `sendText`, `smsConfigured` (texts plan); `buildElfTestAlertEmail`, `sendElfTestAlert`, `ELF_TEST_TEXT` (Task 2).
- Produces, in `alerts.ts` (pure):
  - `const ALERT_GAP_MS = 30 * 60_000`; `const QUIET_FROM = 21`; `const QUIET_TO = 8`.
  - `function quietHours(now: Date): boolean`: the London hour is 21 or later, or before 8.
  - `function photoAlertDue(o: { oldestWaitingAt: Date | null; lastAlertAt: Date | null }, now: Date): boolean`: a photo is waiting, it is not quiet hours, and either no alert has gone or every photo waiting at the last alert has been checked since (`oldestWaitingAt > lastAlertAt`) and `ALERT_GAP_MS` has passed since the last alert (C13).
  - `function normaliseUkMobile(typed: unknown): string | null`: digits only after dropping spaces, dots, brackets and dashes; `07xxxxxxxxx`, `+447xxxxxxxxx` or `447xxxxxxxxx` becomes `+447xxxxxxxxx`; anything else null.
  - `function headElfName(u: { full_name: string; email: string }): string` (`full_name` trimmed, or the email when blank).
  - `interface HeadElf { userId: number; name: string; email: string; mobile: string | null; alertsOn: boolean }`
  - `function headElvesOf(users: ManagedUser[], rows: { userId; mobile; alertsOn }[]): HeadElf[]`: users not disabled whom `can(effectivePermissions(u), "elf", "view")` admits, named by `headElfName`, joined to their row (no row means no mobile, alerts on), by name.
  - `function alertRecipients(elves: HeadElf[]): { emails: HeadElf[]; texts: HeadElf[] }`: `alertsOn` for emails; `alertsOn` with a mobile for texts.
- Produces, in `elf-alerts.ts`: `listHeadElves(): Promise<HeadElf[]>`; `setMyAlerts(userId, change: { mobile?: string | null; alertsOn?: boolean }, actor): Promise<void>` (an upsert; audit `elf.alerts.changed` with the field names only); `lastAlert(kind): Promise<{ at: Date; textsFailed: string[] } | null>`; `recordAlert(o: { kind; year; door; emails; texts; textsFailed }): Promise<void>`; `oldestWaitingPhotoAt(): Promise<Date | null>`.
- Produces, routes (in `admin-elf.ts`):
  - `GET /api/admin/elf/alerts` (view): `{ people: (HeadElf & { me: boolean })[], textsOn: smsConfigured, lastAlert: { at, textsFailed } | null }`.
  - `PATCH /api/admin/elf/alerts/me` (view: a head elf sets only their own) `{ mobile?: string | null; alertsOn?: boolean }`: a mobile that does not normalise is 400 `{ error: "That does not look like a UK mobile number." }`.
  - `POST /api/admin/elf/alerts/test` (view): sends the test email to the caller and, when they have a mobile and `smsConfigured`, the text; answers `{ email: true, text: "sent" | "stubbed" | "failed" | "no-mobile" | "off" }`; `recordAlert({ kind: "test", … })`.
- Produces, in the admin script's Settings part (match `photo-check.html`'s Alerts panel): the heading "Alerts", `Who gets a text and an email when a photo is waiting`, each head elf as a card with their mobile or `No mobile number yet` and their email, and On or Off; the signed in head elf's own card has a mobile field and the tick, saving with PATCH; the rules box `When alerts go` with the three lines from the mockup; `Send me a test alert`, saying `Sent. Check your email and your phone.`, `Sent by email. Add a mobile number to get texts too.` or `Sent by email. The text did not go.`; when `lastAlert.textsFailed` is not empty, `The last alert's text did not reach ${names}.` as `is-error`; the two previews (the text in a bubble, the email's subject and first line) as words.

- [ ] **Step 1: Write the failing tests.** `quietHours` at 20:59, 21:00, 07:59 and 08:00 London on 7 December is false, true, true, false; `photoAlertDue` with no alert and a photo waiting at 8:59pm is true at 8:59pm; a photo at 9:01pm is false at 9:01pm and true at 8:00am; after an alert at 6:04pm with the oldest waiting still 6:00pm it is false at 6:40pm; with the oldest waiting 6:10pm (the queue cleared at 6:05pm) it is false at 6:20pm and true at 6:34pm; `normaliseUkMobile("07700 900 123")`, `"+44 (0)7700 900123"` and `"447700900123"` are `"+447700900123"`, `"01632 960 123"` and `"abc"` are null; `headElfName({ full_name: "  ", email: "jo@example.org" })` is the email; `headElvesOf` keeps an editor given `{ elf: "view" }`, drops a disabled admin and a viewer with `{}`; `alertRecipients` puts a head elf with no mobile in `emails` only. Routes: GET as elf view lists people with `me` true for the caller; PATCH with `"call me"` is 400; the test post calls `sendElfTestAlert` once and `sendText` once with `+447700900123`, and answers `text: "failed"` when `sendText` throws. jsdom: the own card's save sends `{ mobile: "07700 900 123" }`; `Send me a test alert` shows "Check your email and your phone." on `text: "sent"`; `lastAlert.textsFailed: ["Alex Example"]` shows "did not reach Alex Example" with `is-error`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** (CSS: `.hq-alerts`, `.hq-person`, `.hq-rules`, `.hq-sms`).
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): the alert rules and Settings > Alerts`.

### Task 4: The photo check and the photo log

**Files:**
- Create: `src/routes/admin-elf-finds.ts`, `src/db/elf-photos.ts`
- Modify: `src/app.ts` (mount `adminElfFindsRouter` after `adminElfDoorsRouter`), `src/elf/admin-hq.ts` (`HqTab` gains `"finds"`), `src/routes/admin-elf.ts` (`photosWaiting` on `/hq`), `assets/js/admin/elf-hq.js`, `assets/css/admin-elf-hq.css`
- Test: `test/unit/elf-db-photos.test.ts`, `test/unit/admin-elf-finds.test.ts`, `test/unit/admin-elf-finds-js.test.ts`

**Interfaces:**
- Consumes: `elf_photos`, `elf_photo_files` (Plan 2a); `loadDoorRun`, `loadPractice`, `openedAt`; `headElfName` (Task 3); `writeWithAudit`.
- Produces, in `elf-photos.ts`:
  - `interface PhotoCheck { id; token; year; door: Door | 0; practice: boolean; sentAt: Date; family: { id; grownUpName; detectives: number }; placeName: string | null; placeShownAt: Date | null (null when already shown) }`
  - `photosWaiting(now): Promise<PhotoCheck[]>` (oldest first; removed families' photos left out); `countPhotosWaiting(): Promise<number>`.
  - `photoForStaff(id): Promise<{ mime; bytes } | null>` (any status with bytes).
  - `decidePhoto(id, decision: "approved" | "declined", actor, reason: string | null): Promise<"done" | "already" | null>`: under `FOR UPDATE`, only from `waiting`; a decline deletes the bytes row (C8); "already" when someone got there first; audit `elf.photo.decided` `{ decision }`.
  - `takeDownPhoto(id, actor, reason: string | null): Promise<boolean>` (from approved or waiting; bytes row deleted; `taken_down_by` the actor).
  - `interface PhotoLogRow { id; door: Door | 0; practice: boolean; family: { grownUpName }; status; steps: { at: Date; words: string }[] }` and `photoLog(limit: 200): Promise<PhotoLogRow[]>` newest first, steps from the row's columns, the head elf named by `headElfName` of the `users` row whose email is the actor's (`decided_by` and `taken_down_by` hold `admin:<email>`), the email when there is no row: `Sent`, `Approved by ${name}`, `Declined by ${name}: ${reason}`, `Taken down by the family`, `Taken down by ${name}: ${reason}`, `Deleted`.
  - `deleteExpiredPhotoFiles(now: Date): Promise<number>`: for every photo whose `year` is such that 31 January of `year + 1` in London is at or before `now` (year 0 counts as the current December's year), delete its `elf_photo_files` row and set `status = 'deleted'`, `deleted_at = now` where not already deleted; answers how many. Idempotent, run on every worker tick.
- Produces, routes in `admin-elf-finds.ts` (`export const adminElfFindsRouter`):
  - `GET /api/admin/elf/photos` (view): `{ waiting: PhotoCheck[], log: PhotoLogRow[], lastAlert, canEdit }`.
  - `GET /api/admin/elf/photos/:id/picture` (view): the bytes, `no-store`, `nosniff`, `X-Robots-Tag: noindex, nofollow`.
  - `POST /api/admin/elf/photos/:id/approve` (edit) and `POST …/decline { reason }` (edit; reason 1 to 200 characters, else 400 `{ error: "Say why in a few words. Only head elves see it." }`): "already" answers 409 `{ error: "Someone has already checked this photo.", step: <that photo's newest log step> }`.
  - `POST /api/admin/elf/photos/:id/take-down { reason? }` (edit).
- Produces, in the admin script: a `finds` tab in `TABS` after Doors (`{ id: "finds", name: "Finds", icon: PAPER + "icons/icon-camera.webp" }`), its count from `GET /api/admin/elf/hq`'s new `photosWaiting`, and the Finds part's photo half matching `photo-check.html`: `Photos to check` with the `${n} waiting` chip and the alert line (`One alert went at ${time}.` or `No alert has gone yet.`); the first waiting photo big (fetched with the bearer token into a Blob address) with `Door ${n} · ${day}` (or `The practice door` with a `Practice` chip), the place, `Sent at ${time}`, `From the ${grownUp} family, ${k} detectives. Only head elves see who sent it.`, the hold line when `placeShownAt` is set (`Door ${n}'s place is shown at ${time}, so this photo waits until then, even once it is approved.`), the four line checklist under `Before you approve`, `Approve` and `Decline` (which asks for the reason in a field, then posts), and the note; `Next` as thumbnails of the rest; a 409 shows the answer's `step` (`Approved by Alex Example at 6:13pm`) in place of the buttons for a moment, then fetches the queue again; `The photo log` as the mockup draws it, with `Take it down` (asking for an optional reason) on photos that are up; the end line `Sunday 31 January 2027: every photo is deleted. The log keeps these lines, without the pictures.` When `canEdit` is false the buttons are not drawn.

- [ ] **Step 1: Write the failing tests.** `decidePhoto` runs BEGIN, the `FOR UPDATE` read, answers "already" when the row is not waiting and writes nothing, and on a decline deletes from `elf_photo_files` in the transaction; `photoLog` turns a declined row into the steps `Sent` then `Declined by Alex Example: someone else in it` from a users row `{ full_name: "Alex Example", email: "alex@example.org" }` (the whole `full_name` is used), and falls back to the email when the row is missing; `deleteExpiredPhotoFiles` at noon on 31 January 2027 London deletes year 2026 and year 0 rows and none of year 2027, and at 11:59pm on 30 January deletes nothing. Routes: elf view can GET the queue and the picture, every POST is 403 for view; decline without a reason is 400; approve answering "already" is 409 with `step`. jsdom: the Finds tab fetches `/api/admin/elf/photos`, shows the first photo's door and place (and "Practice" for door 0), Approve posts to `/approve`, Decline asks for a reason then posts it, a 409 shows "Approved by Alex Example", the log draws its steps, `Take it down` posts.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** (CSS: `.hq-finds` two columns under `@container (min-width: 1040px)`, `.hq-check`, `.hq-polaroid`, `.hq-hold`, `.hq-look`, `.hq-thumbs`, `.hq-log`, `.hq-steps`).
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): the photo check and the photo log in Finds`.
- [ ] **Step 6 (the controller, after review):** check Finds in the stand-in (`.superpowers/sdd/2026-11-10-elf-wave-2/standin/hq.html`, Plan 1 Task 8) at 1320, 390 and 360 pixels beside `photo-check.html`.

### Task 5: Finds on the evening

**Files:**
- Modify: `src/routes/admin-elf-finds.ts`, `src/routes/admin-elf-doors.ts` (names added late), `src/db/elf-game.ts`, `assets/js/admin/elf-hq.js`, `assets/css/admin-elf-hq.css`, `features/elf-admin-doors.feature`, `features/steps/elf-admin-doors.steps.js`
- Test: `test/unit/admin-elf-finds.test.ts`, `test/unit/admin-elf-doors.test.ts`, `test/unit/elf-db-game.test.ts`, `test/unit/admin-elf-finds-js.test.ts`

**Interfaces:**
- Consumes: `loadDoorRuns`, `loadPractice`, `doorCounts`, `cluesOut`, `openedAt`; Plan 1's `addElfDoorName` and `POST /api/admin/elf/doors/:door/names`.
- Produces:
  - `finderOf(year, door): Promise<{ detectives: string[] (full names); grownUpName: string; email: string; at: Date } | null>` in `elf-game.ts` (door 0 reads `elf_practice`).
  - `interface FindRow { door: Door | 0; practice: boolean; day: string; state: DoorState; placeName: string | null; placeTown: string | null; found: { detectives: string[]; grownUpName: string; at: string } | null; cluesOut: 0 | 1 | 2 | 3; counts: { families: number; cracked: number } | null (once the place is shown); canAddName: boolean (until midnight at the end of its day; never for door 0) }`
  - `GET /api/admin/elf/finds` (view): `{ doors: FindRow[] }`, the practice door first while it runs, then today's door and backwards, only doors whose clue 1 is out.
  - `POST /api/admin/elf/doors/:door/names` (Plan 1) gains the rule: after midnight at the end of the door's day it answers 409 `{ error: "Door ${n}'s day is over, so its names are fixed now." }`.
  - The Finds part's other half, `Tonight and before`: a card a door with `Door ${n} · ${day}` (or `The practice door`), the place (staff only), `Found by ${detectives} (${grownUp}'s family) at ${time}` or `Not found yet. ${cluesOut} of 3 clues out.` or `Snow day`, once shown `${families} families have visited and ${cracked} cracked it with a guess`, and, while `canAddName`, `Add a name that counts` (a field and a button posting to the names route, saying `Added. Guesses are checked against it from now.`).

- [ ] **Step 1: Write the failing tests.** With the clock at 6:12pm on 7 December 2026 and doors 1 to 7 with clue 1 out: `GET /finds` lists door 7 first and door 8 not at all; door 7 unfound has `cluesOut: 2` and `counts: null`; door 6 found yesterday has its finder's full names and counts; a practice run puts door 0 first with `practice: true`; `canAddName` is true for door 7 and false for door 6 and door 0; POST names on door 6 is 409 with the sentence and on door 7 is 201. jsdom: the cards draw "Not found yet. 2 of 3 clues out." and the add name field posts.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS. Add one BDD scenario to `elf-admin-doors.feature`: with no practice running, a head elf reads `/api/admin/elf/finds` and gets 200 with `doors: []` (the year is next year, so no real door's clue is out).
- [ ] **Step 5: Commit** `feat(elf): Finds on the evening, and names fixed at midnight`.

### Task 6: The elf worker: clue emails, reminders, the morning email, alerts, proud moments and the clear out

**Files:**
- Create: `src/elf/schedule.ts`, `src/elf/worker.ts`, `src/db/elf-sends.ts`
- Modify: `src/index.ts` (start it beside `startSendWorker`), `src/routes/elf.ts` (proud moments after `recordWord`), `src/routes/admin-elf.ts` (the tick hook), `features/elf-game.feature`, `features/steps/elf-game.steps.js`
- Test: `test/unit/elf-schedule.test.ts`, `test/unit/elf-worker.test.ts`, `test/unit/elf-db-sends.test.ts`, `test/unit/elf-routes-game.test.ts` (extend), `test/unit/admin-elf.test.ts` (extend)

**Interfaces:**
- Consumes: `loadDoorRuns`, `markAutomaticSnowDays`, `finderOf`, `finderParts`, `doorCounts`, `familyDoorsDone` (Plan 2a and Task 5); Task 2's builders and senders; Task 3's `photoAlertDue`, `alertRecipients`, `listHeadElves`, `lastAlert`, `recordAlert`, `oldestWaitingPhotoAt`; Task 4's `countPhotosWaiting`, `deleteExpiredPhotoFiles`; `sendText`; `getElfSettings`; `readinessOf`; `progressOf`, `promotionsBetween`, `RANKS`.
- Produces, in `elf-sends.ts`:
  - `claimSend(kind: string, key: string): Promise<boolean>`: `INSERT INTO elf_sends (kind, key) VALUES ($1, $2) ON CONFLICT (kind, key) DO UPDATE SET claimed_at = now(), attempts = elf_sends.attempts + 1 WHERE elf_sends.sent_at IS NULL AND elf_sends.attempts < 3 AND elf_sends.claimed_at < now() - interval '10 minutes' RETURNING key`, true when a row comes back.
  - `markSent(kind, key)`; `markSendFailed(kind, key, error: string)`.
  - `familiesStillToEmail(year, door, limit): Promise<{ familyId; email; grownUpName }[]>`: active families not removed, by id, `WHERE NOT EXISTS (SELECT 1 FROM elf_sends s WHERE s.kind = 'clue' AND s.key = $key || ':' || f.id AND (s.sent_at IS NOT NULL OR s.attempts >= 3 OR s.claimed_at > now() - interval '10 minutes'))`, so a sent, given up or in flight row is simply skipped and never blocks the rows after it.
- Produces, in `schedule.ts` (pure):
  - `type DueKind = "clue" | "reminder" | "morning" | "find" | "sweep"`
  - `interface Due { kind: DueKind; key: string; door: Door | null }`
  - `function dueNow(o: { year: number; runs: DoorRun[]; now: Date; doorsOn: boolean }): Due[]`: with `doorsOn` false, nothing; `clue` for a run whose `clue1At <= now < clue1At + 6 hours` and `facts.snowDay` is false (key `${year}-${door}`); `reminder` for a run whose day is today in London with `doorInstant(season, door, "09:00") <= now < + 3 hours`, `facts.snowDay` false and `contactEmail` set; `morning` at or after 8am London on each day from 30 November to 25 December (key the London date `YYYY-MM-DD`); `find` for a run with `foundAt` set (key `${year}-${door}`); `sweep` every ten minutes (key `${year}:${Math.floor(now / 600_000)}`).
  - `const CLUE_EMAILS_A_TICK = 25`.
  - `function proudKeys(year: number, detectiveId: number, progress: Progress): string[]`: `rank:${detectiveId}:${rank}` for every rank in `RANKS` above Trainee with `at <= progress.doorsDone`, plus `grad:${detectiveId}` when `progress.graduate`.
- Produces, in `worker.ts`: `interface ElfWorkerDeps` (every outside call: the loaders, the senders, `claimSend`, `markSent`, `markSendFailed`, `sendText`, `markAutomaticSnowDays`, `deleteExpiredPhotoFiles`, the alert reads and writes); `runElfTick(at: Date, deps: ElfWorkerDeps): Promise<void>`; `startElfWorker(intervalMs = 30_000)` and `stopElfWorker()` on the newsletter worker's shape (a guard against overlapping ticks, `unref`), the timer calling `runElfTick(new Date(), realDeps)`. What a tick does, in order, each part in its own try/catch so one failure never stops the rest: `markAutomaticSnowDays(year, at)` when `doorsOn`; `dueNow`; for each `clue`: up to `CLUE_EMAILS_A_TICK` from `familiesStillToEmail`, each claimed (`claimSend("clue", `${key}:${familyId}`)`), built and sent, `markSent`, or `markSendFailed` with the message and on to the next; `reminder`: claim, build with the door's contact, `closesAt` and the place phone, send to `contactEmail`; `morning`: claim, build for the day (today's run with its `readinessOf`, yesterday's run with `finderParts` and its state, `countPhotosWaiting`, the posts, `doorPicture`), send to `alertRecipients(listHeadElves()).emails`; `find`: claim, build with `finderOf`, email the same people (C7); `sweep`: claim, then for every active detective of a family not removed, `proudKeys(year, id, progressOf(doorsDone))`, each claimed as `("proud", `${year}:${k}`)` and, when newly claimed, one `elfProud` email ("promoted" or "graduated") to the family, so a rank earned by a guess, a snow day or a visit counting from the reveal is never missed; photo alerts: when `photoAlertDue({ oldestWaitingAt, lastAlertAt }, at)`, claim `("photo-alert", lastAlertAt?.toISOString() ?? "first")`, email everyone with alerts on and text everyone with a mobile (a `sendText` that throws is counted in `textsFailed` by name and never stops the rest), `recordAlert`; last, `deleteExpiredPhotoFiles(at)` on every tick.
- Produces, in `routes/elf.ts`: after a `recordWord` that stamped someone, `sendProudMoments(deps)`: a `won` outcome claims `("proud", `${year}:won:${familyId}:${door}`)` and emails "won"; each stamped detective's `proudKeys` are claimed and emailed as the sweep does; best effort, logged, never failing the word's answer. Door 0 sends nothing.
- Produces, in `admin-elf.ts`: `POST /api/admin/elf/worker/tick { at: ISO string }` (edit): outside production only (404 in production), runs `runElfTick(new Date(at), realDeps)` once and answers `{ ok: true }`; it is how the BDD moves the worker to midday.

- [ ] **Step 1: Write the failing schedule tests.** At 5:31pm on 7 December with door 7 hunting: `dueNow` holds `clue 2026-7`; at 11:31pm it does not; with `facts.snowDay: true` neither `clue` nor `reminder` ever; at 9:05am `reminder 2026-7`, and not when `contactEmail` is null; at 8:00am `morning 2026-12-07` and at 7:59am not; door 6 found yields `find 2026-6`; `doorsOn: false` yields nothing on 7 December; `sweep` keys change every ten minutes; `proudKeys(2026, 5, progressOf({ cracked: [1,2,3,4,5,6], visited: [], snow: [] }))` is `["rank:5:Junior Detective"]` and with 24 doors includes `grad:5`.
- [ ] **Step 2: Write the failing worker and sends tests.** `claimSend`'s SQL contains `ON CONFLICT (kind, key) DO UPDATE`, `attempts < 3` and `RETURNING key`, and answers false on no row; `familiesStillToEmail`'s SQL contains `sent_at IS NOT NULL OR s.attempts >= 3 OR s.claimed_at > now() - interval '10 minutes'`. With fakes: a tick with `clue 2026-7` due and three families claims three keys and sends three emails, and when `claimSend` answers false for the second it sends two; a sender that throws calls `markSendFailed` with its message and the tick goes on to the next family; `markAutomaticSnowDays` is called with `at` when `doorsOn` and never when off; a photo alert due with two head elves, one with a mobile, sends two emails and one text and records `texts: 1`; when `sendText` throws, `textsFailed` holds that name and both emails still go; `claimSend` false for the alert sends nothing; the sweep with a detective at 6 doors done (one by a snow day) claims `proud 2026:rank:<id>:Junior Detective` and sends one "promoted" email, and a second tick ten minutes on sends nothing; `deleteExpiredPhotoFiles` is called on every tick with `at`. The word handler calls `sendProudMoments` after `recordWord`, with the `won` key for a win, and a throw there leaves the answer 200. The tick hook is 404 with `NODE_ENV: "production"` and runs the tick at the given `at` otherwise.
- [ ] **Step 3: Run them.** `npx vitest run test/unit/elf-schedule.test.ts test/unit/elf-worker.test.ts test/unit/elf-db-sends.test.ts test/unit/elf-routes-game.test.ts test/unit/admin-elf.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** `index.ts` starts the worker with a comment like the newsletter sender's (never from `createApp`).
- [ ] **Step 5: Run them again.** Expected: PASS.
- [ ] **Step 6: Extend the BDD** in `features/elf-game.feature` (Plan 2a's practice scenario), after the second family's photo is 202: the admin gives themselves a mobile (`PATCH /api/admin/elf/alerts/me { mobile: "07700 900 123" }`), posts `/api/admin/elf/worker/tick` with `at` set to today at 12:00 London, and then one `elfPhotoAlert` email went to the admin's address (through the email log, as `features/steps/elf-admin.steps.js` counts emails) and `GET /api/admin/elf/alerts` shows `lastAlert` with `textsFailed: []` (the stub); a second tick at 12:01 sends no second alert; the admin reads `/api/admin/elf/photos`, sees the photo as door 0 with `practice: true`, approves it, and the log's newest step starts "Approved by"; after the practice reveal has passed, `GET /elf/door/0/photo/<token>.jpg` with the preview cookie is 200.
- [ ] **Step 7: Lint, check types, and commit** `feat(elf): the elf worker: clue emails, reminders, the morning email, alerts, proud moments and the January clear out`.

### Task 7: Words for Jaimie, and the README

**Files:**
- Create: `docs/superpowers/specs/2026-11-10-elf-wave-2-words.md`
- Modify: `README.md`

- [ ] **Step 1: Write the words file**: every new or changed sentence a person reads from Plan 2a and this plan, grouped by where it appears (the calendar and the scrapbook, Detective HQ, the poster page and the visit, the refusals, the prints as Plan 1 changed them, each email with its subject, the text, Head Elf HQ's new parts), each with a tick box, and the line at the top that December's doors are not switched on until every box is ticked. Invented examples only.
- [ ] **Step 2: Update README.md**: the route table (every route of Tasks 3 to 6, "implemented"); the Elf Detective School section: the photo check and log (names from `users.full_name`), alerts and their rules (one at a time, 30 minutes, 9pm to 8am, email only for a find), the emails and where to read them, the worker (`elf_sends`, the claim and retry rule, the ten minute sweep for ranks earned any way, the clear out from 31 January by each photo's year, the tick hook outside production), Finds, and the texts plan's console steps as still owed if they are.
- [ ] **Step 3: Run the whole suite** with `npm run test:unit`, and report by name any failure other than perf-budget and footer-master.
- [ ] **Step 4: Commit** `docs(elf): the words for Jaimie and the README for alerts, emails, Finds and the worker`.
