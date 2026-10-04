# Elf Detective School A3: the screens, on pretend data: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The screens families use (the public calendar, Detective HQ with the daily guess, the elf wardrobe, the poster page for claiming an elf and checking in), built as real pages that run on pretend data, so NBCC can see and try them before anything is joined up.

**Architecture:** Each screen is a pure function from a view (plain data) to a whole HTML document, in `src/elf/pages/`, the way `src/ball/thank-you-page.ts` is. One stylesheet, `assets/css/elf.css`, and small browser scripts in `assets/js/elf-*.js` that only improve pages that already work without them. Nothing is mounted in `src/app.ts`: a stand-in server outside the repository feeds the same views and the same `/api/elf/*` shapes that Stage B will serve from the database.

**Tech Stack:** TypeScript string renderers, plain CSS on the site's tokens, browser scripts in the house style (an IIFE, `"use strict"`, `var` and `function` only, a CommonJS guard so jsdom tests can load them), Vitest with jsdom.

**The design:** `docs/superpowers/specs/2026-10-04-elf-detective-school-design.md` (decisions 3 to 8, 11 to 15 and "Rules, precisely"). The rules the screens show are in `src/elf/` (plans A1 and A2).

**Stage A rules:** new files only; nothing mounted, listed or wired; local commits on `elf-detective-school`; no push, no pull request. The repository is public: every name, place and photo in a test or in the pretend data is invented.

---

## Changed since this plan was written (read this first)

`src/elf/pages/types.ts` and the code are the last word. Where this plan differs:

- `shell.ts` is `elfPage({ title, description, cta, main, scripts, listed })`.
- A door's detail is `doorDetail(d, ctx)`, and a door links to its own detail at `#case-N`. There is no `?door=N` and no `selected`.
- A thing in the wardrobe unlocks at a number of doors DONE, so its padlock says "12 doors", not the door that opens it.
- The scripts hold a few words of their own, for things only the page can know: nothing ticked, nothing typed, no signal, no location. Every refusal from the server arrives as the server's words.
- `elf-hq.js` also ticks the countdown and fetches the page again when the clue is due.
- `icons.ts` has line icons (clock, cracked, rosette, pin, camera, padlock, tick) with `candyCane` and `gift` as functions of their own.
- `words.ts` also has `longDayWords`, `sameDay` and `sleepsUntil`.
- Jaimie's choices of 4 October: on a phone today's door shows its countdown; "Under 16? Bring a grown up with you to every hiding place." is in How it works and on the poster page; after six wrong words the staff phone NBCC; the judge of the grand prize is Jodie, Head Elf; staff check the check in photos of gold seal finishers before judging.
- Not built in Stage A: a badge to print (decision 13; Detective HQ shows the badge number and rank), and photo cleaning (it needs the upload it belongs to).

## What Jaimie has already seen

The calendar and the wardrobe were sketched on the plan page Jaimie signed off (decisions 12 to 14). These screens keep that look: a walnut board of 24 oak doors with a shape carved into each; a found door opens to cream paper; marks for "you cracked it" (magnifying glass) and "you've been there" (candy cane); pills for Today, Tomorrow and Big prize; the wardrobe with Pieces and Outfits, colour dots, a faint drawing and a padlock for anything still locked, and "New" tags.

What changes from the sketch, and why:

- **The site's own type.** The sketch used a display face that the site does not have. NBCC's brand is Playfair Display and Poppins, served to every page and held to two font files (`.impeccable.md`). The screens use them.
- **A found door shows the winner's elf.** The sketch showed a grey box until staff had checked a photo. A detective's dressed elf is never a child's photo, so it can go up at once, and the photo replaces it only when a grown up has said yes and staff have checked it.
- **The detail opens under the door's own row.** On a phone the sketch's panel sat below all 24 doors, a long way from the door that was tapped.

## Design direction

The audience is a parent on a phone, often outside on a December evening with children looking over their shoulder, and the same family at home on the sofa dressing an elf. The tone is NBCC's: warm, plain spoken, never slick (`.impeccable.md`).

- **One loud thing a page.** The page is NBCC cream with crimson Playfair headings. The wooden board is the only heavy object on the calendar; the elf is the only one on the wardrobe; the gold "You're first!" card is the only one on the claim result.
- **Light theme**, like the rest of the site. The nav stays solid cream because the red logo sits on cream only.
- **New colours are the wood and the gold**, scoped to `.elf-page` in `elf.css`. Everything else is a token from `styles.css`.
- **Motion marks a change of state and nothing else:** a door opening when an elf is found, a present opening when something unlocks, a stamp landing, the "You're first!" burst. Transform and opacity only, easing that slows to a stop, and none of it under `prefers-reduced-motion`.
- **Phone first.** Four doors across at 375 pixels, six from 640, eight from 981. Every touch target is at least 44 pixels. Nothing scrolls inside a box: content wraps and the page grows.
- **Words.** Plain English, no dashes and no hyphenated words in anything people read, "could" for anything money might do, `Elves' Workshop` for the building.

