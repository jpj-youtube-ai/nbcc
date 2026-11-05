# Head Elf HQ (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Elf Detective School its own admin section, Head Elf HQ (Admin > Content > Elf Detective School), with HQ, Families, Money and Settings, and show elf payments in Admin > Donations, ready before sign ups open on Friday 13 November 2026.

**Architecture:** A new permission section `elf` gates a new admin view `view-elf`, drawn by its own script `assets/js/admin/elf-hq.js` (the pattern of `assets/js/admin/elf.js`, which it replaces) with its own stylesheet `assets/css/admin-elf-hq.css`. The server side is `src/routes/admin-elf.ts` (extended), `src/db/elf-admin.ts` (new, the admin's reads and audited writes) and two pure modules, `src/elf/admin-hq.ts` and `src/elf/admin-families.ts`. Donations gains elf rows in `listDonations` and an elf line in the source totals.

**Tech Stack:** Express + TypeScript, node-pg-migrate, zod, Vitest (jsdom for admin scripts), Cucumber BDD (CI only: no local database).

**Spec:** `docs/superpowers/specs/2026-11-05-elf-admin-design.md`. The look follows the mockup kept in this build's workspace (`.superpowers/sdd/2026-11-05-elf-admin/mockup/head-elf-hq.html`, git ignored) and its pictures sent to Jaimie on 5 November 2026.

## Global Constraints

- The repository is public: invented names only (families like "Sam Example", detectives like "Ruby Tinselfoot"), 01632 960 123 for any phone number, `@example.org` emails, no folder on this computer named in committed files.
- Words staff read: plain English, no dashes or hyphenated words, "could" for money not yet claimed.
- Admin status words use `is-ok` and `is-error`, never `.err` (the public stylesheet hides `.err`).
- No inner scrollbars: content wraps and the page grows. 390 pixels wide works.
- `assets/css/admin-elf-hq.css`: every selector starts `.hq-` (or is `#view-elf` itself), no `!important`, no `overflow: auto` or `scroll`, motion only inside `@media (prefers-reduced-motion: no-preference)` and keyframes move only `transform` and `opacity`.
- Tokens, verbatim from the spec: maroon `#800000`, ink `#3A0B0B`, crimson `#C02238`, holly `#1A531A`, gold `#D9A93E`, cream `#F8F5EE`, card `#FFFDFA`; Playfair Display and Poppins (already loaded by `styles.css`), Caveat from `/assets/fonts/caveat-latin.woff2` for short notes.
- Switching the school on or off, the prices and the preview link stay admins only in the route (`authorizeSectionAsAdmin`), whatever the Team matrix says.
- Every head elf change goes through `writeWithAudit` (`src/db/donations.ts`) with actor `actorOf(claims)`.
- Migrations are additive and sort after `1791200000320_elf-favourites.js`; re-check `origin/main` right before merging.
- README.md is updated in the same change. Never commit `.mcp.json`.

## Review Focus

1. **Someone without the section** (an editor, a viewer, an editor whose access was saved before today): no menu tile, and every `/api/admin/elf/*` answers 403. Tests in Task 1.
2. **A removed family** asking for a sign in code, holding an old session, or counted anywhere: refused and left out. Tests in Tasks 3 and 5.
3. **A head elf typing a name enrolling would refuse** (two first names, a real surname, digits, an emoji, an empty box): refused with enrolling's own words, nothing saved. Tests in Task 5.
4. **An email change to another family's email**: 409 with plain words, nothing changed, sessions kept. Test in Task 5.
5. **Donations filters mixed with elf rows**: elf rows never appear under Monthly, Refunded, Pending, Failed, a claim status or another source; they do appear in the plain list and under "Elf Detective School only"; the total adds both kinds, so paging is right. Tests in Task 7.

---

### Task 1: The `elf` section, its menu entry and an empty view

**Files:**
- Modify: `src/admin/permissions.ts` (SECTIONS gets `"elf"` before `"team"`, with a comment; the viewer default list of sections given `"none"` gains `"elf"`; editors are not given it)
- Modify: `assets/js/admin/app.js:34-37` (the client `SECTIONS` copy gains `"elf"` in the same place)
- Create: `migrations/1791200000330_permissions-elf.js` (the `1788100000000_permissions-business-supporters.js` pattern: `elf` is `edit` for `role = 'admin'`, `none` otherwise, only on saved non-empty matrices lacking the key; `down` removes the key)
- Modify: `src/routes/admin-elf.ts` (every `"fundraising"` becomes `"elf"`; the header comment says Admin > Content > Elf Detective School)
- Modify: `admin.html` (Content menu: `<li><button class="admin-nav-link" type="button" data-view="elf">Elf Detective School</button></li>` right after Festive Ball; a new `<section class="admin-view" id="view-elf" aria-labelledby="elf-heading" hidden><h2 id="elf-heading" class="hq-sr">Elf Detective School</h2><div id="elfHq"></div></section>`; remove the Get involved Settings elf block (the comment starting "NBCC Elf Detective School (wave 1)" and its `gi-part` group holding `#elfAdmin`) and the `elf.js` script tag)
- Delete: `assets/js/admin/elf.js`, `test/unit/admin-elf-js.test.ts` (their switch, prices, preview link and sign ups move to Tasks 4 and 8)
- Test: `test/unit/admin-permissions.test.ts`, `test/unit/admin-elf.test.ts`, `test/unit/admin-sections-in-sync.test.ts` (already checks the two lists match), `test/unit/elf-admin-migrations.test.ts` (new)

**Interfaces:**
- Produces: the permission section `"elf"` (`Section`), used by every route in later tasks as `authorizeSection(req, res, "elf", "view" | "edit")` and `authorizeSectionAsAdmin(req, res, "elf")`; the view `#view-elf` with mount `#elfHq`.

- [ ] **Step 1: Write the failing tests**
  - `admin-permissions.test.ts`, "gives the Elf Detective School to admins only by role": `roleToPermissions("admin").elf === "edit"`, `roleToPermissions("editor").elf` is `undefined` or `"none"`, `roleToPermissions("viewer").elf === "none"`, and `can({ elf: "view" }, "elf", "view") === true`.
  - `admin-elf.test.ts`: change every existing case's expectations to the `elf` section, and add "refuses an editor" (`getAdminElfSettings` with role `editor` and no saved matrix answers 403) and "lets in someone given the section in the Team matrix" (role `viewer`, saved `permissions: { elf: "view" }`, answers 200).
  - `elf-admin-migrations.test.ts`, "adds the elf section to saved matrices, admins edit and everyone else none": load the migration with a fake `pgm` collecting `pgm.sql` strings; the up SQL contains `'elf'`, `CASE WHEN role = 'admin' THEN 'edit' ELSE 'none' END` and `NOT (permissions ? 'elf')`; and "sorts after the newest migration on main before it" (its file name sorts after `1791200000320_elf-favourites.js`).
  - A test in `admin-elf.test.ts` reading `admin.html`: "puts Elf Detective School in Content after the Festive Ball": the Content panel's links in order include `data-view="ball"` then `data-view="elf"`; `#view-elf` and `#elfHq` exist; `#elfAdmin` and `elf.js` are gone.
- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run test/unit/admin-permissions.test.ts test/unit/admin-elf.test.ts test/unit/elf-admin-migrations.test.ts test/unit/admin-sections-in-sync.test.ts`
  Expected: FAIL (no `elf` section, no migration, the routes still ask for `fundraising`).
- [ ] **Step 3: Make the changes listed under Files**
- [ ] **Step 4: Run them again and watch them pass**, then `npm run lint` and `npm run build`
  Expected: PASS; lint and build clean.
- [ ] **Step 5: Commit** (`git add` the files above; message `Head Elf HQ: the Elf Detective School gets its own permission and admin section`)

### Task 2: The shell: stylesheet, script and the menu

**Files:**
- Create: `assets/css/admin-elf-hq.css` (tokens, panels, buttons, the menu tiles, counts, chips, views, the phone layout; from the mockup)
- Create: `assets/js/admin/elf-hq.js`
- Modify: `admin.html` (link `admin-elf-hq.css`; `<script defer src="/assets/js/admin/elf-hq.js"></script>`)
- Test: `test/unit/admin-elf-hq-js.test.ts` (new, jsdom), `test/unit/admin-elf-hq-css.test.ts` (new)

**Interfaces:**
- Produces, in `elf-hq.js` (UMD like `elf.js`: `module.exports` under tests, `DOMContentLoaded` in the browser):
  `initElfHq(doc, win, opts?: { confirm?: (words: string) => boolean }) => { load(): Promise<void>; show(tab: "hq" | "families" | "money" | "settings"): void }`
  It builds, inside `#elfHq`: the title (the school's logo `/assets/img/elf-detective-school.webp`, "Elf Detective School", the note "Head Elf HQ", a state pill), a `role="tablist"` of four tiles (HQ with `icons/icon-bell.webp`, Families with `icons/icon-friend.webp`, Money with a "£" coin, Settings with `icons/icon-paint.webp`, all under `/assets/img/elf/paper/`), and four `role="tabpanel"` sections with `data-tab` set to the tab id.
  Helpers later tasks use: `ask(method: string, url: string, body?: unknown): Promise<any>` (bearer token from `sessionStorage["nbcc_admin_token"]`, rejects with `Error(serverWords)`), `say(target: Element, words: string, ok: boolean)` (sets `is-ok` or `is-error`), and `tileCount(tab, n)` to put a count on a tile.
  It loads when `#view-elf` stops being hidden (a `MutationObserver` on its `hidden` attribute) and when `load()` is called. The open tab is kept in `sessionStorage["nbcc_elf_hq_tab"]`.

- [ ] **Step 1: Write the failing tests**
  - `admin-elf-hq-js.test.ts`: "draws four tiles, HQ open" (4 `[role=tab]`, the first `aria-selected="true"`, only the `hq` panel shown); "opens a tile's part and remembers it" (click Families: its panel shown, the others hidden, `sessionStorage.nbcc_elf_hq_tab === "families"`; a fresh `initElfHq` opens Families); "loads when the section is opened" (setting `#view-elf.hidden = false` makes a `GET /api/admin/elf/hq`); "says a failure in words" (the pretend server answers 500 with `{ error: "Admin is temporarily unavailable" }`: that sentence shows with `is-error`).
  - `admin-elf-hq-css.test.ts`: the Global Constraints' stylesheet rules (each selector starts `.hq-` or is `#view-elf`; no `!important`; no `overflow: auto|scroll`; every `@keyframes` inside a `prefers-reduced-motion: no-preference` block and naming only `transform` and `opacity`); "uses the brand's ink and colours" (`--hq-ink: #3A0B0B`, `--hq-maroon: #800000`).
- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run test/unit/admin-elf-hq-js.test.ts test/unit/admin-elf-hq-css.test.ts`
  Expected: FAIL (no such files).
- [ ] **Step 3: Write the stylesheet and script**
  Port the mockup's design: chunky panels with `2.5px solid var(--hq-ink)`, `border-radius: 22px`, hard shadow `5px 6px 0 var(--hq-ink)`, the grain `/assets/img/elf/paper/ui/grain-light.webp` multiplied; tiles that press in on `:active` and when selected; the 4 tiles in one row from 640 pixels, 2 by 2 below.
- [ ] **Step 4: Run them again and watch them pass**
- [ ] **Step 5: Commit** (`Head Elf HQ: its own look and menu`)

### Task 3: HQ's numbers, and removed families left out

**Files:**
- Create: `migrations/1791200000340_elf-families-removed.js` (`elf_families.removed_at timestamptz` null, `removed_by text` null; down drops both)
- Create: `src/elf/admin-hq.ts` (pure)
- Create: `src/db/elf-admin.ts`
- Modify: `src/db/elf.ts` (`activeFamilyByEmail` and `findElfSession` leave out families with `removed_at` set; `listElfSignups` removed, HQ replaces it)
- Modify: `src/routes/admin-elf.ts` (`GET /api/admin/elf/hq`; `GET /api/admin/elf/signups` removed)
- Test: `test/unit/elf-admin-hq.test.ts` (new), `test/unit/admin-elf.test.ts`, `test/unit/elf-admin-migrations.test.ts`, `features/elf-admin.feature` + `features/steps/elf-admin.steps.js` (new)

**Interfaces:**
- Produces, `src/elf/admin-hq.ts`:
  - `type HqTab = "hq" | "families" | "money" | "settings"`
  - `interface HqNumbers { families: number; detectives: number; namesToCheck: number; waitingPayments: number; entryPence: number; giftPence: number; giftAidPence: number }`
  - `interface Quest { id: "names" | "preview" | "waiting"; count: number | null; title: string; words: string; go: HqTab | null; button: string | null; filter: "check" | null }`
  - `questsFor(n: HqNumbers, previewOn: boolean): Quest[]` in this order, each only when it applies: names (`namesToCheck > 0`; title "First names to check"; words "Until you tick a name, the public sees only its first letter."; button "Check names"; go "families"; filter "check"), preview (`previewOn`; "Your preview link is open"; "Anyone holding it can see the school. End it when you have finished looking."; "End it"; "settings"), waiting (`waitingPayments > 0`; "Payments not finished"; "Started over an hour ago and never paid: usually someone who changed their mind. Nothing to do."; no button).
  - `tileFor(look: unknown): string`: `/assets/img/elf/paper/tiles/costumes/<costume>-<skin>.webp` from the look's `costume` (an id in `COSTUMES` of `src/elf/wardrobe.ts`, else `"detective"`) and `skin` (one of `s1` to `s5`, else `"s1"`).
  - `daysUntil(now: Date, then: Date): number` (whole UK days, never below 0), `giftAidCouldAddPence(giftAidPence: number): number` (a quarter, rounded).
- Produces, `src/db/elf-admin.ts`: `elfHqNumbers(now: Date): Promise<HqNumbers>` (active, not removed families; paid orders; `waitingPayments` = pending orders older than an hour), `elfRecruits(limit: number): Promise<{ detectiveId: number; familyId: number; firstName: string; surname: string; badgeNumber: number | null; approved: boolean; look: unknown }[]>` (newest active detectives of not removed families).
- Produces, the route: `GET /api/admin/elf/hq` (`elf` view) answers `{ settings, canSwitch: boolean, numbers: HqNumbers, quests: Quest[], recruits: { detectiveId, familyId, name, badge, approved, tile }[], firstClueAt: string, daysToFirstClue: number }`, where `canSwitch` is true for role `admin`, `name` is `firstName + " " + surname`, `badge` is `badgeWords(badgeNumber)` from `src/elf/emails.ts` (or null) and `firstClueAt` is `firstClueAt(year)` from `src/elf/views.ts`.

- [ ] **Step 1: Write the failing tests**
  - `elf-admin-hq.test.ts`: "lists only the quests that apply, in order" (all three, then none when the numbers are zero and the preview is off); "gives the names quest the count and the Families filter"; "picks the tile of the costume the look wears, in its skin" (`{ costume: "reindeer", skin: "s3" }` gives `.../reindeer-s3.webp`; `null`, `{}`, `{ costume: "nope", skin: "s9" }` give `.../detective-s1.webp`); "counts whole days to the first clue, never below 0"; "says what Gift Aid could add" (`giftAidCouldAddPence(21000) === 5250`).
  - `admin-elf.test.ts`: "HQ answers with its numbers and quests" (mocked `elfHqNumbers`, `elfRecruits`, `getElfSettings`; checks `quests[0].id`, `recruits[0].tile`, `canSwitch` true for an admin and false for a viewer given `elf: "view"`); "HQ refuses an editor" (403).
  - `elf-admin-migrations.test.ts`: the removed columns migration adds `removed_at` and `removed_by` and sorts after `1791200000330_permissions-elf.js`.
  - BDD `features/elf-admin.feature`, scenario "Head Elf HQ counts a paid family and refuses an editor": using the elf join steps (`"{string} has already enrolled {string} and paid"`) and the admin user steps, an admin GET of `/api/admin/elf/hq` is 200 with `numbers.families` 1 and `numbers.namesToCheck` 1, and an editor's is 403.
- [ ] **Step 2: Run the unit tests and watch them fail**
  Run: `npx vitest run test/unit/elf-admin-hq.test.ts test/unit/admin-elf.test.ts test/unit/elf-admin-migrations.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement the files listed**
- [ ] **Step 4: Run them again and watch them pass**; lint; build. The BDD runs in CI (push the branch as a draft PR when Task 3 is committed, so CI runs it early).
- [ ] **Step 5: Commit** (`Head Elf HQ: HQ's numbers and quests; removed families are left out`)

### Task 4: The HQ screen

**Files:**
- Modify: `assets/js/admin/elf-hq.js`, `assets/css/admin-elf-hq.css`
- Test: `test/unit/admin-elf-hq-js.test.ts`

**Interfaces:**
- Consumes: `GET /api/admin/elf/hq` (Task 3); `PATCH /api/admin/elf/settings` `{ schoolOn: boolean }` (exists, admins only).
- Produces: `#hqLever` (`role="switch"`, `aria-checked`), the state pill words "Live" / "Switched off".

- [ ] **Step 1: Write the failing tests** (in `admin-elf-hq-js.test.ts`, a pretend server answering the Task 3 shape with invented families)
  - "asks a second time before switching the school on, and only then sends it": pressing `#hqLever` shows "Switch it on for everyone?" with "Yes, switch it on" and "Not yet"; no PATCH yet; "Yes" sends `PATCH /api/admin/elf/settings` with `{ schoolOn: true }`; the lever reads `aria-checked="true"` and the pill says "Live". Switching off asks "Switch it off? Families cannot see the school or sign in while it is off."
  - "lets only an admin pull the lever": with `canSwitch: false` the lever is `disabled` and the words "Only an admin can switch the school on or off" show.
  - "draws the quests with their counts, and a quest's button opens its part": the names quest shows its count; "Check names" opens Families with the "Names to check" filter on; with no quests, "Nothing needs you. The school is running itself." shows.
  - "shows the money as one bar": entries and gifts as two parts whose `flex` weights are the pence; "£210 of the gifts came with Gift Aid, which could add about £52.50 when we claim it."; with no money, "No payments yet." and no bar.
  - "draws the newest recruits as cards": each with its `tile`, its name and its badge, "Name to check" when not approved; Families carries the `namesToCheck` count on its tile.
  - "counts down to the first clue on a rosette": `daysToFirstClue` with "days to the first clue" and the date in words; "detectives enrolled" with `numbers.detectives`.
- [ ] **Step 2: Run them and watch them fail** (`npx vitest run test/unit/admin-elf-hq-js.test.ts`)
- [ ] **Step 3: Draw HQ** as the mockup's HQ (the lever with the bauble `deco/bauble.webp` for a knob, two rosettes, Needs you, Raised so far, Newest recruits)
- [ ] **Step 4: Run them again and watch them pass**
- [ ] **Step 5: Commit** (`Head Elf HQ: the HQ screen`)

### Task 5: Families on the server

**Files:**
- Create: `src/elf/admin-families.ts` (pure)
- Create: `src/elf/sign-in-code.ts` (move `sendSignInCodeTo` out of `src/routes/elf.ts`, unchanged; `src/routes/elf.ts` imports it)
- Modify: `src/db/elf-admin.ts`, `src/routes/admin-elf.ts`
- Test: `test/unit/elf-admin-families.test.ts` (new), `test/unit/admin-elf.test.ts`, `features/elf-admin.feature`

**Interfaces:**
- Produces, `src/elf/admin-families.ts`:
  - `type FamilyFilter = "all" | "check" | "week" | "removed"`; `familyFilter(sent: unknown): FamilyFilter` (anything else is `"all"`).
  - `parseDetectiveChange(sent: unknown): { ok: true; change: { firstName?: string; surname?: string; approved?: boolean } } | { ok: false; error: string }`: a first name through `cleanFirstName` (refusals in `firstNameRefusalWords`), a surname through `isFestiveSurname` ("Please choose a festive surname from the list."), `approved` a boolean, nothing sent "Nothing to change.". A name change sets `approved: false` unless `approved: true` is sent with it.
  - `parseFamilyChange(sent: unknown): { ok: true; change: { grownUpName?: string; email?: string } } | { ok: false; error: string }`: the name trimmed, 1 to 80 ("Please give the grown up's name."), the email trimmed, lower case, valid, at most 200 ("Please give an email address we can reach them at.").
- Produces, `src/db/elf-admin.ts`:
  - `listElfFamilies(o: { q: string; filter: FamilyFilter; offset: number; limit: number; now: Date }): Promise<{ rows: FamilySummaryRow[]; total: number; counts: Record<FamilyFilter, number> }>`: active families (not removed, except under `"removed"`), newest first; `q` matches the grown up's name or email, a detective's names, or a badge number; `"week"` is enrolled in the last 7 days; `"check"` has an active detective not approved.
  - `elfFamilySheet(id: number): Promise<FamilySheetRow | null>`: the family, its active detectives (with `look`), and every order (reference, status, paid_at, entry_pence, donation_pence, gift_aid).
  - `changeElfDetective(id, change, actor): Promise<DetectiveRow | null>`, `changeElfFamily(id, change, actor): Promise<FamilySheetRow | "email-taken" | null>` (an email change ends the family's sessions), `removeElfFamily(id, actor)` (sets `removed_at` and `removed_by`, ends the sessions) and `restoreElfFamily(id, actor)` (clears them), each `Promise<FamilySheetRow | null>`, each through `writeWithAudit` with actions `elf.detective.changed`, `elf.family.changed`, `elf.family.removed`, `elf.family.restored` and entity `elf_detective` or `elf_family`.
- Produces, the routes (`elf` view to read, `elf` edit to change; ids are positive integers, else 400; unknown ids 404 "We could not find that family." or "...that detective."):
  - `GET /api/admin/elf/families?q=&filter=&offset=` answers `{ families: { id, grownUpName, email, enrolledAt, removed, namesToCheck, detectives: { id, firstName, badge, approved, tile }[] }[], total, counts }` (50 a page)
  - `GET /api/admin/elf/families/:id` answers `{ family: { id, grownUpName, email, newsletter, enrolledAt, removedAt, removedBy, detectives: { id, firstName, surname, badge, approved, tile }[], payments: { reference, status, paidAt, entryPence, giftPence, giftAid }[] } }`
  - `PATCH /api/admin/elf/detectives/:id` answers `{ detective }`; `PATCH /api/admin/elf/families/:id` answers `{ family }`, or 409 `{ error: "Another family already uses that email." }`
  - `POST /api/admin/elf/families/:id/sign-in-code` answers `{ sent: true }` (409 "This family is removed." when it is), audited as `elf.sign_in_code.sent`
  - `POST /api/admin/elf/families/:id/remove` and `/restore` answer `{ family }`

- [ ] **Step 1: Write the failing tests**
  - `elf-admin-families.test.ts`: "takes a new first name and turns its tick off"; "keeps the tick when the change ticks it too"; "refuses names enrolling refuses, in enrolling's words" (`"Ruby Mae"`, `""`, `"R2D2"`, `"Ruby🎄"`, a surname not on the list); "takes the tick alone"; "says when there is nothing to change"; "tidies a family's name and email" (`"  SAM@Example.ORG "` gives `sam@example.org`); "refuses an empty name and a broken email"; "reads junk filters as all".
  - `admin-elf.test.ts`: "lists families for someone with the section, 403 for an editor"; "changes a detective for edit, 403 for view only"; "says when another family has the email" (mocked `changeElfFamily` returns `"email-taken"`: 409 and the words); "sends a sign in code to the family's own email" (`sendSignInCodeTo` mocked, called with the sheet's email); "will not send a code to a removed family"; "removes and puts back" (mocks called with the id and `admin:<email>`); "answers 404 for an unknown family and 400 for a broken id".
  - BDD `features/elf-admin.feature`: "A head elf ticks a name and changes it" (PATCH approved true, then a new first name: the detective's `name_approved` is false again, and an `audit_log` row `elf.detective.changed` exists, using `"an audit_log row for action {string} by actor {string} exists"`); "A removed family cannot sign in" (remove, then `POST /api/elf/sign-in/request` for their email sends no code email; put back, and the next request sends one).
- [ ] **Step 2: Run the unit tests and watch them fail** (`npx vitest run test/unit/elf-admin-families.test.ts test/unit/admin-elf.test.ts`)
- [ ] **Step 3: Implement the files listed**
- [ ] **Step 4: Run them again and watch them pass**; lint; build; push (CI runs the BDD)
- [ ] **Step 5: Commit** (`Head Elf HQ: families, names, sign in codes, removing and putting back`)

### Task 6: The Families screen

**Files:**
- Modify: `assets/js/admin/elf-hq.js`, `assets/css/admin-elf-hq.css`
- Test: `test/unit/admin-elf-hq-js.test.ts`

**Interfaces:**
- Consumes: the Task 5 routes.
- Produces: `sessionStorage["nbcc_elf_hq_family"]`: a family id that, when present as the section loads, opens Families on that family's sheet and is then cleared (Task 7's Donations link sets it).

- [ ] **Step 1: Write the failing tests** (pretend server with three invented families)
  - "lists families as cards with their elves": each card's tiles, the grown up's name, the first names and badges, "2 names to check" or "All names ticked".
  - "searches as you type, after a short pause, and filters" (the `q` sent; the "Names to check", "This week" and "Removed" chips send their filter and show their counts).
  - "opens a family's sheet beside the list, and on a phone in its place with Back to families".
  - "ticks a name in one press" (`PATCH /api/admin/elf/detectives/:id` with `{ approved: true }`; the switch reads "Ruby shows in public"; the Families tile count goes down by one).
  - "changes a detective's names in place, and shows the server's refusal as is-error".
  - "changes the grown up's details, and says when another family has the email".
  - "sends a sign in code and says so": "We sent a sign in code to sam@example.org."
  - "asks before removing, then shows the family as removed with Put back": the confirm words "Remove the Example family? They cannot sign in, and they leave the counts and the money. If they paid, refund them in Stripe first."
  - "opens the family the Donations link asked for" (`nbcc_elf_hq_family` set before load).
- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Draw Families** as the mockup's (list of family cards with stacked tiles, the sheet with detective cards and the name switch, payments, actions)
- [ ] **Step 4: Run them again and watch them pass**
- [ ] **Step 5: Commit** (`Head Elf HQ: the Families screen`)

### Task 7: Elf money in Donations

**Files:**
- Modify: `src/db/admin.ts` (`AdminDonationRow` and `listDonations`)
- Modify: `src/admin/gift-sources.ts` (`ELF_SOURCE = "elf_school"`, `SourceTotals.elfSchool`, the line "Elf Detective School", `ELF_PAYMENTS_NOTE = "Elf Detective School payments are entries to take part, with any gift on top. Entries are never claimed for Gift Aid."`)
- Modify: `src/db/overview-numbers.ts` (`sumGiftsBySource` adds the elf sums: paid orders of not removed families, entry plus gift, this month and in all, counted as payments)
- Modify: `src/routes/admin-donation-sources.ts` (the note gains `ELF_PAYMENTS_NOTE`)
- Modify: `admin.html` (a fourth source checkbox, `donationsElfFilter`, "Elf Detective School only"), `assets/js/admin/app.js` (the filter, the row, the link)
- Test: `test/unit/admin-donations-elf.test.ts` (new), `test/unit/gift-sources.test.ts` (or the existing source lines test), `test/unit/admin-app.test.ts`, `features/elf-admin.feature`

**Interfaces:**
- Produces: `AdminDonationRow` gains `kind: "donation" | "elf"`, `elf_reference: string | null`, `elf_family_id: number | null`, `entry_pence: number | null`, `gift_pence: number | null`, and `donor_id` becomes `number | null` (null on elf rows). Elf rows: `source` `"elf_school"`, `mode` `"once"`, `payment_status` `"paid"`, `payment_channel` `"stripe"`, `gift_aid` true only when the order has a gift with Gift Aid, `claim_status` the value an ordinary gift without Gift Aid has (read it from `src/db/donations-model.ts`), `created_at` the order's `paid_at`.
- Rules in `listDonations`: elf rows are included only when no claim status filter is set, the channel is unset or `stripe`, the payment status is unset or `paid`, the mode is not `monthly`, and the source is unset or `elf_school`; gifts are left out when the source is `elf_school`. Both kinds are ordered `created_at DESC`, then gifts before elf rows, then `id DESC`, and `total` adds both counts.

- [ ] **Step 1: Write the failing tests**
  - `admin-donations-elf.test.ts` (the pool mocked, the SQL and parameters read back): "puts paid elf payments in the plain list" (the SQL reads `elf_orders` with `status = 'paid'` and `removed_at IS NULL`); "shows only elf payments under Elf Detective School only"; "leaves elf payments out under Monthly, Refunded, Pending, Failed, a claim status and the other three sources" (one case each); "orders both kinds by when they were given or paid"; "adds both counts into the total".
  - Source lines: "adds an Elf Detective School line" (`sourceLines(t)` includes `{ key: "elfSchool", name: "Elf Detective School" }`).
  - `admin-app.test.ts`: "ticking Elf Detective School only asks for source=elf_school and unticks the other three"; "an elf row shows its pill, entry and gift, no donor link, and Open in Head Elf HQ, which opens the section on that family" (clicking sets `sessionStorage.nbcc_elf_hq_family` and selects the `elf` view).
  - BDD `features/elf-admin.feature`: "An elf payment comes through Donations" (after a paid enrolment, `/api/admin/donations` lists a row with `source` `elf_school`, and `?source=elf_school` lists only it).
- [ ] **Step 2: Run them and watch them fail** (`npx vitest run test/unit/admin-donations-elf.test.ts test/unit/admin-app.test.ts` and the source lines test)
- [ ] **Step 3: Implement the files listed**
- [ ] **Step 4: Run them again and watch them pass**; lint; build; push
- [ ] **Step 5: Commit** (`Head Elf HQ: elf payments come through Donations, with their own filter`)

### Task 8: The Money and Settings screens

**Files:**
- Modify: `assets/js/admin/elf-hq.js`, `assets/css/admin-elf-hq.css`
- Test: `test/unit/admin-elf-hq-js.test.ts`

**Interfaces:**
- Consumes: `GET /api/admin/elf/hq` (`numbers`, `settings`, `canSwitch`), `PATCH /api/admin/elf/settings` `{ entryFromPence, entrySuggestedPence }`, `POST` and `DELETE /api/admin/elf/preview` (all exist; changes admins only).

- [ ] **Step 1: Write the failing tests**
  - Money: "shows the money as on HQ, with the families count, and a button to Donations filtered to the school" (the button ticks `donationsElfFilter` and selects the `donations` view).
  - Settings: "steps the prices in pounds within their limits" (the least from £1 to £10, the suggestion from £1 to £50, the suggestion never below the least; "Save the prices" sends both in pence and says "Saved."); "shows the server's refusal as is-error"; "makes a preview link and shows it once, to copy" (the link in a read only box with "Copy it now: it is shown only once"); "ends the preview link"; "for someone who is not an admin, shows the prices and the link's state as words, with no buttons".
- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Draw Money and Settings** as the mockup's
- [ ] **Step 4: Run them again and watch them pass**
- [ ] **Step 5: Commit** (`Head Elf HQ: Money and Settings`)

### Task 9: The enrol limit

**Files:**
- Modify: `src/routes/elf.ts` (`export const JOIN_LIMIT = { max: 10, windowMs: 10 * 60_000 } as const;` and `joinLimiter = createRateLimiter(JOIN_LIMIT)`)
- Test: `test/unit/elf-join-limit.test.ts` (new)

- [ ] **Step 1: Write the failing test**: "lets each address enrol 10 times every 10 minutes" (`JOIN_LIMIT` equals `{ max: 10, windowMs: 600000 }`; a limiter made from it allows 10 at one moment, refuses the 11th, and allows again 10 minutes later).
- [ ] **Step 2: Run it and watch it fail** (`npx vitest run test/unit/elf-join-limit.test.ts`)
- [ ] **Step 3: Make the change**
- [ ] **Step 4: Run it again and watch it pass**
- [ ] **Step 5: Commit** (`Elf Detective School: 10 enrolments every 10 minutes for each address`)

### Task 10: README, pictures, review, ship

**Files:**
- Modify: `README.md` (the elf route table: the new routes and the `elf` section; the Admin sections list; the Donations paragraph: elf rows and the filter; the paragraph on the elf school's admin, now Head Elf HQ under Content; the two migrations)
- Create (git ignored workspace): a stand-in page that runs `elf-hq.js` against a pretend server with invented families, in `.superpowers/sdd/2026-11-05-elf-admin/`, and its pictures

- [ ] **Step 1: Update the README** and run the whole unit suite once, on its own: `npm run test:unit` (expected: everything but the Windows only perf-budget and footer-master, and any time limit under load that passes alone)
- [ ] **Step 2: Pictures**: the real screens on the stand-in page at 390 and 1366 pixels wide (HQ, Families with a sheet open, Money, Settings, and Donations with an elf row), checked against the mockup; send them to Jaimie
- [ ] **Step 3: The final whole-branch review** (a fresh reviewer on the most capable model), one fix pass, each fix test first
- [ ] **Step 4: Ship** with `/ship` once Jaimie says yes to the pictures: re-check migrations against `origin/main`, merge with `--match-head-commit`, find the deploy by the merge commit, check the live site (the section loads for an admin is Jaimie's to see; `/api/admin/elf/hq` answers 401 without a session)
