# New home page, Get involved, What's on and the 8pm switch: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the new public pages in four stacked pieces, the last of which sits dormant and switches the site from the Festive Ball to Fill a Red Bag by itself at 20:00 UTC on 7 November 2026.

**Architecture:** Static HTML templates decorated per request in Express, as the site already works. One pure clock function decides the Stage 2 state on each visit, so no deploy happens on the night. New CSS lives in new files, so the budgeted pages stay inside their weight.

**Tech Stack:** Express + TypeScript, plain browser JS, Vitest (jsdom), Cucumber (CI only; no local database).

**Spec:** `docs/superpowers/specs/2026-10-31-get-involved-launch-design.md`. Read it first; it holds the wording decisions and the calls made. Visual reference: the prototype folder `C:\Users\jomcfarl\Downloads\nbcc-scot\get-involved-prototype` (`content/*.html`, `content/proto.css`, `content/proto-fill.js`, `content/fill-night.css`, `content/fill-night.js`, `proto_build_v3.py`). Pictures of it are in its `screens` folder.

## Global Constraints

- Ball pages are not touched: `ball.html`, `ball-terms.html`, `ball-donate.html`, all of `src/ball/` and `src/routes/ball.ts`. `decorateBallPage` and `addEventsNavLink` keep their behaviour. `git diff --stat` must show none of these files.
- `partials/footer.html` and the footers in page files are not changed. Footer additions are made as a page goes out, like `src/fundraising/footer-link.ts`.
- `index.html` keeps `MAIN_ANCHOR` and `AFTER_HERO_ANCHOR` (`src/ball/home-promo.ts`) byte for byte, and `renderHomePromo` still finds them.
- Nothing about Fill a Red Bag shows before Stage 2, apart from the page `/fill` that already exists.
- No placeholder reaches the public: no "Photo to come", no yellow `.tofill` mark, no "Prototype" pill.
- Wording: never "families"; "children, young people and vulnerable adults"; "could", never "will" or "buys"; "Red Bag Full of Joy". Prototype wording otherwise, except as the spec changes it.
- Public repo: invented fixtures only, example.com addresses, no real names.
- Nothing scrolls inside a box. Works at 320px wide. No sideways scroll. `prefers-reduced-motion` respected. Motion is transform and opacity.
- Status classes are `is-ok` and `is-error`, never `.err`.
- New pages need the master footer: run `node scripts/sync-footer.mjs` and check with `--check`. `perf-budget.test.ts` and `footer-master.test.ts` fail falsely on this Windows machine (see the note in `docs` or README); judge them by CI.
- Local tests: `npx vitest run <files> --minWorkers=1`. No local Postgres; BDD runs only in CI.
- README.md is updated with each piece (repo rule).
- Work on branch `get-involved-launch` in this worktree. Local commits only, by file name, messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, never open a PR.
- Screenshots: stand-in server and headless Chrome kept in the scratchpad, never in the repo. Save to `C:\Users\jomcfarl\Downloads\nbcc-scot\launch-screens\piece-N\`. `playwright-core` is installed in the scratchpad folder `redesign` (`chromium.launch({channel:'chrome'})`).

## Review Focus

- The Ball's promotion before the moment: home banner, Ball feature and Ball menu item all still appear, on the home page and others, with the gate open. Pin it with a test in Task 4 and Task 5.
- Old addresses: `/events?utm_source=x` keeps its query string; `/get-involved` with the events switch off is still the 404; `/volunteer` and `/referrals` still forward. Pin in Task 1 and Task 3.
- A published Red Bag list with an item hidden, or with prices that total under £50: the stage still fills and shows only what is on the list. Pin in Task 6.
- A mangled or hostile `?bag=` value, including a key not on the list, a huge number, a negative number and script text: the page is the ordinary page and nothing is set. Pin in Task 7.
- The minute either side of the moment: 19:59:59Z and 20:00:00Z on 7 November, and any time on 8 November. Pin in Task 5.

---

## Piece 1: What's on and Get involved

### Task 1: What's on at /whats-on, and the menu item

**Files:** Move `events.html` to `whats-on.html` (its own title, canonical and heading). Create `src/events/whats-on-link.ts`. Modify `src/routes/fundraise-pages.ts`, `src/routes/site.ts`, `src/site/pages.ts`, `assets/js/admin/app.js` (the wording at about line 16697 names both pages), `features/*.feature`, README. Test: `test/unit/whats-on-page.test.ts`, plus whichever tests name the moved file.

**Interfaces:** Produces `addWhatsOnNavLink(html: string): string` (idempotent, inserts `<li><a href="/whats-on">What's on</a></li>` straight after the Get involved item, no change if that item is absent). `renderWhatsOnPage(template, input)` is today's `renderGetInvolvedPage` under its proper name, minus the film.

- [ ] Write failing tests: `GET /whats-on` serves today's page with the deck, chips and panel and no film; `GET /events?utm_source=x` answers 301 to `/whats-on?utm_source=x`; `/getinvolved` and `/involved` answer 301 to `/get-involved`; events switch off gives 404 on `/whats-on` and no menu item; `addWhatsOnNavLink` is idempotent; `/whats-on` is in `RESERVED_PREFIXES` and on the site map; `/volunteer` and `/referrals` are not reserved and not routed.
- [ ] Run them and see them fail.
- [ ] Implement, calling `addWhatsOnNavLink` from `decorateNav` and the home route's events branches in `src/routes/site.ts`, not from `addEventsNavLink`. Add the bottom line "Looking for other ways to help? See everything you can do".
- [ ] Run the tests; update existing tests that name `/get-involved` for the events page, keeping their intent.
- [ ] Commit.

### Task 2: The new Get involved

**Files:** Create `get-involved.html`, `assets/css/get-involved.css`, `src/fundraising/get-involved-page.ts`. Modify `src/routes/fundraise-pages.ts`, `src/fundraising/film.ts` consumers (the film now renders here), `src/site/pages.ts`, emails or materials that promise an event is listed on Get involved (those point to What's on: `thanks-email.ts`, `materials.ts`, `material-codes.ts`; check each, and leave a link that simply means "get involved" alone). README. Test: `test/unit/get-involved-page.test.ts`; `features/`.

**Interfaces:** Produces `renderNewGetInvolvedPage(template, input: GetInvolvedInput & { fillStage?: string }): string`. Task 6 passes `fillStage`. Consumes the same deck renderer as Task 1, called once for both pages.

- [ ] Write failing tests: sections appear in the spec's order; there are no gift tags; the deck holds at most six cards and "See everything that's on" links to `/whats-on`; the same card appears on both pages; fundraising off drops the Fundraise section and the film, and the page still answers 200; events switch off is a 404; the film markup, captions and first-visit script are present; no "Who we are" button; the page has a "More ways to help" with links to the Task 3 addresses.
- [ ] Run them and see them fail.
- [ ] Implement from `hub.html` and `proto.css` in the prototype, with today's real cards. Wording from the spec. The links to `/get-involved/...` pages are built now; those pages arrive in Piece 2.
- [ ] Run the tests, then `npm run lint`, `npm run build`, and the affected unit tests.
- [ ] Take screenshots at 1280, 375 and 320 into `piece-1`, including the fundraising-off page.
- [ ] Commit.

## Piece 2: The short pages

### Task 3: Six pages under /get-involved/

**Files:** Create `get-involved-drop-off-points.html`, `-referrals.html`, `-volunteer.html`, `-business.html`, `-schools.html`, `-groups.html`, and `assets/css/short-pages.css`. Routes in `src/routes/fundraise-pages.ts` or a new `src/routes/get-involved-pages.ts`, mounted in `src/app.ts`. Site map. README. Test: `test/unit/get-involved-short-pages.test.ts`; `features/`.

- [ ] Write failing tests: each address answers 200 with its heading; the events switch does not gate them; none contains `tofill`, "Photo to come", "Prototype" or "families"; none has a video; "Fill" does not appear on the "together" pages; the business page has no payroll line; each has the master footer; `/volunteer` and `/referrals` still answer 302 through the spare address table.
- [ ] Run them and see them fail.
- [ ] Implement from the prototype with the spec's list of what is left out. Pictures already in the repo, or the prototype's crops of the real handover photo, optimised and added under `assets/img/` with width and height set. Copy `crop-*.jpg` as needed; no new real names.
- [ ] Tell-us forms: read `src/routes/` for the contact route and its captcha. Post through it, with the ticked interests in the message and a plain thank you. If it will not carry them cleanly, use a button to `/contact` and say so in the commit message.
- [ ] Run the tests, lint and build. Screenshots at 1280, 375, 320 into `piece-2`.
- [ ] Commit.

## Piece 3: The home page

### Task 4: The logo and the four tags

**Files:** Modify `index.html`. Create `assets/img/nbcc-logo-full.svg` (copy from the prototype), `assets/css/home-top.css`. README. Test: `test/unit/home-top.test.ts`.

- [ ] Write failing tests: the anchors are present byte for byte; `renderHomePromo(template, {gateOpen:true})` still adds the banner and feature, and the feature lands after the four tags; the hero still has "Donate now" and "What we do all year"; the logo image has alt text, width and height; four tags link to the live sign up sites and to the Task 3 pages; no peeking elf on the band; no `fb-` markup; home page weight stays inside any budget test.
- [ ] Run them and see them fail.
- [ ] Implement from `home.html` and `proto.css`, with the hero buttons kept and the door, parcel and Donate wording from the prototype. The tags section goes before `AFTER_HERO_ANCHOR`.
- [ ] Run the tests, lint and build. Screenshots with the Ball gate open at 1280, 375, 320 into `piece-3`.
- [ ] Commit.

## Piece 4: Stage 2, dormant

### Task 5: The clock, and the Ball coming down

**Files:** Create `src/site/after-ball.ts`. Modify `src/routes/site.ts` and the two page renderers. README. Test: `test/unit/after-ball.test.ts`.

**Interfaces:** Produces `AFTER_BALL_AT: Date`, `afterBall(now: Date): boolean`, `showAfterBall(now: Date, query: unknown): boolean` (true after the moment, or when `query.at === "after-ball"`).

- [ ] Write failing tests: `afterBall` is false at `2026-11-07T19:59:59Z`, true at `2026-11-07T20:00:00Z` and on 8 November; before the moment the home page has banner, feature and Ball menu item; after, none of them, and the file has no `ball-home-feature`; the Ball menu item is gone from a non-Ball page; the Festive Ball card is gone from `/whats-on` and Get involved; `/ball`, `/ball/terms` and `/ball/donate` still answer as they did; the Ball switch setting is never written; `?at=after-ball` shows the after state on that view only; a Ball page is byte for byte the same either side.
- [ ] Run them and see them fail.
- [ ] Implement, passing the clock in so tests can set it. The Ball card is identified by slug `festive-ball-2026`.
- [ ] Run the tests, lint and build.
- [ ] Commit.

### Task 6: The stage on Home and Get involved

**Files:** Create `src/red-bag/stage.ts`, `assets/js/red-bag-stage.js`, `assets/css/red-bag-stage.css`, `assets/img` copies as needed. Modify the home route, the Get involved render, and add the footer link in the way of `footer-link.ts`. README. Test: `test/unit/red-bag-stage.test.ts` (jsdom).

**Interfaces:** `renderFillStage(list: RedBagList): string` returns the band with its `rb-list-data` block. Consumes `showAfterBall`, `redBagList`/`loadPublishedRedBagList`. Keep a `.fb` class family as in the prototype.

- [ ] Write failing tests: before the moment neither page has the stage; after, it sits between hero and tags on Home, and after What's on on Get involved; prices come from a published fixture list that differs from the built-in one; a list with `socks` hidden has no socks tile; a list totalling under £50 still fills in the demonstration; the status comes from the catalogue; tapping changes the button to "Carry on with this bag" with `?bag=` in the link; the demonstration never carries; "Start again" clears it; a tap after a full bag starts another without losing what went before; with reduced motion nothing runs by itself and a tap works; Pause holds the demonstration; the footer gains "Fill a Red Bag" on non-Ball pages only.
- [ ] Run them and see them fail.
- [ ] Implement from `proto-fill.js` and the `.fb` rules in `proto.css`, which already handle all of the above. Bump the tiles' count of keys to those on the list. The script must load only when the stage is drawn.
- [ ] Run the tests, lint and build. Commit.

### Task 7: Carrying the bag through

**Files:** Modify `assets/js/red-bag.js`. Test: `test/unit/red-bag-carry.test.ts`.

**Interfaces:** Inside `initRedBag`: read `?bag=` once, after the rows are wired.

- [ ] Write failing tests: `?bag=toy:2,socks:1` gives those quantities and the right total; an unknown key is ignored; a huge number clamps through `clampQuantity`; `-1`, `abc`, an empty value and `<script>` text change nothing and raise no error; the address is tidied after reading; with reduced motion all appear at once; `fundraiserId`, checkout and the £2 floor code paths are unchanged.
- [ ] Run them and see them fail.
- [ ] Implement by the same `set` path the plus button uses, one at a time with a 380ms gap, using `history.replaceState`. This runs whether or not Stage 2 has begun: an address with `?bag=` only exists after it.
- [ ] Run the tests. Commit.

### Task 8: The night treatment on /fill

**Files:** Create `assets/css/fill-night.css`, `assets/js/fill-night.js`. Modify `src/red-bag/render.ts` and `src/routes/red-bag.ts`. README. Test: `test/unit/red-bag-night.test.ts`.

- [ ] Write failing tests: before the moment `/fill` is unchanged, byte for byte against today's render; after, it carries the stylesheet, script, sky, lights and sum; `?preview=draft` still works; `/fill/thank-you` is unchanged; the steppers, details step, bottom bar and Donate markup are all still there; with no canvas support or less motion the page works with no snow; lights count from the real total.
- [ ] Run them and see them fail.
- [ ] Implement from `fill-night.css` and `fill-night.js`, with the wrapper and heading changes made by `render.ts` only after the moment. Drive the lights and the sum from the page's own state rather than parsing text, if `red-bag.js` can offer a small hook.
- [ ] Run the tests, lint and build. Screenshots with `?at=after-ball` at 1280, 375, 320 into `piece-4`, including a full bag and a carried bag.
- [ ] Commit.