## Views: what a screen is given

Defined in `src/elf/pages/types.ts`, which is the last word where it and this summary differ (it has since gained a few fields, such as each detective's `wardrobeUrl`). Stage B builds these from the database; the stand-in builds them from pretend data. A screen never works a rule out for itself: the view already holds the answer.

A door's detail is in the page, straight after its door, for all 24 doors. With no script the stylesheet shows the one a door links to (`:target`); with the script a tap opens it in place. So there is no `?door=` and no server round trip to open a door.

```ts
import type { Door } from "../calendar";
import type { DoorState } from "../doors";
import type { Rank } from "../progress";

/** One door as the public calendar shows it. The same for every visitor, so it can be cached. */
export interface DoorView {
  door: Door;
  state: DoorState;
  /** When the clue comes out. */
  clueAt: Date;
  /** The picture of the prize shape to carve into the door, or null for the mystery star. */
  shapeUrl: string | null;
  /** Staff ticked "Show off": the door wears a Big prize ribbon and the teaser is shown. */
  bigPrize: boolean;
  teaser: string | null;
  /** The name of this door's elf. */
  elfName: string;
  /** Where it was hiding. Null until the door is open. */
  place: { name: string; town: string } | null;
  /** Who found it. Null until it is found. `by` comes from `detectiveNames` in src/elf/names.ts, so
   *  a first name staff have not ticked yet is only its first letter. */
  found: { at: Date; by: string; elfUrl: string; photoUrl: string | null } | null;
  /** How many detectives cracked it and how many have visited. Null until the door is open. */
  counts: { cracked: number; visited: number } | null;
  /** The short NBCC fact for children. Null until the door is open. */
  factLine: string | null;
}

export interface CalendarView {
  year: number;
  now: Date;
  doors: DoorView[]; // all 24, door 1 first
  /** Every hiding place, public from the start, without its day. */
  places: { name: string; town: string; found: boolean }[];
  /** What the price words say: "from £1" and "£5". Set in the admin. */
  price: { from: string; suggested: string };
  joinUrl: string;
  hqUrl: string;
}

/** A family's own marks on the calendar. Private, small, fetched by the page's script. */
export interface FamilyMarks {
  doors: { door: Door; cracked: boolean; visited: boolean }[];
}

export interface DetectiveView {
  id: string;
  name: string; // "Detective Ruby Tinselfoot"
  badgeNumber: string;
  rank: Rank;
  doorsDone: number;
  next: { rank: Rank; toGo: number } | null;
  graduate: boolean;
  goldSeal: boolean;
  elfUrl: string;
  /** How many things in the wardrobe have not been tried on yet. */
  newThings: number;
}

export interface TodayView {
  door: Door;
  state: DoorState;
  clueAt: Date;
  /** The clue, once it is out. */
  clue: string | null;
  /** The places a family can still guess from. */
  options: { id: string; name: string; town: string }[];
  /** The family's guess so far. */
  guessId: string | null;
}

export interface HqView {
  now: Date;
  familyName: string; // the grown up's first name, for the greeting
  detectives: DetectiveView[];
  today: TodayView | null; // null outside 1 to 24 December
  marks: FamilyMarks;
  calendarUrl: string;
}

export interface WardrobeView {
  detective: DetectiveView;
  look: ElfLook; // from src/elf/wardrobe
  state: WardrobeState;
  /** "style colour" and outfit ids not tried on yet. */
  fresh: string[];
  hqUrl: string;
}

export interface PosterView {
  /** The place's own code from its poster. The page never says which door it belongs to. */
  code: string;
  placeName: string;
  /** Only what the public calendar already shows: is this place's door open? */
  open: boolean;
  /** Is the elf still there to be claimed? True unless the door is found. */
  claimable: boolean;
  signedIn: boolean;
  detectives: { id: string; name: string; hasStamp: boolean }[];
  joinUrl: string;
}
```

## The pretend API (what the scripts call)

| Call | Answers | Used by |
|---|---|---|
| `GET /api/elf/calendar` | `{ now, found: number, status, doors: [{ door, v }] }` (`now` is the server's time; `status` is `calendarStatus(view)` for the news card). `v` changes whenever a door's tile would. Small and cached. | calendar script, every few seconds |
| `GET /api/elf/door/:n` | `{ tile: string, detail: string }`: that door's HTML, drawn by the same functions as the page. | calendar script, only for a door whose `v` changed |
| `GET /api/elf/me` | `FamilyMarks`, or 401 when nobody is signed in. | calendar script |
| `POST /api/elf/guess` | `{ ok: true }` or `{ ok: false, reason }` (`decideGuess`). | HQ script |
| `POST /api/elf/look` | Sent `{ detectiveId, look, tried }` (`tried`: what has just been tried on, so its "New" tag can go). Answers `{ ok: true, look }`: the look as saved, after `normaliseLook` against what the detective has earned in the database, never what the page says. | wardrobe script, by itself once the choices settle |
| `POST /api/elf/claim` | Sent `{ code, detectiveIds, word }`. Answers `{ ok: true, html }` (the "You're first!" card, drawn by `claimWinHtml`) or `{ ok: false, reason, message, triesLeft? }`, where `message` is `claimRefusalWords(reason, triesLeft)`: the script shows the server's words and holds none of its own. | poster script |
| `POST /api/elf/stamp` | Sent as JSON `{ code, detectiveIds, location: { lat, lng } }`, or as a form with a `photo` file and one `detective` field for each detective. Answers `{ ok: true, html }` (`stampWinHtml`) or `{ ok: false, reason, message }` (`stampRefusalWords`). | poster script |

One renderer for a door, on the server. The script never builds a door from data, so the page and its live updates cannot drift apart.

## File structure

| File | What it is |
|---|---|
| `src/elf/words.ts` | Times, dates and lists as people read them: `clockWords`, `dayWords`, `countdownWords`, `listWords`, `things`. London time. Pure. |
| `src/elf/pages/types.ts` | The views above. Types only. |
| `src/elf/pages/icons.ts` | The few inline SVG icons (magnifying glass, candy cane, clock, padlock, rosette, pin, camera, star). |
| `src/elf/pages/shell.ts` | `elfPage({ title, description, body, scripts })`: the whole document, with the cut down nav and the legal footer. |
| `src/elf/pages/door.ts` | `doorTile(d, now)`, `doorPanel(d, now)`, `doorLabel(d, now)`: one door and its opened out detail. |
| `src/elf/pages/calendar.ts` | `renderCalendarPage(view)`. |
| `src/elf/pages/hq.ts` | `renderHqPage(view)`: the family's detectives, today's clue and guess, their marks. |
| `src/elf/pages/wardrobe.ts` | `renderWardrobePage(view)`. |
| `src/elf/pages/poster.ts` | `renderPosterPage(view, outcome?)`, `posterState(doorState)`, `claimWinHtml(win)`, `stampWinHtml(win)`, `claimRefusalWords(reason, triesLeft?)`, `stampRefusalWords(reason)`. |
| `assets/css/elf.css` | Every style for these screens, scoped to `.elf-page`. |
| `assets/js/elf-calendar.js` | Opens a door's detail under its row, ticks the countdown, fetches changed doors, lays the family's marks over the board. |
| `assets/js/elf-hq.js` | Saves the guess without leaving the page. |
| `assets/js/elf-wardrobe-ui.js` | Tries things on (drawing with `window.NBCCElf`), clears "New" tags, saves the look. |
| `assets/js/elf-poster.js` | Sends a claim or a check in (location once, or a photo) and shows the answer. |
| `test/unit/elf-words.test.ts`, `elf-page-*.test.ts`, `elf-js-*.test.ts`, `elf-pages-house-rules.test.ts` | Tests. |

Outside the repository, in the session's scratchpad: `elf-a3/standin.mts` (a small server that draws the pages from pretend data and answers the pretend API) and the pretend data itself.

## House rules a renderer must meet (tested in `elf-pages-house-rules.test.ts`)

The site's page tests read root `*.html` files only, so these pages carry their own copies of the same rules:

- one `<main class="site-main" id="main">`, a skip link first in the body, a `.wrap` inside every section;
- every `<img>` has `alt`, `width` and `height`; every form control has a `<label for>`;
- no `on...=` attributes and no inline `<script>` text: scripts are files;
- in the words people read (text, `alt`, `title`, `aria-label`, `placeholder`): no en or em dash, and no hyphen between two word characters, except inside a person's name or a place's name that came from data;
- `Elves' Workshop` is the only spelling of the building;
- every value from data is escaped;
- `elf.css` has no `overflow: auto` or `overflow: scroll`, and wraps every animation in `prefers-reduced-motion: no-preference` or switches it off under `reduce`.

## How this plan is carried out

Plan A1 was handed to one implementer for each task. Screens are different: looking at them and adjusting them is the work, so they are built in the main session, test first for everything that can be tested (the words, what each state shows, what each script does), and by eye in the stand-in for everything that cannot. Independent reviewers then check the result three ways: against the design, as code, and as screens.

---

### Task 1: Words

**Files:** Create `src/elf/words.ts`, `test/unit/elf-words.test.ts`.

- [ ] Write the tests first: `clockWords` gives "5:30pm", "10am" and "12 noon" in London time; `dayWords` gives "Mon 7 Dec"; `countdownWords` gives "2:14:09", "0:05" under a minute and "0:00" for anything past; `listWords` gives "A", "A and B", "A, B and C"; `things(1, "door")` gives "1 door" and `things(3, "door")` "3 doors".
- [ ] Run them and see them fail. Write `words.ts`. Run them and see them pass.
- [ ] Commit: `Elf Detective School: times and lists as people read them`.

### Task 2: The page shell, the icons and one door

**Files:** Create `src/elf/pages/types.ts`, `icons.ts`, `shell.ts`, `door.ts`, `test/unit/elf-page-door.test.ts`.

- [ ] Tests first, for each state of a door (shut, tomorrow, big prize, today before the clue, hunting, found, found with a photo, revealed): the tile's `aria-label` in full words, the pill, the carved shape or the mystery star, the winner's elf or photo, the panel's heading and lines, and that a place's name never appears before the door is open.
- [ ] Write the code. Run the tests.
- [ ] Commit: `Elf Detective School: the page shell and one door`.

### Task 3: The calendar page

**Files:** Create `src/elf/pages/calendar.ts`, `assets/css/elf.css`, `test/unit/elf-page-calendar.test.ts`.

- [ ] Tests first: 24 doors in order; the count of elves found; today's status in the header for each state; the selected door's panel in the page when `selected` is set; each door a link to `?door=N` so the page works with no script; the list of hiding places with no days; the join band with the price words; nothing private in the page.
- [ ] Write the page and the styles. Run the tests.
- [ ] Commit: `Elf Detective School: the public calendar`.

### Task 4: The calendar's script

**Files:** Create `assets/js/elf-calendar.js`, `test/unit/elf-js-calendar.test.ts` (jsdom).

- [ ] Tests first: tapping a door opens its panel under that door's row and moves focus to it; tapping it again closes it; the countdown ticks and stops at nought; a door whose `v` changed is fetched and swapped, and gains the opening class; family marks are laid over the board; a failed fetch changes nothing and tries again later; the timer stops while the page is hidden.
- [ ] Write the script. Run the tests.
- [ ] Commit: `Elf Detective School: the calendar comes alive`.

### Task 5: See it

- [ ] Write the stand-in and the pretend data in the scratchpad. Open the calendar at 375, 768 and 1280 pixels wide. Look at every state. Fix what looks wrong. Show Jaimie.

### Task 6: Detective HQ and the daily guess

**Files:** Create `src/elf/pages/hq.ts`, `assets/js/elf-hq.js`, `test/unit/elf-page-hq.test.ts`, `test/unit/elf-js-hq.test.ts`.

- [ ] Tests first: each detective's card (name, badge number, rank, doors done, what comes next); today's clue only once it is out; the guess as radio buttons over the places still in play, with the family's guess picked; the words for each state (before the clue, hunting, found, revealed); the family's marks on a small board; the script saving a guess and saying so.
- [ ] Write them. Run the tests. Look at it in the stand-in. Commit.

### Task 7: The wardrobe

**Files:** Create `src/elf/pages/wardrobe.ts`, `assets/js/elf-wardrobe-ui.js`, tests.

- [ ] Tests first: Pieces and Outfits as two groups; a tile for every style with its three colours; a locked colour drawn faint with a padlock and the door that unlocks it; "New" on what has not been tried; the page shows the saved look with no script; the script changes the elf at a tap, never offers what is locked, and saves.
- [ ] Write them. Run the tests. Look at it. Commit.

### Task 8: The poster page: claim an elf, check in

**Files:** Create `src/elf/pages/poster.ts`, `assets/js/elf-poster.js`, tests.

- [ ] Tests first: the page for a place looks the same whether its elf is out today or not (the same HTML for a shut door and a hunting door); a visitor who is not signed in is asked to join; the claim form's tick boxes and word box; each answer's words (first, wrong word with tries left, too many tries, too early, already found, already won); the check in offers location and photo only once the door is open; each stamp answer's words.
- [ ] Write them. Run the tests. Look at it. Commit.

### Task 9: House rules, then the reviews

- [ ] `test/unit/elf-pages-house-rules.test.ts` over every renderer and `elf.css`.
- [ ] Every elf test, the guards that read the whole repository, `npm run lint`, `npm run build`.
- [ ] `git diff --stat origin/main...HEAD` shows only `docs/superpowers/`, `src/elf/`, `test/unit/elf-*`, `assets/js/elf-*` and `assets/css/elf.css`.
- [ ] Independent reviews: against the design, of the code, and of the screens themselves (the design skills' audit and polish).

## Not in this plan

Joining and paying, signing in, uploads, the admin, emails, and the database behind all of it (Stage B). The print pages (plan A4).
