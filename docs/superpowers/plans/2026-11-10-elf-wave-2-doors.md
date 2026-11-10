# Elf Detective School wave 2, Plan 1: the Doors page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Head elves can set up all 24 doors in Head Elf HQ > Doors: type in each place and prize, name each elf and its tag word, paste in every clue at once, see what each door still needs, and print the poster, the staff card, the tag and the list of places.

**Architecture:** Three new tables (`elf_doors`, `elf_door_names`, `elf_clues`) and a `place_phone` setting, read and written only through `src/db/elf-doors.ts`. The rules are pure modules in `src/elf/` (evening times, readiness, codes, place names, the clue paste, the prints). JSON and print routes live in a new `src/routes/admin-elf-doors.ts` behind the elf permission, and a Doors tile joins `assets/js/admin/elf-hq.js`, matching the agreed mockup. Nothing in this plan reaches families: Plan 2 builds the game, and adds clue pictures, Snow day and Gone home to the door's sheet.

**Tech Stack:** TypeScript on Express, Postgres with node-pg-migrate, zod, Vitest (jsdom for the admin script), Cucumber BDD (CI only).

**Spec:** `docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md`, approved by Jaimie on 10 November 2026. This plan covers "Before December: getting a door ready", "Head Elf HQ: Doors", "Words on paper", decisions 4 to 7, and calls C1 and C10. The mockup to match is `.superpowers/sdd/2026-11-10-elf-wave-2/mockups/doors-admin.html` (not in git; its pictures sit beside it).

## Global Constraints

- The repository is public. Invented names only; 01632 960 123 for any phone number; `@example.org` or `@example.com` for any email. Never a real place, clue or prize in code, tests, fixtures, commit messages or pull request text. No folder on this computer named in a committed file.
- "Elf Detective School" always in full when it means the game; never "the school".
- Plain English with no dashes in any words a person reads: screens, prints and error sentences.
- Every admin route: `res.setHeader("Cache-Control", "no-store")`, then `authorizeSection(req, res, "elf", "view" | "edit")` from `src/routes/admin-authz.ts`, then a try/catch whose catch logs `console.error("admin elf doors … failed:", err instanceof Error ? err.message : err)` and answers 500 `{ error: "Admin is temporarily unavailable" }`. Every error answer is `{ error: "<a sentence>" }`. The audit actor is `actorOf(claims)` from `src/routes/admin.ts`.
- A write and its audit_log row share one transaction through `writeWithAudit` (`src/db/donations.ts:86`), as `audited()` in `src/db/elf-admin.ts:196-207` does. Audit records name the fields changed, never their values, because the values name secret places.
- Head Elf HQ's CSS house rules (top of `assets/css/admin-elf-hq.css`, enforced by `test/unit/admin-elf-hq-css.test.ts`): every selector starts `.hq-` or `#view-elf`; no `!important`; nothing scrolls inside a box; motion only inside `@media (prefers-reduced-motion: no-preference)` and only transform and opacity; no `#000`. Status words use `is-ok` and `is-error`, never `.err`. The admin script builds the page with `el()`, text only, never `innerHTML`.
- Every screen works at 390 and 360 pixels wide with no sideways scroll, and words never break in the middle.
- Clue words: at most 500 characters. Times are Europe/London; a clue time is an "HH:MM" string on its door's own day.
- Migrations only add. This plan's migration is `migrations/1791200000420_elf-doors.js`. Before the pull request, check it still sorts after the newest migration on main (`git fetch && git ls-tree --name-only origin/main migrations/ | sort | tail -3`) and renumber it if not.
- Tests first. Unit tests touch no database: mock `src/db/*` and `src/db/pool` as `test/unit/admin-elf.test.ts` does. The SQL is proved by BDD, which runs only in CI (there is no local database).
- Locally, `perf-budget` and `footer-master` fail because of Windows line endings; those two are not real failures. Run `npm run lint` and `npx tsc --noEmit` before each commit.
- Commit only the files the task names (`git add <paths>`), never `.mcp.json`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- README.md is updated in Task 10, the task that finishes what a head elf can do.

## Review Focus

1. A head elf with `elf: view` can open every Doors screen and print, but every write route answers 403 (Task 6, "every write handler refuses elf view").
2. A pasted clue file with Windows line endings, a byte order mark, or "DOOR 7" in capitals parses exactly like the plain file (Task 3).
3. Once a door's clue 1 is out, its times, its tag word, its clues and the removal of its other names are refused with 409, while its place details, its prize, new names and the ticks still save (Task 6, with the clock at 5:31pm on 7 December 2026).
4. The prints are secret pages: elf view only; `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`; a door missing what a print needs gets a page saying what to add, never a 500 (Task 7).
5. An 80 character place name and a 200 character prize stay whole inside their tile and sheet at 360 pixels without words breaking (Task 8's jsdom test that the tile carries the whole name, and the controller's measured check in the stand-in).

---

### Task 1: The tables

