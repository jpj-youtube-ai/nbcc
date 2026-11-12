# Elf Detective School, Plan 2c-1: catching up on missed doors, and the places after Christmas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A family never sees where a door's elf was hiding until it has had its guess at that door or been there; a family that missed a door can crack it later from home, with the same three clues and one guess that the database keeps to one; a right go counts exactly like a right guess on the night; a visit counts as done for every detective in the family; from Christmas Day until 1 January every place and approved photo is on the calendar for everyone; and on a door's own day the clues say when its hiding place closes. Everything ships behind December's doors switch, off.

**Architecture:** One migration adds `elf_guesses.late`. The rules stay pure: a new `src/elf/catch-up.ts` holds the one rule (`knowsPlace`), having a go (`mayHaveAGo`, `decideGo`, `doorsToCrack`), the Christmas window (`placesPublic`, `goesOpen`) and the closing time the clues show (`closingShown`), and `src/elf/guess.ts` learns the go and a refusal that names only a door the family can see. The calendar everyone shares, still built once every 15 seconds, carries no place and no photo; a signed in family's own places and photos come from a new private route, `GET /api/elf/me/door/:n`, which the calendar's script lays over the shared doors, and the photo bytes go only to such a family, `private, no-store`. Having a go is a new Detective HQ page, `/elf/hq/door/:n`, with a plain link for the next clue and a plain form for the one guess, so it needs no script. The practice door (year 0, door 0) plays all of it at any time of year, which is how the BDD proves it.

**Tech Stack:** TypeScript on Express, Postgres with node-pg-migrate, Vitest (jsdom for the scripts), Cucumber BDD (CI only).

**Spec:** `docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md`, part 1 in full (approved by Jaimie on 12 November 2026; its answered questions and "my calls" are binding), with answer 2 (a visit counts for every detective in the family), answer 5 (the closing time with the clues), answer 6 (the places after Christmas) and the carried public photo route. It builds on Plans 2a and 2b as merged switched off (`docs/superpowers/plans/2026-11-10-elf-wave-2-game-1.md` and `-game-2.md`, TASK-609 and TASK-611). Where the place shows today is mapped in `.superpowers/sdd/2026-11-11-elf-late-guessing/recon.md` (not in git). Plan 2c-2 (`docs/superpowers/plans/2026-11-12-elf-grand-prize.md`) starts from this plan's finished interfaces.

## Planner's calls

Where the spec is silent, decided here:

1. Having a go is its own Detective HQ page, `/elf/hq/door/:n`, reached from today's case, the new list and the shared calendar's open door. It needs no script: **Show me the next clue** is a plain link (`?clues=2`, `?clues=3`) and the guess a plain form. The clues opened are not remembered between visits; each visit starts at clue 1, and nothing is stored.
2. A go is a row in `elf_guesses` with `late = true`: the primary key keeps it one a family a door, its insert never overwrites anything, and the night's save never overwrites a go.
3. A guess for tonight's door that arrives after its shown moment is never saved as the go. A family with no guess is sent to the go page to make it there (the page says "You get one guess at this door."); a family with one is sent back to Detective HQ, which shows how it did. A family that has been to the place but never guessed is told there is nothing to guess.
4. The shared calendar's open door offers **Have a go** to every visitor until Christmas Day (signed out, it leads to sign in). A family that can see the place gets its own door instead, drawn by the new private route, which the calendar's script fetches for each door in `/api/elf/me`'s new `known` list. `known` and `goes` are in `/api/elf/me` only while December's doors are on, so with them off it is byte for byte today's.
5. The shared scrapbook shows and counts the elves only; the photo row and its count are in a family's own door, and in everyone's from Christmas Day to 1 January. The photo bytes are `private, no-store` even then.
6. From 1 January the calendar goes back to the December rule: everyone else sees no place or photo, and a family still sees the ones it could see before Christmas.
7. The practice door's go never closes (it has no Christmas), and it is never public.
8. The closing time shows only for a door with a closing time typed in Doors (the 8pm a door falls back to is not the place's real time), only on the door's own day, from clue 1, until it has passed. The clue email carries it too.
9. The clue email's line on finding out is "You find out whether you cracked it at 7pm, or later if the elf is still hiding then." This answers the words file's question 9.
10. A sibling's promotion earned by another detective's visit, or by a go, is emailed by the worker's ten minute sweep, as every rank earned any way already is.
11. The wardrobe's note on a costume locked behind a missed door says "Crack it in Detective HQ to catch up" while December's doors are on (it said "Visit the place to catch up", and the family may not know the place); with them off it is unchanged.
12. Pictures for Jaimie (the spec's "show them to Jaimie as pictures first"): the go page, Detective HQ's list and the shared open door are rendered on pretend data at 390 and 360 pixels after their tasks' review and shown to Jaimie before the pull request merges, switched off; a change she asks for is made in the same pull request.

## Questions

None. Each gap above is a planner's call that would cost only words or styling to change.

## Global Constraints

- The repository is public. Invented names only, in every test, fixture, BDD step and example sentence: places such as Corner Bakehouse, Snowford and The Example Bakehouse, Exampleton; elves such as Twinkle; the finder Detective R. Tinselfoot; grown ups and head elves such as Alex Example; `07700 900 123`, `01632 960 123`, `@example.org`. Never a real person (NBCC's own team included), place, clue or prize, in code, tests, docs, commit messages or pull request text.
- "Elf Detective School" always in full when it means the game; never "the school". Plain English with no dashes in any words a person reads; money wording uses "could"; "tonight" only for a clue after midday.
- Family screens keep the paper look and the house rules of `test/unit/elf-pages-house-rules.test.ts`; public scripts keep the site's no build style (an IIFE, `"use strict"`, `var`, no arrows, the `module.exports` guard). No inner scrollbars; every screen works at 390 and 360 pixels wide with no sideways scroll; status words use `is-ok` and `is-error`, never `.err`.
- Every new page is drawn through `elfPage` (`src/elf/pages/shell.ts`), which takes its banner and footer from `src/site/chrome.ts`, and is added to `PAGES` in `test/unit/site-chrome-everywhere.test.ts` and in `test/unit/elf-pages-house-rules.test.ts`.
- Every route that awaits anything has its whole body in a try/catch ending in `gameFailed(res, what, err, json)` (`src/routes/elf.ts`), so it answers 500, never a rejection. Admin routes (only Finds is touched here) keep no-store, `authorizeSection`, the standard 500 `{ error: "Admin is temporarily unavailable" }` and audited writes.
- Children's safety: a child is named in public only through `detectiveName` or `detectiveNames`; a name never sits beside a photo.
- The one rule (the spec's "How it works"): a family can see a door's place once the door's shown moment has passed and the family has a guess at it, or once one of its detectives has typed the door's tag word. Nobody else learns a place in December from the shared calendar or its feed, the door feed, a fingerprint (`doorVersion`), a screen reader label, a page title, a refusal, an email, a post, a log or a shared cache. Every answer that is a family's own is `Cache-Control: private, no-store`. The poster page and the gold and visit cards still name the place, because the family is standing there.
- Switched off: while `doorsOn` is false every page and every answer a family gets is byte for byte what it is today. The practice door plays everything through the preview link.
- Times are Europe/London. Christmas Day starts at midnight London at the start of 25 December of Elf Detective School's year (`elf_settings.year`); 1 January at midnight at the start of 1 January of the year after.
- Migrations only add. This plan's migration is `migrations/1791200000470_elf-catch-up.js` (main's newest is `1791200000460_elf-family-mobile.js`). Right before the pull request run `git fetch && git ls-tree --name-only origin/main migrations/ | sort | tail -3` and renumber it above main's newest if another has landed.
- Tests first. Unit tests touch no database: mock `src/db/*` and `src/db/pool` as `test/unit/elf-routes-game.test.ts` does, and set the clock with `vi.setSystemTime` or pass it in. The SQL is proved by BDD, which runs only in CI. No BDD date bombs: the `@elf-school` hooks play every scenario in next year's December (every real door and every Christmas still to come); the scenario "the school's year is last year" plays a December whose Christmas Day and 1 January have always passed; the practice door's times are absolute. No step compares the real clock with a date written in a feature: where an answer depends on the moment, the moment is the app's own (`christmasDay`, `newYearsDay` in `src/elf/catch-up.ts`) and the scenario's year puts it firmly before or after now.
- Config: none added.
- Locally `perf-budget` and `footer-master` fail on Windows line endings (and one test can time out under the full suite's load); those are not real failures. Run `npm run lint` and `npx tsc --noEmit` before each commit. Commit only the files the task names, never `.mcp.json`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The words file and README.md are updated in Task 10.

## Review Focus

Each line names the test that pins it.

1. Two tabs, or two phones, press **Lock in my guess** at the same moment: exactly one go is saved and the other is told it has had its go. Task 2's `saveLateGuess` test (`ON CONFLICT (year, door, family_id) DO NOTHING`, no row is "already") and Task 6's BDD "from two tabs at once".
2. A night guess saved in the second before a door opens is cracked and can never overwrite a go, and a go can never pass as a night guess: Task 1's `cracked` tests one second either side of `openedAt`, Task 2's `saveGuess` test (`WHERE NOT elf_guesses.late`).
3. A family that has not guessed door 3 types door 3's place as tonight's guess: it is saved like any other guess, and nothing says door 3. Task 1's `decideGuess` test with door 3 left out of `openPlaces`, and Task 7's route test.
4. The shared calendar carries no place or photo for an open door from its shown moment to Christmas Day, carries both from Christmas Day, and neither from 1 January: Task 4's `calendarViewFor` tests at 11:59:59pm on 24 December, midnight on 25 December, 11:59:59pm on 31 December and midnight on 1 January, and Task 5's photo route tests signed out at those moments.
5. With December's doors off, `/api/elf/me`, the calendar, Detective HQ and the rules page are exactly today's: Task 5's `getMe` test "with the switch off" (its keys are exactly `doors` and `photos`), Task 7's HQ test with `doorsOn: false`, Task 9's rules test.

---

### Task 1: The one rule, having a go, and the Christmas window

**Files:**
- Create: `src/elf/catch-up.ts`
- Modify: `src/elf/guess.ts`, `src/db/elf-game.ts` (only `GuessRow` and `savedGuess`, so the build stays green until Task 2 reads the column)
- Test: `test/unit/elf-catch-up.test.ts` (new), `test/unit/elf-guess.test.ts` (extend)

**Interfaces:**
- Consumes: `DoorState`, `isOpen`, `canGuess`, `doorState` (`src/elf/doors.ts`); `normalisePlaceName`, `sameName`; `GUESS_MAX`; `londonToInstant` (`src/tickets/model.ts`); `sameDay` (`src/elf/words.ts`); `DoorRun` (a type import from `src/db/elf-game.ts`, as `src/elf/views.ts` has it).
- Produces, in `guess.ts`:
  - `SavedGuess` gains `late: boolean`: true for a go, made once the door was open, and final.
  - `cracked(door, guess)`: a night guess (`late` false) counts only when saved strictly before `openedAt`, as now; a go (`late` true) only when saved at or after it. Both need the door open and the guess's `norm` to equal `normalisePlaceName` of one of the names.
  - `GuessRefusal` gains `"locked-in" | "have-a-go"`. `GuessContext` gains `hasGuess: boolean` and `mayHaveAGo: boolean`, and its `openPlaces` now holds only the open doors whose place this family can see (the caller filters them with `knowsPlace`). `decideGuess` checks, in this order: empty; too long; an open door is "locked-in" with `hasGuess`, else "have-a-go" with `mayHaveAGo`, else "not-hunting"; `canGuess` false is "not-hunting"; a text that `sameName`s an open place is "place-already-open" with its door; otherwise ok.
  - In `src/db/elf-game.ts`: `GuessRow` gains `late?: boolean` and `savedGuess` maps `late: r.late === true`.
- Produces, in `catch-up.ts` (pure):
  - `christmasDay(year: number): Date` (midnight London starting 25 December of `year`) and `newYearsDay(year: number): Date` (midnight London starting 1 January of `year + 1`), both from `londonToInstant`.
  - `placesPublic(year: number, now: Date): boolean`: `christmasDay(year) <= now < newYearsDay(year)`; always false for year 0.
  - `goesOpen(year: number, now: Date): boolean`: always true for year 0; else `now < christmasDay(year)`.
  - `interface FamilyKnowledge { guesses: ReadonlyMap<number, SavedGuess>; typed: ReadonlySet<number> }`: `typed` is every door where a detective of the family has typed the tag's word (the find or a visit), whether or not it counts yet.
  - `knowsPlace(o: { state: DoorState; guessed: boolean; typed: boolean }): boolean`: `(isOpen(state) && guessed) || typed`.
  - `mayHaveAGo(o: { year: number; state: DoorState; guessed: boolean; typed: boolean; now: Date }): boolean`: `isOpen(state) && !guessed && !typed && goesOpen(year, now)`.
  - `doorsKnown(o: { runs: readonly DoorRun[]; knowledge: FamilyKnowledge; now: Date }): Door[]`: the real doors (1 to 24) that are open at `now` and whose place the family knows, in door order.
  - `doorsToCrack(o: { runs: readonly DoorRun[]; knowledge: FamilyKnowledge; now: Date }): DoorRun[]`: the real doors with `mayHaveAGo`, newest first (door number down).
  - `type GoRefusal = "not-open" | "closed" | "already" | "been-there" | "empty" | "too-long"` and `decideGo(ctx: { year: number; state: DoorState; guessed: boolean; typed: boolean; now: Date }, text: unknown): { ok: true; text: string; norm: string } | { ok: false; reason: GoRefusal }` (`ctx.typed` is whether the family typed the tag's word; `text` is the guess), checking in this order: not open, `goesOpen` false ("closed"), `guessed` ("already"), `typed` ("been-there"), empty once trimmed, longer than `GUESS_MAX`; ok with `norm = normalisePlaceName(text)`.
  - `closingShown(run: DoorRun, now: Date): Date | null`: `run.facts.closesAt` when the door has a closing time typed (`run.closesAt !== null`), that instant is on the door's own day in London (`sameDay(run.facts.closesAt, run.facts.clue1At)`), the door is neither shut nor a snow day at `now`, and `now` is before it; else null.

- [ ] **Step 1: Write the failing tests.** `christmasDay(2026)` is `2026-12-25T00:00:00.000Z` and `newYearsDay(2026)` is `2027-01-01T00:00:00.000Z`. `placesPublic(2026, …)` is false at `2026-12-24T23:59:59Z`, true at `2026-12-25T00:00:00Z` and at `2026-12-31T23:59:59Z`, false at `2027-01-01T00:00:00Z`; `placesPublic(0, 2026-12-26T12:00Z)` is false. `goesOpen(2026, …)` is true at `2026-12-24T23:59:59Z` and false at `2026-12-25T00:00:00Z`; `goesOpen(0, 2027-03-01T12:00Z)` is true. `knowsPlace`: found and guessed is true; "found-hidden" and guessed is false; hunting and typed is true; revealed with neither is false; "snow" with neither is false. `mayHaveAGo` for door 7 found and open at 7:05pm on 7 December 2026, not guessed, not typed, is true; at Christmas Day false; guessed false; typed false; "found-hidden" false; "snow" false; year 0 in March true. With runs (built by `runOf`) of door 3 found, door 4 snowed in, door 5 revealed, door 6 guessed, door 7 typed and door 8 hunting at 7:05pm on 8 December: `doorsToCrack` gives doors `[5, 3]` and `doorsKnown` gives `[6, 7]`; a door typed while "found-hidden" is not in `doorsKnown`. `decideGo` gives each refusal in the order above (a guessed family's empty text is "already"), `"  Corner Bakehouse "` is ok with norm `cornerbakehouse`, and 81 letters is "too-long". `closingShown` for door 7 with `closesAt: "20:00"` is 8pm at 6:10pm, null at 8:01pm, null at 5:29pm, null with `closesAt: null`, null on a snow day, and null for `"01:00"` (the next day). In `elf-guess.test.ts`: a go (`late: true`) saved at 7:05pm against `openedAt` 7pm with a matching norm is cracked; one saved at 6:59:59pm is not; a night guess saved at 7:00:00pm is not, as now. `decideGuess` on a "found" door is "locked-in" with `hasGuess`, "have-a-go" with `mayHaveAGo`, "not-hunting" with neither; an empty text on a "found" door is "empty"; on a hunting door "pine cone cafe" is ok when door 3 is not in `openPlaces`, and `{ ok: false, reason: "place-already-open", door: 3 }` when `openPlaces` holds door 3 named "Pine Cone Café".
- [ ] **Step 2: Run them.** `npx vitest run test/unit/elf-catch-up.test.ts test/unit/elf-guess.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `catch-up.ts` and the changes to `guess.ts`, then give `GuessRow` and `savedGuess` their `late`. Fix the existing `decideGuess` callers with `hasGuess: false, mayHaveAGo: false` for now (Task 7 gives the guess route the real values) and every `SavedGuess` built in tests with `late: false`.
- [ ] **Step 4: Run them again,** then `npm run lint` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): the one rule, having a go and the Christmas window, as pure rules`.

### Task 2: One go at a door, kept by the database

**Files:**
- Create: `migrations/1791200000470_elf-catch-up.js`, `test/unit/elf-catch-up-migration.test.ts`
- Modify: `src/db/elf-game.ts`
- Test: `test/unit/elf-db-game.test.ts` (extend)

**Interfaces:**
- Consumes: `SavedGuess`, `FamilyKnowledge` (Task 1).
- Produces:
  - The column `elf_guesses.late boolean NOT NULL DEFAULT false`, with the comment "A guess made when having a go, once the door was open: one only, and final."
  - `saveGuess` keeps its signature; its `DO UPDATE` gains `WHERE NOT elf_guesses.late`, so the night's save never overwrites a go.
  - `saveLateGuess(year: number, door: number, familyId: number, guess: { text: string; norm: string }, at: Date): Promise<"saved" | "already">`: `INSERT INTO elf_guesses (year, door, family_id, text, norm, saved_at, late) VALUES ($1, $2, $3, $4, $5, $6, true) ON CONFLICT (year, door, family_id) DO NOTHING RETURNING family_id`; no row back is "already".
  - `familyGuesses` and `doorGuesses` select `late`.
  - `familyKnowledge(year: number, familyId: number): Promise<FamilyKnowledge>`: `familyGuesses(year, familyId)` and `SELECT DISTINCT door FROM elf_visits WHERE year = $1 AND family_id = $2`, in parallel.

- [ ] **Step 1: Write the failing migration test,** in the style of `test/unit/elf-family-mobile-migration.test.ts`: `up` is exactly one `addColumns("elf_guesses", { late: { type: "boolean", notNull: true, default: false, comment } })`; `down` drops `late`; the file sorts after `1791200000460_elf-family-mobile.js` (not "sorts last": the next session's migration would break it).
- [ ] **Step 2: Write the failing data tests.** `saveLateGuess(2026, 7, 3, { text: "Corner Bakehouse", norm: "cornerbakehouse" }, at)` sends SQL containing `ON CONFLICT (year, door, family_id) DO NOTHING`, `RETURNING` and the literal `true` for `late`, with the params `[2026, 7, 3, "Corner Bakehouse", "cornerbakehouse", at]`; rows `[]` answer "already" and `[{ family_id: 3 }]` "saved". `saveGuess`'s SQL contains `WHERE NOT elf_guesses.late`. `familyGuesses` maps a row with `late: true` to `{ text, norm, at, late: true }` (the existing test now expects `late: false` for a row with `late: false`). `familyKnowledge(0, 3)` answers the practice door's guess under key 0 and `typed` holding 0 from the rows `[{ door: 0 }]`.
- [ ] **Step 3: Run them.** `npx vitest run test/unit/elf-catch-up-migration.test.ts test/unit/elf-db-game.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the migration (with the house header comment: what it adds and why it is additive) and the data functions.
- [ ] **Step 5: Run them again.** Expected: PASS. Check `ls migrations | sort | tail -3` puts 470 last.
- [ ] **Step 6: Commit** `feat(elf): one go a family a door, kept by the database`.

### Task 3: Doors done: a right go counts, and a visit counts for the whole family

**Files:**
- Modify: `src/elf/progress.ts`, `src/elf/wardrobe.ts` (`wardrobeState`), `src/db/elf-game.ts` (`familyDoorsDone`, `doorCounts`), `src/routes/admin-elf-finds.ts` (`findRow`)
- Test: `test/unit/elf-progress.test.ts`, `test/unit/elf-wardrobe.test.ts`, `test/unit/elf-db-game.test.ts`, `test/unit/admin-elf-finds.test.ts`

**Interfaces:**
- Consumes: `cracked` with the go (Task 1); `late` read from the rows (Task 2).
- Produces:
  - `DoorsDone` gains `family?: readonly number[] | null`: the doors any detective in the family has visited (the find or a visit), counting by now. Each is done for every detective in the family (answer 2). `visited` stays the detective's own stamps, which are its candy canes and its gold seal.
  - `doneDoorsOf(doors: DoorsDone): number[]` (exported): every door done any way (cracked, visited, family, snow), real doors only, in order. `progressOf().doorsDone` is its length and `wardrobeState` builds on it; `progressOf`'s `cracked`, `visited` and `goldSeal` are unchanged.
  - `familyDoorsDone` gives each detective `family`: the open real doors where any visit of the family counts by `now`.
  - `doorCounts(year, door, now, run, withLate = true)`: with `withLate` false, a go is left out of the cracked count. The calendar's "N families cracked this case" counts gos (the spec); Finds calls `doorCounts(run.year, run.door, now, run, false)` (the spec: Finds does not count late cracks).

- [ ] **Step 1: Write the failing tests.** `progressOf({ cracked: [], visited: [], family: [1, 2, 3, 4, 5, 6] })` has `doorsDone: 6`, rank "Junior Detective", `visited: 0`, `goldSeal: false`; 24 family doors give `graduate: true` and `goldSeal: false`; 24 visited give the gold seal. `doneDoorsOf({ cracked: [2], visited: [1], family: [1, 3, 0, 25], snow: [4] })` is `[1, 2, 3, 4]`. `wardrobeState({ cracked: [], visited: [], family: [5] }).doors` is `[5]`. `familyDoorsDone` for a family with detectives 11 and 12, a visit by 11 at door 7 counting from 6pm and door 7 open since 7pm, at 7:05pm: detective 12 has `family: [7]` and `visited: []`, detective 11 `visited: [7]`; a matching go by the family at door 6 (open since 6 December), saved at 7:10pm on 7 December, is in both detectives' `cracked` at 7:15pm and in neither at 7:09pm. `doorCounts` with one cracking night guess and one cracking go is `cracked: 2`, and `1` with `withLate` false. Finds' `findRow` passes `false` as `doorCounts`' fifth argument.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/elf-progress.test.ts test/unit/elf-wardrobe.test.ts test/unit/elf-db-game.test.ts test/unit/admin-elf-finds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `progress.ts`'s opening comment honest: a door is done when the family cracks it, when any detective of the family visits it, or when it snows; the gold seal is the detective's own visits.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): a right go counts as a crack, and a visit is done for every detective in the family`.

### Task 4: The calendar everyone shares carries no place

**Files:**
- Modify: `src/elf/pages/types.ts` (`DoorView.goUrl`), `src/elf/views.ts` (`doorViewOf`, new `familyDoorView`), `src/elf/pages/door.ts`, `src/elf/pages/calendar.ts`, `src/db/elf-game.ts` (`doorScrapbook`, new `doorPhotos`), `src/routes/elf.ts` (`loadPublicCalendar` only), `assets/css/elf.css` (`.elf-book__go`), `test/unit/elf-fixtures.ts` (`goUrl: null` on every door)
- Test: `test/unit/elf-views.test.ts`, `test/unit/elf-page-door.test.ts`, `test/unit/elf-page-calendar.test.ts`, `test/unit/elf-db-game.test.ts`, `test/unit/elf-pages-house-rules.test.ts`

**Interfaces:**
- Consumes: `placesPublic`, `goesOpen` (Task 1); `ScrapPhoto`, `orderScrapbook` (`src/elf/scrapbook.ts`).
- Produces:
  - `DoorView.goUrl: string | null`: `/elf/hq/door/${n}` on an open door while having a go is open (until Christmas Day), the same for every visitor; null otherwise, and on a family's own door.
  - `calendarViewFor` (through `doorViewOf`) gives an open door its `place` only while `placesPublic(run.year, now)`, and its scrapbook exactly as the loader passed it.
  - `familyDoorView(shared: DoorView, mine: { place: { name: string; town: string }; photos: readonly ScrapPhoto[] }): DoorView` (pure, exported): an open door with its place, its scrapbook remade by `orderScrapbook(shared elves, mine.photos)` and `goUrl: null`; a door that is not open comes back unchanged.
  - `doorScrapbook(year, door, now, withPhotos: boolean)`: the photos are read only with `withPhotos`. `doorPhotos(year: number, door: number): Promise<ScrapPhoto[]>`: the shown photos (`SHOWN_PHOTO_SQL`) with their urls. `loadPublicCalendar` passes `placesPublic(run.year, now)` as `withPhotos`.
  - `doorVersion` includes `d.goUrl`. `calendarStatus` never names a place; its `placeOf` goes.

Words, exactly (`${elf}` the door's elf; `${by}` the public finder name; `${time}` from `clockWords`). With a place (a family's own door, or everyone's from Christmas Day to 1 January) every line stays as it is today. With no place:
- The scrapbook's title: found `${elf} was found!`; revealed `Nobody found ${elf} in time`.
- Revealed, under the title: `${elf} is still hiding, and the first detective to type the word on its tag wins the prize.` (nothing once its elf has gone home).
- At the end, while `goUrl` is set, after the gone home line when there is one: `Where was ${elf} hiding? Crack the case in Detective HQ to find out.` (revealed: `Where is ${elf} hiding? Crack the case in Detective HQ to find out.`) followed in the same `<p class="elf-book__end elf-detail__hint elf-book__go">` by the link `Have a go` (`elf-btn elf-btn--crimson elf-btn--s`, to `goUrl`).
- The news at the top, found: `${by} found today's elf at ${time}. Missed the hunt? You can still crack the case in Detective HQ.`; shown with nobody found: `Nobody has found today's elf yet, and the first detective to find it still wins the prize. You can crack the case in Detective HQ.` Each title, and the next clue line after it, stays as now.

- [ ] **Step 1: Write the failing view tests.** `calendarViewFor` with door 7 found at 5:47pm and shown at 7pm, its run holding "Corner Bakehouse" in "Snowford": at 7:05pm on 7 December 2026, and again at 11:59:59pm on 24 December, door 7 has `place: null`, `goUrl: "/elf/hq/door/7"` and no photos in its scrapbook; at midnight on 25 December `place` is set and `goUrl` null; at 11:59:59pm on 31 December `place` is set; at midnight on 1 January 2027 both are null. A "found-hidden" door has `goUrl: null`. `familyDoorView` on door 7 with two photos gives the place, `scrapbook.count` the elves plus 2 and the photos sorted by token, and `goUrl: null`; on a "found-hidden" door it gives back the same view.
- [ ] **Step 2: Write the failing page and data tests.** For a "found" and a "revealed" door 7 with `place: null` and `goUrl` set: the tile, the label and the detail contain neither "Corner Bakehouse" nor "Snowford"; the detail's `h3` says "Bauble was found!" (revealed: "Nobody found Bauble in time"; Bauble is the fixtures' elf for door 7); the detail holds `a[href="/elf/hq/door/7"]` reading "Have a go" inside `.elf-book__go`; with `goUrl: null` there is no "Have a go"; `doorVersion` differs between `goUrl` set and null; the same door with a place draws "The elf is still at Corner Bakehouse. Visit to add your picture." as today. `calendarStatus` for today's door found at 5:47pm by "Detective R. Tinselfoot" gives exactly `<p>Detective R. Tinselfoot found today's elf at 5:47pm. Missed the hunt? You can still crack the case in Detective HQ.</p>` followed by the next clue line, and never " at , ". `doorScrapbook(2026, 7, now, false)` sends one query and `true` sends two; `doorPhotos`' SQL holds `p.status = 'approved'` and `>= 2`. The house rules test adds "calendar, an open door for everyone else" and "calendar, an open door from Christmas Day". Existing tests that expected a place in the status or in a placeless view's title change to the words above.
- [ ] **Step 3: Run them.** `npx vitest run test/unit/elf-views.test.ts test/unit/elf-page-door.test.ts test/unit/elf-page-calendar.test.ts test/unit/elf-db-game.test.ts test/unit/elf-pages-house-rules.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** (CSS: `.elf-book__go` keeps the link on its own line on a phone).
- [ ] **Step 5: Run them again.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(elf): the calendar everyone shares carries no place and no photo until Christmas Day`.
- [ ] **Step 7 (the controller, after review):** render the calendar with an open door for everyone else, and the same door from Christmas Day, on pretend data at 390 and 360 pixels, and keep the pictures for Jaimie (planner's call 12).

### Task 5: A family's own places and photos

**Files:**
- Modify: `src/routes/elf.ts` (`getMe`, new `getMyDoor`, `getDoorPhoto`), `features/elf-game.feature`, `features/steps/elf-game.steps.js`
- Create: `test/unit/elf-routes-catch-up.test.ts` (the setup of `test/unit/elf-routes-game.test.ts`: the real router over HTTP, `src/db/*` mocked, its `door7`, `door6`, `door3` and `practiceRow` fixtures copied)
- Test: `test/unit/elf-routes-catch-up.test.ts`, `test/unit/elf-routes-game.test.ts` (the photo route's header)

**Interfaces:**
- Consumes: `familyKnowledge` (Task 2); `doorsKnown`, `doorsToCrack`, `knowsPlace`, `placesPublic` (Task 1); `familyDoorView`, `doorPhotos` (Task 4); `publicCalendar`, `loadDoorRun`, `doorTile`, `doorDetail`.
- Produces:
  - `GET /api/elf/me`: while December's doors are on it adds `known: number[]` (`doorsKnown`) and `goes: number[]` (`doorsToCrack`'s doors, newest first); with them off it answers exactly `{ doors, photos }` as today.
  - `GET /api/elf/me/door/:n` (`schoolOn`, `doorsOn`; `getMyDoor`, exported): `Cache-Control: private, no-store`; signed in, or 401 `{ error: "Not signed in" }`; `n` a real door while December's doors are on, else 404 `{ error: "Not found" }`; the shared calendar's door must be open, and the family must know its place (`knowsPlace` with `familyKnowledge`) or the places must be public (`placesPublic`), else 404 with nothing more read. It answers `{ tile, detail }`, drawn by `doorTile` and `doorDetail` from `familyDoorView(the shared door, { place: { name: run.placeName, town: run.placeTown ?? "" }, photos: await doorPhotos(year, n) })`, where `run` is `loadDoorRun(year, n, now)`.
  - `GET /elf/door/:n/photo/:token.jpg`: served only to a signed in family that knows the door's place, or to anyone while `placesPublic`; always `Cache-Control: private, no-store` (the five minute public cache goes); otherwise 404 as now.

- [ ] **Step 1: Write the failing route tests** (the clock at 7:05pm on 7 December 2026; door 7 found at 5:47pm and shown at 7pm, the only open door). `GET /api/elf/me` with December's doors on: a family with a night guess at door 7 has `known: [7]` and `goes: []`; a family with nothing has `known: []` and `goes: [7]`; with the doors off the body's keys are exactly `["doors", "photos"]`. `GET /api/elf/me/door/7`: a family that knows door 7 gets 200 whose detail contains "The Example Bakehouse" with `Cache-Control: private, no-store`; a family that does not gets 404 and `doorPhotos` is never called; signed out is 401; door 8 (shut) is 404; at midnight on 25 December a family that does not know it gets 200. The shared `GET /api/elf/door/7` holds no "The Example Bakehouse". The photo route: a knowing family gets the bytes with `private, no-store`; signed out is 404 at 7:05pm and at 11:59:59pm on 24 December, 200 with `private, no-store` at midnight on 25 December and at 11:59:59pm on 31 December, and 404 again at midnight on 1 January 2027; a signed in family that has not guessed is 404. A throw in `familyKnowledge` answers 500 with the game's words.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/elf-routes-catch-up.test.ts test/unit/elf-routes-game.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement,** exporting each handler, in the style of the file.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Extend the BDD.** In `features/elf-game.feature`'s scenario played in last year's December, after `door 7 on the calendar says "2 have been there since"`, add: `And door 7 on the calendar does not say "The Example Bakehouse"`, then `When the family "first.game.elf.bdd@example.com" opens "/api/elf/me"`, `Then the family can see door 7's place, and has no doors left to crack`, `When the family "first.game.elf.bdd@example.com" opens "/api/elf/me/door/7"`, `Then the game answers 200`, `And the family's own door says "The Example Bakehouse"`. New steps in `features/steps/elf-game.steps.js`: "door {int} on the calendar does not say {string}" (the door feed, signed out); "the family can see door {int}'s place, and has no doors left to crack" (`known` includes the door, `goes` is empty); "the family's own door says {string}" (the answer's tile and detail). Last year's Christmas Day and 1 January have always passed, so the place is off the shared calendar and having a go has closed, whenever this runs.
- [ ] **Step 6: Lint, check types, and commit** `feat(elf): a family's own places and photos, and the photo bytes kept private`.

### Task 6: Having a go: a door's page in Detective HQ, with one guess

**Files:**
- Create: `src/elf/pages/go.ts`
- Modify: `src/elf/pages/types.ts` (`GoView`), `src/elf/views.ts` (`goViewFor`), `src/elf/pages/hq.ts` (export `clueNote`), `src/routes/elf.ts` (`getGo`, `postGo`), `assets/css/elf.css`, `test/unit/elf-fixtures.ts` (`goView()`), `test/unit/site-chrome-everywhere.test.ts` (`PAGES`), `test/unit/elf-pages-house-rules.test.ts` (`PAGES`), `features/elf-game.feature`, `features/steps/elf-game.steps.js`
- Test: `test/unit/elf-page-go.test.ts` (new), `test/unit/elf-views.test.ts`, `test/unit/elf-routes-catch-up.test.ts`

**Interfaces:**
- Consumes: `decideGo`, `mayHaveAGo`, `knowsPlace`, `placesPublic`, `closingShown` (Task 1); `saveLateGuess`, `familyKnowledge` (Task 2); `cracked`, `openedAt`, `finderParts`, `detectiveNames`, `clueNote`; `familyOr`, `gameRun`, `familyRuns`, `doorNumberOf`, `allowedOnce`, `limits.guessFamily`, `ourOwnPage`, `wantsJson`, `forms` (all in `src/routes/elf.ts`).
- Produces:
  - `GoView` (types.ts): `{ door: Door | 0; practice: boolean; elfName: string; day: Date; found: { at: Date; by: string } | null; stage: "go" | "done" | "closed"; clues: TodayView["clues"]; nextUrl: string | null; formUrl: string; guessError: string | null; closesAt: Date | null; outcome: { verdict: "cracked" | "wrong" | "none"; place: { name: string; town: string }; stillHiding: boolean; goneHome: boolean; visited: boolean } | null; hqUrl: string }`.
  - `goViewFor(o: { run: DoorRun; now: Date; guess: SavedGuess | null; typed: boolean; finders: DetectiveNameParts[]; cluesShown: number; guessError?: string | null }): GoView` (views.ts): `stage` is "done" when `knowsPlace`, "go" when `mayHaveAGo`, else "closed". In "go" only: `clues` are the first `cluesShown` (held to 1 to 3) as `todayOf` builds them, and `nextUrl` is `/elf/hq/door/${door}?clues=${shown + 1}` while fewer than 3 show. `outcome` in "done", and in "closed" while `placesPublic` (verdict "none"); `verdict` is "cracked" by `cracked()`, "wrong" for any other guess, "none" without one; `stillHiding` is state "revealed"; `visited` is `typed`. `found` is set once `foundAt` is: `detectiveNames(finders)`, or "A detective". `day` is `run.calendarAt`; `formUrl` is `/elf/hq/door/${door}/go`; `closesAt` is `closingShown(run, now)`.
  - In go.ts: `goOutcomeWords(o: { elfName: string; verdict: "cracked" | "wrong" | "none"; place: { name: string; town: string }; stillHiding: boolean }): string` and `renderGoPage(view: GoView): string`, through `elfPage` with the title `Door ${n}` (`The practice door` for door 0), never the place, and the strip's button to Detective HQ.
  - `GET /elf/hq/door/:n` (`schoolOn`, `doorsOn`; `getGo`): `no-store`; `familyOr`; the door through `gameRun` (door 0 only with the preview link), else 404; a door that is not open at `now` (shut, hunting, found and hidden) or a snow day is 303 to `/elf/hq`; `?clues=` is read as 1, 2 or 3 (anything else is 1).
  - `POST /elf/hq/door/:n/go` (`forms`, `schoolOn`, `doorsOn`; `postGo`): JSON `{ text }` or the plain form's `text`; `ourOwnPage` (403); signed in (401 JSON, or 303 to `/elf/sign-in`); `allowedOnce` with `limits.guessFamily` (429 JSON `{ reason: "too-many-requests", message }`); `decideGo`, then `saveLateGuess(run.year, run.door, familyId, { text, norm }, now)`. JSON: 200 `{ cracked: boolean, message: goOutcomeWords(…) }`; a refusal `{ reason, message }` with 400 for "empty" and "too-long", 409 for "closed", "already" and "been-there" (`saveLateGuess` answering "already" is "already"), 404 for "not-open". The plain form: a saved go, "already" and "been-there" are 303 to `/elf/hq/door/${n}`, which shows how it went; "empty" and "too-long" draw the page again (400) with the words in the form's status line; "closed" draws it (409); "not-open" is 303 to `/elf/hq`.

Words, exactly (`${n}`; `${elf}`; `${day}` from `longDayWords`; `${time}` from `clockWords`; `${place}` and `${town}` the place's name and town):
- At the top: the label `Detective HQ`, the title strip `Door ${n}` (door 0: `The practice door`, with the chip `Practice`), and `${elf}, the elf behind door ${n}` (door 0: `${elf}, the practice door's elf`).
- Who found it: `Found by ${by} at ${time}.`, or `Nobody has found ${elf} yet.`
- Having a go: the heading `Crack the case`; `The clues came out on ${day}. Read them one at a time, then make your guess.`; the clue notes (`clueNote`); the link `Show me the next clue`; the form's legend `Where was ${elf} hiding?` (revealed: `Where is ${elf} hiding?`), its hint `Type the name of the place. Spelling does not have to be perfect.`, the note `You get one guess at this door.` and the button `Lock in my guess`; on the door's own day `The hiding place closes at ${time} today.`
- How it went (`goOutcomeWords`): cracked `You cracked it! ${elf} was hiding at ${place}, ${town}.`; wrong `Not this time. ${elf} was hiding at ${place}, ${town}.`; none `${elf} was hiding at ${place}, ${town}.`; while the elf is still hiding the part after the verdict is `${elf} is hiding at ${place}, ${town}, and nobody has found ${elf} yet. The first detective to type the word on its tag still wins the prize.` Then one of: `Your family has been there. Candy cane collected.` (visited); `${elf} has gone home now, so there is nothing to find there.` (gone home); `Visit the hiding place and scan its poster to collect your candy cane.` (otherwise). On the door's own day: `${place} closes at ${time} today.`
- Closed: `Having a go closed on Christmas Day.` (from Christmas Day to 1 January, followed by the "none" outcome).
- Refusals: empty `Type where you think ${elf} is hiding.`; too long `That is a bit long. Up to 80 letters is plenty.`; closed `Having a go closed on Christmas Day.`; already `You have already had your go at this door.`; been there `Your family has been to this hiding place, so there is nothing to guess.`
- At the foot: the link `Back to Detective HQ`.

- [ ] **Step 1: Write the failing view and page tests.** `goViewFor` for door 7 found at 5:47pm, its closing time typed as "20:00", at 7:05pm on 7 December 2026, no guess, not typed: `stage: "go"`, one clue, `nextUrl: "/elf/hq/door/7?clues=2"`, `closesAt` 8pm; `cluesShown: 3` gives three clues and `nextUrl: null`; `cluesShown: 9` gives three; on 8 December `closesAt` is null; a cracking go gives `stage: "done"`, verdict "cracked" and no clues; typed gives "done", verdict "none" and `visited: true`; at midnight on 25 December with no guess, "closed" with the outcome; at midnight on 1 January, "closed" with `outcome: null`; the practice run gives `practice: true`, door 0. The page (fixture `goView()`: Twinkle, door 7, Corner Bakehouse, Snowford): "go" has exactly one `.elf-clue`, `a[href="/elf/hq/door/7?clues=2"]` reading "Show me the next clue", `form[method="post"][action="/elf/hq/door/7/go"]` with `input[name="text"][maxlength="80"]`, "You get one guess at this door.", the button "Lock in my guess" and "The hiding place closes at 8pm today.", never "Corner Bakehouse" anywhere and a `<title>` starting "Door 7"; "done" and cracked says "You cracked it! Twinkle was hiding at Corner Bakehouse, Snowford." with no form; wrong says "Not this time. Twinkle was hiding at Corner Bakehouse, Snowford."; still hiding, gone home and visited each say their line; "closed" says "Having a go closed on Christmas Day." with no form. `PAGES` gain "Elf Detective School: having a go at a door" and "…: how a go went" in the chrome test, and "go page, having a go", "go page, cracked", "go page, closed" in the house rules test.
- [ ] **Step 2: Write the failing route tests** (the clock at 7:05pm on 7 December 2026, door 7 as Task 5's): `GET /elf/hq/door/7` is 200 `no-store` with one clue, and `?clues=3` three; door 8 is 303 to `/elf/hq`; a snowed in door 7 is 303; signed out is 303 to `/elf/sign-in`. `POST /elf/hq/door/7/go` JSON `{ text: "the example bakehouse" }` calls `saveLateGuess(2026, 7, <family>, { text: "the example bakehouse", norm: "examplebakehouse" }, now)` and answers 200 `{ cracked: true, message: "You cracked it! Wigglepop was hiding at The Example Bakehouse, Exampleton." }`; `saveLateGuess` answering "already" is 409 "already"; a family with a night guess is 409 "already" and `saveLateGuess` is never called; a typed family is 409 "been-there"; at midnight on 25 December it is 409 "closed"; `{ text: "" }` is 400 "empty"; the plain form's go is 303 to `/elf/hq/door/7`; a throw in `familyKnowledge` is 500 with the game's words.
- [ ] **Step 3: Run them.** `npx vitest run test/unit/elf-views.test.ts test/unit/elf-page-go.test.ts test/unit/elf-routes-catch-up.test.ts test/unit/site-chrome-everywhere.test.ts test/unit/elf-pages-house-rules.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** (CSS: `.elf-go`, `.elf-go__found`, `.elf-go__next`, `.elf-go__one`, `.elf-go__verdict`, on a taped note like today's case; nothing scrolls inside a box).
- [ ] **Step 5: Run them again.** Expected: PASS.
- [ ] **Step 6: Write the BDD**, a new scenario in `features/elf-game.feature`, "A practice evening: having a go once the place is shown, one guess only": a preview link; a practice evening at "The Example Office" in "Snowford", 1 minute apart; two families enrolled and paid, each with the preview link; `When the practice door's place is shown with its elf still hiding`; the first family opens `/elf/hq/door/0` (200, 1 clue, "You get one guess at this door."), then `/elf/hq/door/0?clues=3` (3 clues); `When the family "first.game.elf.bdd@example.com" has a go at the practice door with "the example office" from two tabs at once`, `Then one go was taken and the other refused, and the go says "You cracked it!"`; the first family opens `/elf/hq/door/0` and the page says "The Example Office, Snowford" and holds 0 clues; the second family has a go with "the example cafe" (200) and `the go says "Not this time."`; it has a go with "the example office" and the game answers 409 with the reason "already". New steps: "the practice door's place is shown with its elf still hiding" (`UPDATE elf_practice SET clue1_at = now() - interval '3 hours', clue2_at = now() - interval '170 minutes', clue3_at = now() - interval '160 minutes', reveal_at = now() - interval '150 minutes'`, so the practice door's closing, an hour after its reveal, has passed with nobody found); "the family {string} has a go at the practice door with {string}" (JSON to `/elf/hq/door/0/go`); "… from two tabs at once" (two such posts together, `Promise.all`); "one go was taken and the other refused, and the go says {string}" (statuses `[200, 409]`, the 409's reason "already", the 200's message holding the words); "the go says {string}".
- [ ] **Step 7: Lint, check types, and commit** `feat(elf): having a go at a missed door, one guess, in Detective HQ`.
- [ ] **Step 8 (the controller, after review):** render the go page in each stage on pretend data at 390 and 360 pixels for Jaimie.

### Task 7: Detective HQ catches up

**Files:**
- Modify: `src/elf/pages/types.ts` (`TodayView`, `HqView`, `WardrobeView`), `src/elf/views.ts` (`todayOf`, `hqViewFor`, `wardrobeViewFor`), `src/elf/pages/hq.ts`, `src/elf/pages/wardrobe.ts` (`lockNote`), `src/routes/elf.ts` (`hqViewOf`, `guessesFor` becomes `knowledgeFor`, `postGuess`, `wordsForGuessRefusal`), `assets/js/elf-hq.js`, `assets/css/elf.css`, `test/unit/elf-fixtures.ts`, `features/elf-game.feature`, `features/steps/elf-game.steps.js`
- Test: `test/unit/elf-views.test.ts`, `test/unit/elf-page-hq.test.ts`, `test/unit/elf-page-wardrobe.test.ts`, `test/unit/elf-routes-catch-up.test.ts`, `test/unit/elf-js-hq.test.ts`, `test/unit/elf-pages-house-rules.test.ts`

**Interfaces:**
- Consumes: Task 1's rules, Task 2's `familyKnowledge`, Task 6's go page address.
- Produces:
  - `TodayView` gains `goUrl: string | null` (the go page, when `mayHaveAGo`) and `closesAt: Date | null` (`closingShown`); its `outcome` is set only when the family can see the place (`knowsPlace`). The comments on `revealFor` (`src/elf/views.ts`) and on `TodayView.revealAt` stop saying a family is never told how late a place is open: answer 5 replaces that rule, through `closesAt`.
  - `HqView` gains `toCrack: { door: Door; elfName: string; clueAt: Date; url: string }[]` from `doorsToCrack` (real doors only; empty with December's doors off).
  - `hqViewFor` gains `typed: ReadonlySet<number>`.
  - In the routes, `knowledgeFor(res, runs: FamilyRuns, familyId: number): Promise<FamilyKnowledge>` replaces `guessesFor`: this year's while December's doors are on, with door 0's merged in while a practice runs for this browser.
  - `postGuess` gives `decideGuess` the open real doors this family knows as `openPlaces`, and its `hasGuess` and `mayHaveAGo`. "locked-in" and "have-a-go" answer 409 JSON `{ reason, message, goUrl }` (`goUrl` is `/elf/hq` for "locked-in" and the go page for "have-a-go"), and the plain form 303 to `goUrl`.
  - `wordsForGuessRefusal`: "not-hunting" `There is nothing to guess at this door just now.` (in place of "Too late: the hiding place is shown now. Have a look at the calendar."); "locked-in" `Your guess is locked in, and the hiding place is shown now.`; "have-a-go" `The hiding place is shown now, so this is your one go at this door.`
  - `elf-hq.js`: an answer carrying `goUrl` (a string starting with one `/`) goes there through `opts.go`, which defaults to `win.location.assign`.
  - `WardrobeView` gains `doorsOn: boolean` (from the settings); a costume locked behind a missed door has the note `Crack it in Detective HQ to catch up` while it is true, and `Visit the place to catch up` as now while it is false.

Words, exactly, in Detective HQ:
- Today's case once open, for a family that may have a go, in place of the outcome (its heading stays: Case closed, or `${elf} is still out there`): `You did not lock in a guess in time, but you can still crack this case, with one guess.` and the button `Have a go` (`elf-btn elf-btn--crimson`, to `goUrl`).
- Under the clue ladder while `closesAt` is set: `The hiding place closes at ${time} today.`
- Under the outcome while `closesAt` is set: `${place} closes at ${time} today.`
- After today's case, only while `toCrack` is not empty: the heading strip `Doors you can still crack` (gold), `Missed a door? Crack its case here, with one guess. You get the same three clues, one at a time.`, and for each door `Door ${n}`, its day (`dayWords(clueAt)`), its elf and the button `Have a go`.

- [ ] **Step 1: Write the failing view and page tests.** `hqViewFor` at 7:05pm on 7 December 2026 with door 7 found and open: a family with no guess and no visit has `today.outcome: null`, `today.goUrl: "/elf/hq/door/7"` and `today.closesAt` 8pm (closing typed "20:00"); with a night guess `outcome` is set and `goUrl` null; typed, `outcome` is set; doors 3 and 5 open and unguessed give `toCrack` doors `[5, 3]`; with `doorsOn: false` `toCrack` is empty and the page holds none of "Doors you can still crack", "Have a go" or "closes at". The page: the have a go card holds `a[href="/elf/hq/door/7"]` reading "Have a go" and its line, and not "You did not lock in a guess for this one."; a hunt with `closesAt` says "The hiding place closes at 8pm today."; an outcome with `closesAt` says "Corner Bakehouse closes at 8pm today."; the list draws each door's number, day, elf and link, and is absent when empty. The wardrobe's note for a costume behind a missed door is "Crack it in Detective HQ to catch up" with `doorsOn: true` and "Visit the place to catch up" with `doorsOn: false`. The house rules test adds "HQ, have a go at today's door" and "HQ, doors you can still crack". Tests that pinned "Too late" move to the new words.
- [ ] **Step 2: Write the failing route and script tests.** At 7:05pm on 7 December, `POST /api/elf/guess` for door 7 from a family with a guess is 409 `{ reason: "locked-in", goUrl: "/elf/hq" }` and `saveGuess` is not called; from one without, 409 "have-a-go" with `goUrl: "/elf/hq/door/7"`; the plain form's "locked-in" is 303 to `/elf/hq`. At 5:47pm with door 7 hunting and door 3 open: "The Old Example Mill" (door 3's place) from a family that has not guessed door 3 is 200 and saved; from one that guessed it, 400 "place-already-open" with `door: 3`. A shut door is 400 "There is nothing to guess at this door just now." In jsdom, a 409 answer with `goUrl: "/elf/hq/door/7"` calls `opts.go("/elf/hq/door/7")`; a 400 with no `goUrl` shows its message with `is-error`.
- [ ] **Step 3: Run them.** `npx vitest run test/unit/elf-views.test.ts test/unit/elf-page-hq.test.ts test/unit/elf-routes-catch-up.test.ts test/unit/elf-js-hq.test.ts test/unit/elf-pages-house-rules.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** (CSS: `.elf-crack`, `.elf-crack__door`, `.elf-ladder__closes`).
- [ ] **Step 5: Run them again.** Expected: PASS.
- [ ] **Step 6: Extend the BDD.** In Task 6's scenario, before the first family's go: it opens `/elf/hq` and the page says "Have a go"; it guesses "the example office" for the practice door and the game answers 409 with the reason "have-a-go". After its go: it opens `/elf/hq` and the page says "You cracked it!". After the second family's go: it guesses "anywhere" for the practice door and the game answers 409 with the reason "locked-in". In the scenario played in last year's December, the first family's guess for door 7 now answers `409 with the reason "locked-in"` (it was 400 "not-hunting").
- [ ] **Step 7: Lint, check types, and commit** `feat(elf): Detective HQ offers a go, lists the doors still to crack and says when the place closes`.
- [ ] **Step 8 (the controller, after review):** render Detective HQ with a go on today's door and the list of doors at 390 and 360 pixels for Jaimie.

### Task 8: The calendar's script lays on the family's own places

**Files:**
- Modify: `assets/js/elf-calendar.js`, `src/elf/pages/calendar.ts` (the board gains `data-me-door="/api/elf/me/door/"`)
- Test: `test/unit/elf-js-calendar.test.ts` (extend), `test/unit/elf-page-calendar.test.ts`

**Interfaces:**
- Consumes: `/api/elf/me`'s `known` and `goes`, and `GET /api/elf/me/door/:n` (Task 5); the shared door's `.elf-book__go` line (Task 4).
- Produces: `initCalendar` as now, with three changes:
  - Once `/api/elf/me` has answered, each door in `known` is drawn again from `data-me-door` + its number; an answer that fails or is 404 leaves the shared door as it was.
  - A door drawn from the family's own answer keeps the shared calendar's fingerprint in `data-v` (the one on the door it replaced, or the feed's newer one), so the poll still compares against the shared calendar. Every later redraw of a door in `known` (the feed saying it has changed, or the family taking its photo down) comes from the family's own route too.
  - On a door in `goes` the family's own line (`.elf-detail__mine`) stays hidden and the shared **Have a go** line stays shown.

- [ ] **Step 1: Write the failing jsdom tests** against the real page: with `/api/elf/me` answering `known: [7]` the script fetches `/api/elf/me/door/7` and never `/api/elf/door/7`, door 7's detail then holds "Corner Bakehouse", and door 7's `data-v` is still the page's; a poll whose feed gives door 7 a new `v` fetches `/api/elf/me/door/7` again and puts the new `v` in `data-v`; a poll with the same `v` fetches nothing; taking the family's photo down on door 7 redraws it from `/api/elf/me/door/7`; a 404 from the family's route leaves door 7 as served; with `goes: [5]`, door 5's `.elf-detail__mine` is hidden and its `.elf-book__go` is not; an answer with neither `known` nor `goes` (the doors off) behaves exactly as now. The calendar page test checks the board's `data-me-door`.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/elf-js-calendar.test.ts test/unit/elf-page-calendar.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): the calendar's script lays each family's own places over the shared doors`.

### Task 9: The clue email, yesterday's post and the rules

**Files:**
- Modify: `src/elf/emails.ts` (`buildElfClueEmail`), `src/elf/posts.ts` (`yesterdayPost`), `src/elf/worker.ts` (`clueEmails`, `morningEmail`), `src/email/catalogue.ts` (the clue and morning samples), `src/elf/pages/rules.ts`
- Test: `test/unit/elf-emails.test.ts`, `test/unit/elf-posts.test.ts`, `test/unit/elf-worker.test.ts`, `test/unit/email-catalogue-guard.test.ts` (keeps passing), `test/unit/elf-page-rules.test.ts`

**Interfaces:**
- Consumes: `closingShown` (Task 1); `whenWords` (`src/elf/posts.ts`).
- Produces:
  - `buildElfClueEmail` gains `closesAt: Date | null` (the worker passes `closingShown(run, t.at)`); the sentence `The hiding place is shown at ${revealAt}.` goes.
  - `yesterdayPost(o: { door: Door; elfName: string; state: DoorState; finders: DetectiveNameParts[]; foundAt: Date | null }): string | null`: the place is no longer passed, and it is null unless the door is open.
  - The rules page's two sentences, only while December's doors are on.

Words, exactly (`${when}` is "tonight's" when clue 1 is after midday and "today's" otherwise):
- The clue email, after the clue: `Clue 2 comes out at ${clue2} and clue 3 at ${clue3}, in Detective HQ.`; with `closesAt`: `The hiding place closes at ${closes} today.`; then `You find out whether you cracked it at ${revealAt}, or later if the elf is still hiding then.` (when `closesAt` is not after `revealAt`: `You find out whether you cracked it at ${revealAt}.`); then `If you miss ${when} hunt, you can still crack this case later in Detective HQ, with one guess.` The rest of the email is unchanged.
- Yesterday's post, found: `Door ${n} is open! ${by} found ${elf} at ${time}. Missed it? You can still crack the case in Detective HQ, with one guess.`; shown with nobody found: `Door ${n} is open! Nobody has found ${elf} yet, so the first detective to find it still wins the prize. Missed it? You can still crack the case in Detective HQ, with one guess.`
- The rules, How the hunt works, after the guess line: `Missed a door on the night? You can still crack its case later in Detective HQ, with one guess.` The rules, The grand prize, in place of `Joined late? Visit the places from before you joined to do their doors.`: `Missed a door, or joined late? You can still crack its case later in Detective HQ, with one guess.` With the doors off, both parts stay exactly as now.

- [ ] **Step 1: Write the failing tests.** The clue email for a 5:30pm clue with clues at 6pm and 6:30pm, shown at 7pm and closing at 8pm contains, in html and text, "Clue 2 comes out at 6pm and clue 3 at 6:30pm, in Detective HQ.", "The hiding place closes at 8pm today.", "You find out whether you cracked it at 7pm, or later if the elf is still hiding then." and "If you miss tonight's hunt, you can still crack this case later in Detective HQ, with one guess.", and never "is shown at"; a 10am clue says "today's hunt" and never "tonight"; `closesAt: null` has no "closes at"; closing at 11:30am with the place shown at 11:30am says "You find out whether you cracked it at 11:30am.". `yesterdayPost` gives each sentence exactly and is null for "found-hidden" and "snow". The worker builds door 7's clue email with `closesAt` 8pm when its closing time is "20:00" and null when it has none. The catalogue guard passes and the clue sample holds "closes at". The rules with the doors on hold both new sentences and not "Joined late? Visit the places"; with them off they hold "Joined late? Visit the places from before you joined to do their doors." and not "with one guess".
- [ ] **Step 2: Run them.** `npx vitest run test/unit/elf-emails.test.ts test/unit/elf-posts.test.ts test/unit/elf-worker.test.ts test/unit/email-catalogue-guard.test.ts test/unit/elf-page-rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): the clue email says when you find out and that a missed door can be cracked later; yesterday's post names no place`.

### Task 10: The words for Jaimie, and the README

**Files:**
- Modify: `docs/superpowers/specs/2026-11-10-elf-wave-2-words.md`, `README.md`

- [ ] **Step 1: Update the words file.** Add a part "Catching up on missed doors (Plan 2c-1)" with every sentence from Tasks 4, 6, 7 and 9, grouped by where it appears (the calendar for everyone else, the having a go page, Detective HQ, the refusals, the clue email, yesterday's post, the rules), each with a tick box and in the file's own invented examples (door 7, Bauble, Corner Bakehouse, Snowford, Detective R. Tinselfoot). In the existing parts, strike through each sentence this plan replaces ("Too late: …", the status and scrapbook lines that named a place, the clue email's "The hiding place is shown at", yesterday's post with its place, the rules' "Joined late? …") and point to the new part; mark question 9 as answered by planner's call 9. Keep the line at the top: December's doors are not switched on until every box is ticked.
- [ ] **Step 2: Update README.md**: the route table (`GET /api/elf/me` with `known` and `goes` while the doors are on; `GET /api/elf/me/door/:n`; `GET /elf/hq/door/:n` and `POST /elf/hq/door/:n/go`; the photo route now private, for families who can see the place, and for everyone from Christmas Day to 1 January), and a section "Catching up on missed doors (Plan 2c-1)" under Elf Detective School: the one rule; the shared calendar with no place, its Have a go line, and a family's own doors laid over it by the script; having a go and its one guess kept by the database (`elf_guesses.late`, migration 470); a go counted everywhere a night crack is but Finds; a visit done for every detective in the family, the gold seal still each detective's own; places and photos public from Christmas Day until 1 January and having a go closed then; the closing time with the clues; the emails' new words; the practice door; and the BDD's next year, last year and practice rule.
- [ ] **Step 3: Run the whole suite** with `npm run test:unit`, and report by name any failure other than perf-budget, footer-master and a lone timeout under load.
- [ ] **Step 4: Commit** `docs(elf): the words for Jaimie and the README for catching up on missed doors`.