**Files:**
- Create: `migrations/1791200000420_elf-doors.js`
- Test: `test/unit/elf-admin-migrations.test.ts` (add a `describe` for 420, using the file's pretend `pgm` pattern)

**Interfaces:**
- Produces: tables `elf_doors`, `elf_door_names`, `elf_clues`; the column `elf_settings.place_phone`.

Columns:
- `elf_doors`: `year integer NOT NULL`; `door integer NOT NULL CHECK (door BETWEEN 1 AND 24)`; primary key `(year, door)`; text columns `place_name`, `place_town`, `place_address`, `contact_name`, `contact_phone`, `contact_email`, `elf_spot`, `agreed_by`, `prize`, `elf_name`, `tag_word`, `dropped_off_by`, `thanked_by`, `updated_by`; `prize_show_off boolean NOT NULL DEFAULT false`; clock columns `closes_at`, `clue1_time`, `clue2_time`, `clue3_time`, `reveal_time`, each `text` with `CHECK (<column> IS NULL OR <column> ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`; `poster_code text NOT NULL UNIQUE`; `tag_printed_at`, `dropped_off_at`, `thanked_at` as `timestamptz`; `updated_at timestamptz NOT NULL DEFAULT now()`.
- `elf_door_names`: `id serial PRIMARY KEY`; `year integer NOT NULL`; `door integer NOT NULL`; `name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80)`; `added_at timestamptz NOT NULL DEFAULT now()`; `added_by text`; foreign key `(year, door)` to `elf_doors` `ON DELETE CASCADE`.
- `elf_clues`: `year integer NOT NULL`; `door integer NOT NULL`; `n integer NOT NULL CHECK (n BETWEEN 1 AND 3)`; `words text NOT NULL CHECK (char_length(words) BETWEEN 1 AND 500)`; `updated_at timestamptz NOT NULL DEFAULT now()`; `updated_by text`; primary key `(year, door, n)`; foreign key `(year, door)` to `elf_doors` `ON DELETE CASCADE`.
- `elf_settings.place_phone text CHECK (place_phone IS NULL OR char_length(place_phone) <= 40)`.

The file's opening comment names the design, says these rows name the secret hiding places (for staff only, never on a public page or in an export), and ends "Additive: three new tables and one empty column."

- [ ] **Step 1: Write the failing test.** `up` creates the three tables with exactly the columns above (assert each table's column names, `poster_code` unique, both foreign keys with `onDelete: "CASCADE"`) and adds `place_phone`; `down` drops `elf_clues`, `elf_door_names` and `elf_doors` in that order and drops `place_phone`; the file sorts last in `migrations/`.
- [ ] **Step 2: Run it.** `npx vitest run test/unit/elf-admin-migrations.test.ts`. Expected: FAIL, the migration file is missing.
- [ ] **Step 3: Write the migration** in the style of `migrations/1791200000310_elf-school.js` (`pgm.createTable(name, columns, { comment })`, checks inline).
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): tables for the 24 doors, their names that count and their clues`.

### Task 2: A door's evening and what it still needs

**Files:**
- Modify: `src/elf/calendar.ts` (add at the end)
- Create: `src/elf/door-setup.ts`
- Test: `test/unit/elf-calendar.test.ts` (extend), `test/unit/elf-door-setup.test.ts`

**Interfaces:**
- Consumes: `ElfSeason`, `Door`, `clueTimeFor`, `DEFAULT_CLOSING_TIME`, `DEFAULT_SCHOOL_CLUE_TIME`, `DEFAULT_MORNING_CLUE_TIME` (calendar.ts); `isUsableSecretWord` (claim.ts).
- Produces, in `calendar.ts`:
  - `interface StaffEvening { clue1?: string | null; clue2?: string | null; clue3?: string | null; reveal?: string | null }`
  - `type EveningProblem = "clue2-not-after-clue1" | "clue3-not-after-clue2" | "reveal-not-after-clue3" | "past-midnight"`
  - `interface Evening { clue1: string; clue2: string; clue3: string; reveal: string; problems: EveningProblem[] }`
  - `function eveningFor(season: ElfSeason, door: Door, staff: StaffEvening): Evening`. Clue 1 is `clueTimeFor(season, door, staff.clue1)`. Each later time is the staff's when it is a real clock time, otherwise 30 minutes after the one before. A default that would pass 23:59 becomes "23:59" and adds "past-midnight" once. The three ordering problems are checked in order, each when a time is not after the one before it.
  - `const EVENING_PROBLEM_WORDS: Record<EveningProblem, string>` = `{ "clue2-not-after-clue1": "Clue 2 must come after clue 1.", "clue3-not-after-clue2": "Clue 3 must come after clue 2.", "reveal-not-after-clue3": "The place must be shown after clue 3.", "past-midnight": "Every time must be on the door's own day, before midnight." }`
  - `function closesTooSoon(closesAt: string | null, clue3: string): boolean`: true when the closing clock time (`DEFAULT_CLOSING_TIME` when null or not a real time) is less than 60 minutes after clue 3, both read as clock times on the same day.
- Produces, in `door-setup.ts`:
  - `interface DoorClue { n: 1 | 2 | 3; words: string | null }`
  - `interface DoorSetup { door: Door; placeName: string | null; placeTown: string | null; placeAddress: string | null; contactName: string | null; contactPhone: string | null; contactEmail: string | null; closesAt: string | null; elfSpot: string | null; agreedBy: string | null; prize: string | null; prizeShowOff: boolean; elfName: string | null; tagWord: string | null; tagPrintedAt: Date | null; clue1Time: string | null; clue2Time: string | null; clue3Time: string | null; revealTime: string | null; posterCode: string; droppedOffAt: Date | null; droppedOffBy: string | null; thankedAt: Date | null; thankedBy: string | null; names: { id: number; name: string }[]; clues: DoorClue[] }`. `clues` always holds n 1, 2 and 3 in order; `words` is null when there is none.
  - `function emptyDoor(door: Door, posterCode: string): DoorSetup`: every field empty, `prizeShowOff` false, no names, three empty clues.
  - `function doorSeason(year: number): ElfSeason`: `{ year, holidayDoors: [], schoolClueTime: DEFAULT_SCHOOL_CLUE_TIME, morningClueTime: DEFAULT_MORNING_CLUE_TIME }`.
  - `function staffEveningOf(d: DoorSetup): StaffEvening`: the door's four stored times.
  - `type ReadyKey = "place" | "prize" | "picture" | "elf" | "clues" | "droppedOff"`
  - `const READY_WORDS: Record<ReadyKey, string>`: place "The place", prize "The prize", picture "The door picture", elf "The elf and its tag", clues "The three clues", droppedOff "Dropped off", in that order.
  - `interface Readiness { items: { key: ReadyKey; done: boolean }[]; toDo: number; ready: boolean }`
  - `function readinessOf(d: DoorSetup, hasPicture: boolean): Readiness`. Place is done when its name, town and address are all non-blank; the prize when it is non-blank; the picture when `hasPicture`; the elf when its name is non-blank and `isUsableSecretWord(tagWord)`; the clues when all three have non-blank words; dropped off when `droppedOffAt` is set.
  - `function doorsSummary(rows: { setup: DoorSetup; hasPicture: boolean }[]): { placesAgreed: number; prizesChosen: number; ready: number }`
  - `function prizeListText(doors: Pick<DoorSetup, "door" | "prize">[]): string`: one line a door in door order, "Door 1: A wooden sledge" or "Door 2: No prize yet", joined with "\n".
  - `function doorWeekday(year: number, door: Door): string`: "Mon" to "Sun".
  - `const DOOR_PICTURES: Readonly<Record<string, string>> = {}` and `function doorPicture(year: number, door: Door, pictures: Readonly<Record<string, string>> = DOOR_PICTURES): string | null`, keyed `${year}-${door}`. Claude adds the 24 pictures once Jaimie's prize list is in.

- [ ] **Step 1: Write the failing calendar tests.**
```ts
const season = { year: 2026, holidayDoors: [], schoolClueTime: "17:30", morningClueTime: "10:00" };
expect(eveningFor(season, 7, {})).toEqual({ clue1: "17:30", clue2: "18:00", clue3: "18:30", reveal: "19:00", problems: [] }); // a Monday
expect(eveningFor(season, 5, {})).toMatchObject({ clue1: "10:00", clue2: "10:30", clue3: "11:00", reveal: "11:30" }); // a Saturday
expect(eveningFor(season, 7, { clue1: "17:00" })).toMatchObject({ clue2: "17:30", clue3: "18:00", reveal: "18:30" });
expect(eveningFor(season, 7, { clue2: "17:45" })).toMatchObject({ clue3: "18:15", reveal: "18:45", problems: [] });
expect(eveningFor(season, 7, { clue2: "17:00" }).problems).toEqual(["clue2-not-after-clue1"]);
expect(eveningFor(season, 7, { reveal: "18:30" }).problems).toEqual(["reveal-not-after-clue3"]);
expect(eveningFor(season, 7, { clue1: "23:40" }).problems).toContain("past-midnight");
expect(closesTooSoon("19:30", "18:30")).toBe(false);
expect(closesTooSoon("19:29", "18:30")).toBe(true);
expect(closesTooSoon(null, "18:30")).toBe(false);
expect(closesTooSoon("17:00", "18:30")).toBe(true);
```
- [ ] **Step 2: Write the failing door setup tests.** `readinessOf(emptyDoor(7, "abc"), false)` has `toDo: 6, ready: false`. A full invented door (place "Pine Cone Café", town "Ayr", address "1 Example Street", prize "A wooden sledge", elf "Twinkle", word "SNOWBALL 472", three clues, `droppedOffAt` set) is `{ toDo: 0, ready: true }` with `hasPicture` true, and `toDo: 1` with the picture item not done when false. No address leaves the place not done; the word "SNOWBALL" alone leaves the elf not done; a clue of three spaces leaves the clues not done. `prizeListText([{ door: 2, prize: null }, { door: 1, prize: "A wooden sledge" }])` is `"Door 1: A wooden sledge\nDoor 2: No prize yet"`. `doorWeekday(2026, 1)` is "Tue" and `doorWeekday(2026, 7)` is "Mon". `doorPicture(2026, 7)` is null and `doorPicture(2026, 7, { "2026-7": "/x.webp" })` is "/x.webp".
- [ ] **Step 3: Run them.** `npx vitest run test/unit/elf-calendar.test.ts test/unit/elf-door-setup.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** both, pure (no pool, no config, no clock).
- [ ] **Step 5: Run them again.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(elf): a door's evening times and what it still needs`.

### Task 3: Poster codes, tag words, place names and the clue paste

**Files:**
- Create: `src/elf/door-codes.ts`, `src/elf/place-names.ts`, `src/elf/clue-paste.ts`
- Test: `test/unit/elf-door-codes.test.ts`, `test/unit/elf-place-names.test.ts`, `test/unit/elf-clue-paste.test.ts`

**Interfaces:**
- Consumes: `secretWord` (`src/elf/names.ts`), `isUsableSecretWord` (claim.ts), `Door`, `isDoor` (calendar.ts).
- Produces:
  - `door-codes.ts`: `const POSTER_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"`; `function posterCode(bytes: Uint8Array): string` (12 characters, the i-th is `POSTER_ALPHABET[bytes[i] % 32]`; throws when given fewer than 12 bytes); `function makePosterCode(): string` (`posterCode(randomBytes(12))` from `node:crypto`); `function makeTagWord(): string` (`secretWord(() => randomInt(0, 1_000_000) / 1_000_000)`, tried up to 5 times, then it throws).
  - `place-names.ts`: `function normalisePlaceName(name: string): string`: NFKD, accents dropped, lower case, one leading word "the" dropped, everything outside a to z and 0 to 9 removed. `function sameName(a: string, b: string): boolean`. Plan 2's typed guesses match with these (the secret places design's "Guess text" rule).
  - `clue-paste.ts`:
    - `type ClueN = 1 | 2 | 3`
    - `interface PastedDoor { door: Door; line: number; clues: { n: ClueN; words: string }[] }`
    - `type PasteProblemKind = "nothing" | "outside-door" | "bad-door" | "door-twice" | "bad-clue" | "clue-twice" | "missing-clue" | "empty-clue" | "too-long" | "clue-out"`
    - `interface PasteProblem { kind: PasteProblemKind; line: number | null; door: Door | null; message: string }`
    - `interface PasteResult { doors: PastedDoor[]; problems: PasteProblem[] }`
    - `const CLUE_WORDS_MAX = 500`
    - `const PASTE_EXAMPLE: string` (the format below, for the Doors page's help)
    - `function parseCluePaste(text: string): PasteResult`
    - `function pasteAgainstDoors(result: PasteResult, isOut: (door: Door, n: ClueN) => boolean): PasteProblem[]`: one "clue-out" problem for each pasted clue that is already out.

The paste format. Claude writes the private clue file to match it, and the Doors page shows it as help:
```
Door 7: anything after the number is a note for people and is ignored
Clue 1: the words of clue 1
Clue 2: the words of clue 2,
which can run on to more lines
Clue 3: the words of clue 3
```
Rules: a leading byte order mark is dropped; lines split on `\r?\n` and are trimmed; blank lines are skipped; a door line matches `/^door\s+(\d+)\b/i`; a clue line matches `/^clue\s+(\d+)\s*:\s*(.*)$/i`; any other line continues the clue before it, joined with "\n"; a clue's words are trimmed and counted after trimming; doors can come in any order and need not be all 24; each door must have clues 1, 2 and 3 exactly once.

Messages, exactly:
- nothing: `There are no doors in this text.`
- outside-door: `Line ${line}: this comes before any Door line, so it belongs to no door.`
- bad-door: `Line ${line}: there is no door ${n}. Doors go from 1 to 24.`
- door-twice: `Door ${door} is in the text twice.`
- bad-clue: `Line ${line}: a door has clues 1, 2 and 3 only.`
- clue-twice: `Door ${door} has clue ${n} twice.`
- missing-clue: `Door ${door} is missing clue ${n}.`
- empty-clue: `Door ${door}, clue ${n} has no words.`
- too-long: `Door ${door}, clue ${n} is ${length} characters long. The most is 500.`
- clue-out: `Door ${door}, clue ${n} is already out, so it cannot be changed.`

- [ ] **Step 1: Write the failing code tests.** `posterCode(new Uint8Array(12))` is "aaaaaaaaaaaa"; `posterCode(Uint8Array.from([0,1,2,3,4,5,6,7,8,9,10,11]))` is "abcdefghijkm"; 11 bytes throws; 50 `makePosterCode()` results match `/^[a-km-np-z2-9]{12}$/` and `renderElfPoster` accepts `https://nbcc.scot/elf/p/${code}` for each; 50 `makeTagWord()` results pass `isUsableSecretWord`.
- [ ] **Step 2: Write the failing place name tests.** `sameName("The Corner Bakehouse", "corner-bakehouse")` is true; `normalisePlaceName("Café Rouge")` is "caferouge"; `normalisePlaceName("Theatre Royal")` is "theatreroyal"; `normalisePlaceName("  THE  Bakehouse!! ")` is "bakehouse".
- [ ] **Step 3: Write the failing paste tests**, with invented words: a good text for doors 7 and 8 gives two doors, six clues, no problems, and door 7's clue 1 words exactly; the same text with `\r\n` line endings and a leading `﻿` gives an equal result; "DOOR 7: Pine Cone Café" is door 7; a continuation line joins with "\n"; one test for each message above, asserting the exact sentence and line; 500 characters passes and 501 is "too-long"; `pasteAgainstDoors` with `isOut` true only for door 7 clue 1 gives exactly one "clue-out" problem.
- [ ] **Step 4: Run them.** `npx vitest run test/unit/elf-door-codes.test.ts test/unit/elf-place-names.test.ts test/unit/elf-clue-paste.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement** the three modules, pure apart from `node:crypto` in `makePosterCode` and `makeTagWord`.
- [ ] **Step 6: Run them again.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(elf): poster codes, tag words, place names and the clue paste`.

### Task 4: The prints say the elf stays, and the list of places

**Files:**
- Modify: `src/elf/print.ts`
- Test: `test/unit/elf-print.test.ts` (extend; change only the tests the new words replace)

**Interfaces:**
- Produces: `interface PlacesListRow { door: Door; clueAt: Date; placeName: string | null; placeTown: string | null; placeAddress: string | null; contactName: string | null; contactPhone: string | null }` and `function renderPlacesList(year: number, rows: PlacesListRow[]): string`. It is a whole print page through `shell()`, A4 portrait, titled `Elf Detective School: the hiding places for December ${year}`, with the toolbar `<span>The hiding places. For staff only: it names every place and its day.</span>`. It has one entry a door in door order: the number, `longDayWords(clueAt)`, "First clue at " followed by `clockWords(clueAt)`, the place and town, the address, who to talk to and their phone. A door with no place says "No place yet". Everything is escaped.

The new words, exactly (Jaimie approves every word before December's doors go on):
- Staff card, the day box: `Your elf is ${elf}. Your day is ${longDay}: door ${n}.` then `The first clue comes out at ${time}. Please put ${elf} and the poster out together then, with ${elf} wearing its tag. Until then, keep them both out of sight.`
- Staff card, under "Keep it a secret": `Please do not tell anyone which day is yours.`
- Staff card, step 3: `Then give them the prize. ${elf} stays here with the poster for the rest of December. Thank you!`
- Staff card, under "If a screen says too many wrong words": `Someone has mistyped the word six times. Please phone NBCC and we will sort it out.`
- Staff card, under "After that": `Families will keep calling in all December to find ${elf}. They scan the poster and type the word on the tag themselves: there is nothing you need to do.`
- Poster, the middle line: `Here for a candy cane? Once this place's door has opened, scan and type the word on the elf's tag, then add your picture to the door.`
- Tag, the last line: `The first detective to type it wins this door's prize. Everyone after gets a candy cane stamp.`
- The comment at the top of the file: the poster goes up with the elf at the first clue, and both stay out for the rest of December.

- [ ] **Step 1: Write the failing tests.** The staff card for elf "Twinkle", door 7, clue at 5:30pm on 7 December 2026 contains each new sentence and no longer contains "hand over", "stays up all month" or "Someone holding". The poster contains "then add your picture to the door" and no longer contains "check in". The tag contains "wins this door's prize" and no longer contains "wins me". `renderPlacesList(2026, rows)` contains "For staff only", "No place yet" for an empty row and "First clue at 5:30pm" for door 7, and escapes `<b>` in a place name.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/elf-print.test.ts`. Expected: FAIL.
- [ ] **Step 3: Change the words and add `renderPlacesList`** beside the other renderers, reusing `BASE_CSS`, `band` and `statement`.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): staff card, poster and tag say the elf stays; the list of places`.

### Task 5: The doors data layer

**Files:**
- Create: `src/db/elf-doors.ts`
- Modify: `src/elf/settings.ts`, `src/db/elf.ts` (the `placePhone` setting)
- Test: `test/unit/elf-db-doors.test.ts`, `test/unit/elf-db-settings.test.ts` (extend)

**Interfaces:**
- Consumes: `DoorSetup`, `emptyDoor` (Task 2); `makePosterCode`, `makeTagWord`, `normalisePlaceName`, `PastedDoor`, `ClueN` (Task 3); `writeWithAudit`, `AuditInput` (`src/db/donations.ts`).
- Produces:
  - `type DoorChange = Partial<Pick<DoorSetup, "placeName" | "placeTown" | "placeAddress" | "contactName" | "contactPhone" | "contactEmail" | "closesAt" | "elfSpot" | "agreedBy" | "prize" | "prizeShowOff" | "elfName" | "clue1Time" | "clue2Time" | "clue3Time" | "revealTime">>`
  - `ensureElfDoors(year: number): Promise<void>`: inserts any of the 24 rows that are missing, each with `makePosterCode()` and `makeTagWord()`, `ON CONFLICT (year, door) DO NOTHING`; on a `23505` clash on `poster_code` it tries once more with new codes.
  - `listElfDoors(year: number): Promise<DoorSetup[]>`: the year's doors in door order, each with its names in id order and its three clues.
  - `getElfDoor(year: number, door: Door): Promise<DoorSetup | null>`
  - `changeElfDoor(year: number, door: Door, change: DoorChange, actor: string): Promise<DoorSetup | null>`: writes only the keys present, through a fixed map from each key to its column (as `SETTING_COLUMNS` in `src/db/elf.ts`), and sets `updated_at` and `updated_by`; audit `{ actor, action: "elf.door.change", entity: "elf_door", entityId: door, data: { year, fields: [the keys] } }`.
  - `addElfDoorName(year: number, door: Door, name: string, actor: string): Promise<DoorSetup | null | "taken">`: "taken" when `normalisePlaceName(name)` equals that of the place's name or one of its names, checked in the transaction with the door row locked `FOR UPDATE`.
  - `removeElfDoorName(year: number, door: Door, id: number, actor: string): Promise<DoorSetup | null>`
  - `setElfTagWord(year: number, door: Door, word: string, actor: string): Promise<DoorSetup | null>`: also clears `tag_printed_at`.
  - `markElfTagPrinted(year: number, door: Door, actor: string): Promise<void>`
  - `tickElfDoor(year: number, door: Door, which: "droppedOff" | "thanked", on: boolean, actor: string): Promise<DoorSetup | null>`: on sets the time and the actor; off clears both.
  - `saveElfClue(year: number, door: Door, n: ClueN, words: string | null, actor: string): Promise<DoorSetup | null>`: an upsert; null removes the clue.
  - `savePastedClues(year: number, doors: PastedDoor[], actor: string): Promise<{ doors: number; clues: number }>`: one transaction of `INSERT … ON CONFLICT (year, door, n) DO UPDATE`, and one audit `{ action: "elf.clues.paste", entity: "elf_door", entityId: null, data: { year, doors: [the door numbers] } }`.
  - `ElfSettings` gains `placePhone: string | null` (null in `ELF_DEFAULTS`), read from `place_phone` and written through `setElfSettings` (add it to `SETTING_COLUMNS`).
  A function given a door with no row answers null, through the `NotThere` pattern of `src/db/elf-admin.ts`.

- [ ] **Step 1: Write the failing tests**, with `pool` mocked as in `test/unit/elf-db-settings.test.ts`. `ensureElfDoors(2026)` sends one INSERT of 24 rows with `ON CONFLICT (year, door) DO NOTHING` and 24 different poster codes. `changeElfDoor(2026, 7, { placeName: "Pine Cone Café", nonsense: 1 } as any, "admin:staff@example.org")` writes `place_name` only and audits `fields: ["placeName"]` without the value. `listElfDoors` turns rows into `DoorSetup`s with names in id order and clues 1, 2 and 3 (a missing clue is `words: null`). `addElfDoorName` with "the pine cone cafe" for a door named "Pine Cone Café" answers "taken" and inserts nothing. `savePastedClues` runs BEGIN, the upserts, the audit and COMMIT, and rolls back when an upsert throws. `getElfSettings` reads `place_phone`.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/elf-db-doors.test.ts test/unit/elf-db-settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in the style of `src/db/elf-admin.ts` (`pool.query`, row mappers from snake_case to camelCase, `audited`).
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): the doors data layer`.

### Task 6: The doors routes

**Files:**
- Create: `src/routes/admin-elf-doors.ts`, `features/elf-admin-doors.feature`, `features/steps/elf-admin-doors.steps.js`
- Modify: `src/app.ts` (mount `adminElfDoorsRouter` straight after `adminElfRouter`), `src/routes/admin-elf.ts` (PATCH settings accepts `placePhone`)
- Test: `test/unit/admin-elf-doors.test.ts`, `test/unit/admin-elf.test.ts` (extend for `placePhone`)

**Interfaces:**
- Consumes: Task 2 (`eveningFor`, `EVENING_PROBLEM_WORDS`, `closesTooSoon`, `readinessOf`, `doorsSummary`, `prizeListText`, `doorWeekday`, `doorPicture`, `doorSeason`, `staffEveningOf`); Task 3 (`makeTagWord`, `parseCluePaste`, `pasteAgainstDoors`, `CLUE_WORDS_MAX`); Task 5 (all); `getElfSettings` (`src/db/elf.ts`); `doorInstant` (calendar.ts); `longDayWords` (words.ts); `config.PORTAL_BASE_URL`.
- Produces `export const adminElfDoorsRouter: Router` and these answers, which Tasks 8 to 10 draw:
  - `interface DoorTile { door: Door; weekday: string; placeName: string | null; ready: boolean; toDo: number }`
  - `interface DoorSheet extends DoorSetup { day: string; readiness: Readiness; evening: Evening; closesTooSoon: boolean; picture: string | null; posterUrl: string; clueOut: [boolean, boolean, boolean]; started: boolean }`. `day` is `longDayWords` of clue 1 ("Monday 7 December"); `started` is true once clue 1 is out; `posterUrl` is `PORTAL_BASE_URL` without a trailing slash followed by `/elf/p/${posterCode}`.
  - `GET /api/admin/elf/doors` (view): calls `ensureElfDoors` first, then answers `{ year, doors: DoorTile[], counts: { placesAgreed, prizesChosen, ready }, prizeList, canEdit }`.
  - `GET /api/admin/elf/doors/:door` (view): `{ door: DoorSheet, canEdit }`.
  - `PATCH /api/admin/elf/doors/:door` (edit): `{ door: DoorSheet }`.
  - `POST /api/admin/elf/doors/:door/names` (edit, `{ name }`): 201 `{ door }`. `DELETE /api/admin/elf/doors/:door/names/:id` (edit): `{ door }`.
  - `POST /api/admin/elf/doors/:door/word` (edit, `{ confirm?: boolean }`): `{ door }`.
  - `POST` and `DELETE` on `/api/admin/elf/doors/:door/dropped-off` and `/api/admin/elf/doors/:door/thanked` (edit): `{ door }`.
  - `PUT /api/admin/elf/doors/:door/clues/:n` (edit, `{ words: string | null }`): `{ door }`.
  - `POST /api/admin/elf/clues/check` (edit, `{ text }` of at most 60,000 characters): `{ doors: (PastedDoor & { placeName: string | null })[], problems: PasteProblem[] }`.
  - `POST /api/admin/elf/clues/save` (edit, `{ text }`): `{ doors: number, clues: number }`, or 400 `{ error: "Fix the problems in the text first.", problems }`.

Rules:
- `canEdit` is `can(perms, "elf", "edit")` on `loadEffectivePermissions(claims.sub)`, as `getAdminElfHq` works it out (`src/routes/admin-elf.ts:107,117`).
- `:door` must be a whole number from 1 to 24, otherwise 400 `{ error: "There is no door like that." }`; a door with no row is 404 `{ error: "There is no door ${n}." }`; `:id` must match `/^[1-9]\d{0,9}$/`; `:n` must be 1, 2 or 3. The year is `getElfSettings().year`; the season is `doorSeason(year)`.
- PATCH body: zod `.strict()`, with blank strings read as null. Limits: placeName 80, placeTown 60, placeAddress 200, contactName 80, contactPhone 40 (only digits, spaces and `+ ( ) -`, with at least 7 digits), contactEmail an email of at most 254, elfSpot 200, agreedBy 80, prize 200, elfName 30; `prizeShowOff` a boolean; `closesAt` and the four times a real "HH:MM" or null. After merging the change with the stored door, any `eveningFor` problem answers 400 with `EVENING_PROBLEM_WORDS` of the first.
- Once clue 1 is out (its `doorInstant` is not after now): changing any time answers 409 `{ error: "Door ${n}'s evening has started, so its times cannot change." }`; a new word answers 409 `{ error: "Door ${n}'s elf is out, so its word cannot change." }`; removing a name answers 409 `{ error: "Door ${n}'s evening has started, so names that count can only be added now." }`. Place details, the prize, adding names and the ticks still work.
- A clue that is out answers 409 with the "clue-out" sentence of Task 3; words over 500 characters answer 400 `{ error: "A clue can be up to 500 characters." }`.
- A new word when `tagPrintedAt` is set and `confirm` is not true answers 409 `{ error: "This door's tag has been printed. Make a new word only if you will print the tag again.", printed: true }`.
- A name that is "taken" answers 409 `{ error: "That name already counts for this door." }`.
- `placePhone` in PATCH `/api/admin/elf/settings` (admins only, like the rest of that route) follows the contact phone rule, or is null.

- [ ] **Step 1: Write the failing unit tests**, with the helpers of `test/unit/admin-elf.test.ts` (`tokenFor`, `mockRes`, `ask`), `vi.mock` of `src/db/elf-doors`, `src/db/elf`, `src/db/admin-users`, `src/db/pool` and `src/config`, and `vi.setSystemTime` for the clock:
  - no elf permission: 403 on `GET /doors`; `{ elf: "view" }`: 200 with 24 tiles, the counts and the prize list;
  - every write handler refuses elf view: one loop over the handlers, each 403, and no data function called;
  - PATCH with edit passes only the given keys to `changeElfDoor`; an unknown key is 400; door "25" is 400; `clue2Time` "17:00" with clue 1 at 17:30 is 400 "Clue 2 must come after clue 1.";
  - with the clock at 5:31pm on 7 December 2026: on door 7, PATCH `clue3Time` is 409, PATCH `placeName` is 200, a new word is 409, removing a name is 409 and PUT clue 1 is 409; on door 8 all of them succeed;
  - a new word with `tagPrintedAt` set is 409 with `printed: true`; with `confirm: true` it is 200 and `setElfTagWord` gets a usable word;
  - clues/check answers the parse problems; clues/save with a problem is 400 and `savePastedClues` is never called; a good text calls `savePastedClues` with the parsed doors;
  - PATCH settings with `placePhone: "01632 960 123"` as an admin is 200; `"call me"` is 400.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/admin-elf-doors.test.ts test/unit/admin-elf.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the handlers as exported functions in the style of `src/routes/admin-elf.ts`, register them at the bottom of the file, and mount the router.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Write the BDD**, tagged `@elf-school @admin @elf-doors`. A Before and an After hook delete the 2026 rows of `elf_doors` (their names and clues go with them). A head elf is "an admin user … with role "editor"" given `{"elf":"edit"}` through `UPDATE users SET permissions`, as `features/steps/red-bag-list.steps.js:86-88` does. Scenarios: the head elf sees 24 doors; sets door 7's place to "Pine Cone Café" in "Ayr" at "1 Example Street" and its prize, after which door 7's tile shows the place and "4 to do"; checks a text with door 25 and sees "Line 1: there is no door 25. Doors go from 1 to 24."; saves a good text for door 7 and door 7 shows its three clues; a head elf with `{"elf":"view"}` gets 403 changing door 7.
- [ ] **Step 6: Run `npm run lint` and `npx tsc --noEmit`, then commit** `feat(elf): the doors routes` (the BDD runs in CI).

### Task 7: The print routes

**Files:**
- Modify: `src/routes/admin-elf-doors.ts`, `features/elf-admin-doors.feature`, `features/steps/elf-admin-doors.steps.js`
- Test: `test/unit/admin-elf-doors-print.test.ts`

**Interfaces:**
- Consumes: `renderElfPoster`, `renderStaffCard`, `renderElfTag`, `renderPlacesList` (Task 4); `materialsMessagePage` (`src/fundraising/materials.ts:1122`); Task 5's `getElfDoor`, `listElfDoors`, `markElfTagPrinted`; `getElfSettings`; `eveningFor`, `doorInstant`.
- Produces: `GET /api/admin/elf/doors/:door/poster`, `GET /api/admin/elf/doors/:door/staff-card`, `GET /api/admin/elf/doors/:door/tag` and `GET /api/admin/elf/places-list`, all elf view, each answering a whole HTML page.

Rules:
- The gate runs first, so a refusal is the usual JSON 401 or 403. After it, every answer sets `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` (a local `privatePage(res)` like `src/routes/fundraise-materials.ts:77-81`) and goes out with `res.status(s).type("html").send(page)`.
- What each print needs. When something is missing, the answer is `materialsMessagePage("Not ready to print", <sentence>)` with status 409:
  - poster: the place's name and town: `Door ${n} needs its place's name and town before its poster can be printed.`
  - staff card: the place's name and the elf's name: `Door ${n} needs its place and its elf's name before its staff card can be printed.`; and the place phone setting: `Add NBCC's phone number for places in Settings before printing a staff card.`
  - tag: the elf's name and a usable word: `Door ${n} needs its elf's name before its tag can be printed.`
- The staff card's `clueAt` is the `doorInstant` of the door's evening clue 1; its `phone` is `placePhone`.
- The poster's `siteOrigin` is `PORTAL_BASE_URL` without a trailing slash. When `renderElfPoster` refuses it (not https, as in tests and on this computer), the answer is the message page `The poster can only be printed on the live site.` with status 409.
- Printing the tag calls `markElfTagPrinted` once the page is made.
- Anything else a renderer throws is a 500 message page, never a stack trace.

- [ ] **Step 1: Write the failing tests.** Each print with `{ elf: "view" }` answers 200 HTML with the three headers; no permission answers JSON 403 and renders nothing; door 7 with no place answers the poster's message page with status 409; the staff card without `placePhone` answers the Settings sentence; the tag print calls `markElfTagPrinted(2026, 7, "admin:staff@example.org")`; the poster with `PORTAL_BASE_URL` "https://nbcc.scot/" puts `https://nbcc.scot/elf/p/<code>` in the page, and with "http://localhost:3000" answers the live site sentence; the places list has 24 entries.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/admin-elf-doors-print.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Add the BDD.** With door 7 set up and a place phone set, the staff card answers 200 HTML naming the place, with `no-store`; without a place it answers 409 with "needs its place"; the places list answers with "For staff only". The poster needs https, so it is unit tested only.
- [ ] **Step 6: Lint, check types, and commit** `feat(elf): print the poster, staff card, tag and list of places`.

### Task 8: The Doors tile, the 24 doors and a door's sheet

**Files:**
- Modify: `assets/js/admin/elf-hq.js`, `assets/css/admin-elf-hq.css`
- Test: `test/unit/admin-elf-doors-js.test.ts` (jsdom, set up as `test/unit/admin-elf-hq-js.test.ts` is), `test/unit/admin-elf-hq-css.test.ts` (must keep passing)

**Interfaces:**
- Consumes: Task 6's answers and routes; `ask`, `say`, `el`, `show` and `tileCount` inside `initElfHq`.
- Produces: a `doors` tab in `TABS` between Families and Money (`{ id: "doors", name: "Doors", icon: PAPER + "icons/icon-frame.webp" }`), `drawDoorsPart()`, and `openDoor(n)`, which Tasks 9 and 10 use.

What it shows. Match `doors-admin.html`, using its words exactly:
- The level select: the heading "The 24 doors"; the chips "N places agreed", "N prizes chosen" and "N ready for their day"; 24 tile buttons in four columns (three when the level select is 420 pixels wide or less), each with its number, its weekday, its place or "No place yet" in the handwriting style, and "Ready" or "N to do". The open door's tile has `aria-pressed="true"`.
- A door's sheet sits beside the level select when the Doors part is at least 1000 pixels wide, and below it otherwise. It has the mini door, "Door 7 · Monday 7 December" and the place's name; then "Ready for its day" with the six `READY_WORDS` items, each ticked or not; then these parts, each with its own Save button that sends only its own fields in a PATCH:
  - The place: name; town; other names that also count (each with a remove button, then an Add a name field); address; who to talk to; their phone; their email, with the hint "The reminder on its day goes here"; open on its day until, with the hint "It closes less than an hour after the last clue." as `is-error` when `closesTooSoon` is true, otherwise "Open past ${an hour after clue 3, such as 7:30pm}, an hour after the last clue." as `is-ok`; where the elf sits; agreed by.
  - Its evening: clue 1, clue 2, clue 3 and the place shown, each a time field holding the evening's time; the line "The place gets its reminder email at 9am."; the help line "On a school holiday, set clue 1 to the morning."
  - The prize: the prize; the Show it off tick; the door picture (the `picture` when there is one, otherwise the dashed frame with "Not made yet. It is made from the prize list."); the line "A prize must not point at the place giving it."
  - The elf and its tag: the elf's name; the word, drawn as a tag; Make a new word. A 409 with `printed` asks "This door's tag has been printed. Make a new word anyway?" with Yes and No, and Yes sends `{ confirm: true }`.
  - The three clues, and Print and drop off: headings only here; Task 9 fills them.
- When `canEdit` is false, every field is disabled and no Save, Add or remove button is drawn. When `started` is true, the four times are read only, with the line "This door's evening has started."
- Opening the Doors tab loads `GET /api/admin/elf/doors` once; choosing a tile loads `GET /api/admin/elf/doors/:n`; a save redraws the sheet and that door's tile from the answer; any error shows with `say(target, error, false)`.
- The menu now has five tiles: `.hq-menu` becomes `grid-template-columns: repeat(auto-fit, minmax(118px, 1fr))`, as in the mockup, which keeps two columns at the narrowest.
- CSS blocks: `.hq-doors` (two columns under `@container (min-width: 1000px)`), `.hq-level`, `.hq-door-grid`, `.hq-door` with `.is-ready`, `.is-needs`, `.is-empty` and `.is-on`, `.hq-door-sheet`, `.hq-mini-door`, `.hq-ready-list`, `.hq-times`, `.hq-tagword`, `.hq-door-pic`. Words in a tile wrap only between words (`overflow-wrap: break-word; hyphens: auto`), and a tile's status never wraps.

- [ ] **Step 1: Write the failing jsdom tests**, with invented places and the fake fetch of `page()`. Opening Doors fetches `/api/admin/elf/doors` once and draws 24 tiles, door 3's showing "Pine Cone Café", "Thu" and "Ready". An 80 character place name appears whole in its tile. Choosing door 7 fetches `/api/admin/elf/doors/7` and shows "Door 7 · Monday 7 December" and the six ready items. Saving The place sends `PATCH /api/admin/elf/doors/7` with only the place's fields. A 400 answer shows its error with `is-error`. With `canEdit` false there is no Save button and the inputs are disabled. A 409 with `printed` on Make a new word asks first, and Yes sends `{ confirm: true }`. The CSS house rule test still passes.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/admin-elf-doors-js.test.ts test/unit/admin-elf-hq-css.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `el()`.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): Head Elf HQ Doors: the 24 doors and a door's sheet`.
- [ ] **Step 6 (the controller, after review):** copy `.superpowers/sdd/2026-11-05-elf-admin-phase-1/standin/hq.html` to `.superpowers/sdd/2026-11-10-elf-wave-2/standin/hq.html`, give its pretend fetch answers for the Doors routes (invented places), and check the Doors tab at 1320, 390 and 360 pixels wide beside the mockup: no sideways scroll, no word broken in the middle, no status wrapped.

### Task 9: The clues, the paste box, the prints and the drop off

**Files:**
- Modify: `assets/js/admin/elf-hq.js`, `assets/css/admin-elf-hq.css`
- Test: `test/unit/admin-elf-doors-paste-js.test.ts`

**Interfaces:**
- Consumes: Task 8's `drawDoorsPart` and `openDoor`; Task 6's clue, tick and paste routes; Task 7's print routes; `PASTE_EXAMPLE`'s words (copy them into the script; it cannot import TypeScript).
- Produces: the clue part, "Paste all the clues", "Copy the prize list", the print buttons and the two ticks.

What it shows:
- The three clues on a door's sheet: for each, a numbered circle (clue 1, the hardest, in blush; clue 2 in gold; clue 3, the easiest, in holly, as in the mockup), its time, a textarea with a live "N of 500" count, and Save (a PUT of that one clue). A count over 500 shows as `is-error` and Save sends nothing. A clue that is out is read only, with "Out since ${its time}."
- Print and drop off: the buttons Print the poster, Print the staff card and Print the tag, each opening its print in a new tab through `openPrint(url)`: `win.open("", "_blank")` on the click itself, then the page fetched with the bearer token as text, shown through a Blob address that is revoked after 120 seconds (the pattern of `frOpenMaterial` in `assets/js/admin/app.js:12596-12620`). A JSON error answer shows its error in the sheet instead. Then the ticks "Elf, poster, prize and staff card dropped off" and "Thank you sent", each showing who ticked it and when ("Ticked by staff@example.org on 20 November"), sending POST to tick and DELETE to untick.
- On the level select: "Print the list of places" (`openPrint` of `/api/admin/elf/places-list`); "Copy the prize list" (writes `prizeList` with `navigator.clipboard.writeText`, then says "Copied. Send it to Claude for the door pictures."; when the clipboard is refused it shows the list in a read only box to copy by hand); and "Paste all the clues".
- Paste all the clues: a panel with the format help (`PASTE_EXAMPLE`'s words), a textarea and "Check these clues". The check (POST `/api/admin/elf/clues/check`) lists each door found with its place (or "No place yet") and its three clues, and every problem as `is-error`. "Save these clues" appears only when there are no problems; saving (POST `/api/admin/elf/clues/save`) says "Saved ${clues} clues for ${doors} doors." and reloads the doors.

- [ ] **Step 1: Write the failing jsdom tests.** Check posts the text to `/api/admin/elf/clues/check`. With problems, they show with `is-error` and there is no Save these clues button. With none, Save these clues posts the same text to `/api/admin/elf/clues/save` and shows "Saved 6 clues for 2 doors.". Copy the prize list writes the list to a mocked `navigator.clipboard`. Print the staff card opens a tab and fetches `/api/admin/elf/doors/7/staff-card` with `Authorization: Bearer …`. The dropped off tick sends POST, then DELETE, to `/api/admin/elf/doors/7/dropped-off`. A clue over 500 characters shows its count as `is-error` and sends nothing.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/admin-elf-doors-paste-js.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(elf): Doors: clues, paste all the clues, prints and drop off`.
- [ ] **Step 6 (the controller, after review):** check the clue and print parts and the paste panel in the stand-in at 1320, 390 and 360 pixels.

### Task 10: HQ points at the doors, Settings holds the place phone, and the README

**Files:**
- Modify: `src/elf/admin-hq.ts`, `src/routes/admin-elf.ts`, `assets/js/admin/elf-hq.js`, `README.md`
- Test: `test/unit/elf-admin-hq.test.ts`, `test/unit/admin-elf.test.ts`, `test/unit/admin-elf-hq-js.test.ts`

**Interfaces:**
- Consumes: `readinessOf`, `doorPicture`, `doorSeason`, `staffEveningOf` (Task 2); `ensureElfDoors`, `listElfDoors` (Task 5); `eveningFor`, `doorInstant` (calendar.ts).
- Produces:
  - `HqTab` gains `"doors"`; `Quest.id` gains `"doors"`.
  - `questsFor(n: HqNumbers, previewOn: boolean, notReady: { door: Door; toDo: number }[]): Quest[]`. When `notReady` is not empty it adds a doors quest straight after the names quest: title "1 door to get ready" or "${k} doors to get ready", words `Door ${first.door} is next: ${first.toDo} to do.`, button "Open Doors", go "doors".
  - `GET /api/admin/elf/hq` gains `doorsNotReady: number`: the doors whose clue 1 is still to come and that are not ready. It passes them to `questsFor`, soonest first.
  - The Doors tile's count is `doorsNotReady` (`tileCount("doors", …)` in `draw()`).
  - Settings: an admin sees "NBCC's phone number for places", a phone field whose Save sends `PATCH /api/admin/elf/settings { placePhone }`, with the hint "It goes on every staff card."; a head elf who is not an admin sees the number read only.

- [ ] **Step 1: Write the failing tests.** `questsFor(numbers, false, [{ door: 1, toDo: 2 }, { door: 2, toDo: 6 }])` includes `{ id: "doors", title: "2 doors to get ready", words: "Door 1 is next: 2 to do.", go: "doors" }`, and with `[]` there is no doors quest. GET `/hq` at noon on 30 November 2026 counts all 24 empty doors, and at noon on 8 December only doors 8 to 24. In jsdom, the Doors tile shows the count and the quest's button opens the Doors tab; an admin's Settings sends `{ placePhone: "01632 960 123" }`.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/elf-admin-hq.test.ts test/unit/admin-elf.test.ts test/unit/admin-elf-hq-js.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and update README.md's Head Elf HQ section: the Doors tile (what head elves set up there; Paste all the clues and its format; the prints; the place phone in Settings; nothing in Doors is ever seen by families).
- [ ] **Step 4: Run them again.** Expected: PASS. Then run the whole suite with `npm run test:unit`, and report by name any failure other than perf-budget and footer-master.
- [ ] **Step 5: Commit** `feat(elf): HQ points at doors not ready; the place phone; README`.
