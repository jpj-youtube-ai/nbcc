# Events Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved events prototype into a database-backed page that staff build from the admin, shipped switched off behind an admin-only on/off switch.

**Architecture:** One pure renderer (`src/events/render.ts`) produces the approved card markup from event rows; the public `/events` route and the admin's preview endpoint both call it. Events, pictures and the switch live in three new tables. The switch gates the route, the menu link (injected the way the Festive Ball link is) and the sitemap entry.

**Tech Stack:** Express + TypeScript, node-pg-migrate, Zod, Vitest (jsdom for markup), Cucumber BDD against a live server, vanilla JS admin (`assets/js/admin/app.js`).

**Spec:** `docs/superpowers/specs/2026-09-30-events-page-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `src/events/model.ts` (create) | Types, allowed values, Zod input schema, slug, London "today", page visibility and order. Pure. |
| `src/events/render.ts` (create) | Event row to card HTML; the face down card; the deck; filling the page template. Pure. |
| `src/events/nav-link.ts` (create) | Insert the Events menu item after About in the main nav only. Pure, idempotent. |
| `src/db/events.ts` (create) | All SQL: settings, events CRUD with audit rows, page query, images. |
| `src/routes/events.ts` (create) | Public: `GET /events`, `GET /media/events/:id`. |
| `src/routes/admin-events.ts` (create) | Admin API: list, create, update, delete, switch, preview, image upload. |
| `src/site/pages.ts` (modify) | `/events` in the registry (gated), reserved prefix, sitemap filters take `eventsOn`. |
| `src/routes/site.ts`, `src/routes/ball.ts` (modify) | Add the Events menu item when the switch is on; pass `eventsOn` to the sitemaps. |
| `src/app.ts` (modify) | Mount both routers; larger JSON limit for the image upload path. |
| `src/admin/permissions.ts`, `assets/js/admin/app.js`, `features/steps/admin-permissions.steps.js` (modify) | New `events` section, editors edit by default. |
| `migrations/1789100000000_events.js` (create) | `events_settings`, `event_images`, `events`. |
| `migrations/1789100000001_permissions-events.js` (create) | Give stored permission matrices the `events` default. |
| `migrations/1789100000002_events-seed.js` (create) | EmpowHer '26 and the Festive Ball, idempotent. |
| `events.html` (modify) | Becomes the template: the deck holds a marker the server fills. |
| `assets/js/events.js` (modify) | Event delegation so re-rendered decks work; `window.nbccEvents` for the admin preview. |
| `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css` (modify) | The Events view, as in the approved mock-up. |
| `Dockerfile` (modify) | Ship `events.html`. |
| `README.md` (modify) | Routes, admin section, switch, tables. |
| Tests (create) | `test/unit/events-model.test.ts`, `events-render.test.ts`, `events-nav-link.test.ts`; `features/events.feature` + `features/steps/events.steps.js`; updates to `events-page.test.ts`, `site-pages.test.ts`, permission tests. |

## Contracts shared across tasks

```ts
// src/events/model.ts
export const FLAGS = ["", "Spaces limited", "Selling fast", "Last few tickets", "Sold out", "Free entry", "Family friendly"] as const;
export const FRONT_CREDITS = ["Organised by", "Hosted by", "In partnership with"] as const;
export const BACK_CREDITS = ["Organised by", "Organised and sponsored by", "Organised and paid for by", "Hosted by"] as const;
export const ACCESS = ["step free entry", "accessible toilets", "a hearing loop", "blue badge parking"] as const;
export type EventStatus = "draft" | "live" | "scheduled";
export interface EventRecord {
  id: number; slug: string; name: string; subtitle: string; gist: string;
  date: string;            // YYYY-MM-DD
  start: string | null;    // HH:MM
  end: string | null;      // HH:MM
  timeTbc: boolean; venue: string; town: string; address: string; access: string[];
  imageSrc: string | null; imageFit: "cover" | "whole"; imageGround: "night" | "cream" | "crimson" | "holly"; imageAlt: string;
  cover: "crimson" | "holly" | "maroon"; costFront: string; costBack: string; flag: string;
  listHeading: string; whatsOn: string; note: string;
  runBy: "nbcc" | "partner"; partnerName: string; partnerFront: string; partnerCredit: string; partnerLogoSrc: string | null; partnerLine: string;
  bookingHow: "site" | "away" | "none"; bookingUrl: string; bookingLabel: string; bookingNote: string;
  status: EventStatus; showFrom: string | null;
}
export type EventInput = Omit<EventRecord, "id" | "slug">;
export const eventInputSchema: z.ZodType<EventInput>;
export function slugify(name: string, date: string): string;
export function londonToday(now: Date): string;                 // YYYY-MM-DD in Europe/London
export function isOnPage(ev: Pick<EventRecord, "status" | "showFrom" | "date">, today: string): boolean;
export function sortForPage<T extends Pick<EventRecord, "date" | "start" | "name">>(events: T[]): T[];

// src/events/render.ts
export function renderCard(ev: EventRecord, idPrefix?: string): string;
export function renderMoreCard(): string;
export function renderDeck(events: EventRecord[], idPrefix?: string): string;   // cards + face down card
export const DECK_MARKER = "<!-- events:deck -->";
export function renderEventsPage(template: string, events: EventRecord[]): string;

// src/events/nav-link.ts
export const EVENTS_NAV_ITEM = '<li><a href="/events">Events</a></li>';
export function addEventsNavLink(html: string): string;
```

---

### Task 1: The pure event model

**Files:** Create `src/events/model.ts`; Test `test/unit/events-model.test.ts`.

- [ ] **Step 1: Write the failing tests.** Cases:
  - a complete valid input parses; strings are trimmed;
  - `flag` outside `FLAGS` is refused; `partnerFront`/`partnerCredit` outside their lists are refused;
  - `imageSrc` accepts `/media/events/<uuid>` and `/assets/img/ball-lockup.svg`, refuses `https://evil.example/x.png`, `javascript:alert(1)`, `/media/events/../x`;
  - `bookingUrl` with `bookingHow: "away"` accepts `https://adautocare.co.uk/empowher`, refuses `javascript:alert(1)` and `/ball`; with `"site"` accepts `/ball#tickets`, refuses `//evil.example` and `https://x`; with `"none"` accepts empty;
  - `status: "scheduled"` without `showFrom` is refused;
  - `date` must be a real calendar date (`2026-02-30` refused);
  - `end` earlier than `start` is refused;
  - `slugify("EmpowHer ’26", "2026-11-04")` is `empowher-26-2026-11-04`;
  - `londonToday(new Date("2026-10-24T23:30:00Z"))` is `2026-10-25` (BST) and `londonToday(new Date("2026-12-01T23:30:00Z"))` is `2026-12-01` (GMT);
  - `isOnPage`: live and today is on; live and yesterday is off; draft is off; scheduled before `showFrom` off, on or after on;
  - `sortForPage` orders by date, then start (no time last), then name.
- [ ] **Step 2:** `npx vitest run test/unit/events-model.test.ts` fails (module missing).
- [ ] **Step 3:** Implement `src/events/model.ts` to the contract above.
- [ ] **Step 4:** Re-run: all pass.
- [ ] **Step 5:** Commit `[TASK-453] Events: the model, validation and page rules`.

### Task 2: The renderer, and events.html as a template

**Files:** Create `src/events/render.ts`; Modify `events.html`; Test `test/unit/events-render.test.ts`; Modify `test/unit/events-page.test.ts` (markup tests now run on `renderEventsPage(template, SEED)`).

- [ ] **Step 1: Write the failing tests.** Cases:
  - the Ball seed renders front + back with the same classes as the approved prototype (`ev-card`, `ev-front`, `ev-back`, `ev-index`, `ev-art--whole`, `ev-art--night`, `ev-facts`, `ev-list`, `ev-organiser`, `ev-book`);
  - EmpowHer (no picture) renders the type cover with `’26` wrapped in a span and the holly class;
  - every user string is escaped: a name of `<script>` renders as `&lt;script&gt;`;
  - `*bold*` becomes `<b>bold</b>` after escaping (`*<i>*` stays escaped);
  - booking `away` renders `target="_blank" rel="noopener"`, the new tab note and the booking note; `none` renders "No need to book";
  - `renderDeck([])` is just the face down card; `renderDeck` always ends with it;
  - `renderEventsPage` replaces `DECK_MARKER` and nothing else; a template without the marker comes back unchanged;
  - the time text: `18:00`-`22:00` is "6pm to 10pm", `19:30` alone is "from 7.30pm", TBC adds "(to be confirmed)" on the back only, `12:00` is "12 noon".
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Implement `render.ts`, porting the mock-up renderer (the markup in `events.html`) to TypeScript. Replace the three static `<li>` cards in `events.html` with `<!-- events:deck -->`.
- [ ] **Step 4:** Update `events-page.test.ts` to build the document from `renderEventsPage(template, SEED_EVENTS)` (a fixture exported from the test helpers mirroring the seed migration). All pass.
- [ ] **Step 5:** Commit `[TASK-453] Events: one renderer for the page and the admin preview`.

### Task 3: The menu link and the sitemap

**Files:** Create `src/events/nav-link.ts`, `test/unit/events-nav-link.test.ts`; Modify `src/site/pages.ts`, `test/unit/site-pages.test.ts`.

- [ ] **Step 1: Failing tests.** `addEventsNavLink` inserts after the About item of the main nav list (not the footer's), is idempotent, leaves a page without a nav unchanged, and composes with `addBallNavLink` in either order. Sitemap: `/events` absent from tree and xml when `eventsOn` is false, present when true; `aliasFromProblem("/events")` refuses.
- [ ] **Step 2:** Fail. **Step 3:** Implement; add `{ path: "/events", title: "Events", listedByDefault: true, eventsGated: true }` and `"/events"` to `RESERVED_PREFIXES`; add an optional `eventsOn = false` last parameter to both renderers. **Step 4:** Pass. **Step 5:** Commit.

### Task 4: Migrations

**Files:** Create the three migrations named in the file table.

- [ ] **Step 1:** `migrations/1789100000000_events.js`: `events_settings (id int primary key check (id = 1), page_on boolean not null default false, updated_at timestamptz not null default now(), updated_by text)` plus its one row; `event_images (id uuid primary key, mime text not null, bytes bytea not null, byte_size int not null, uploaded_by int, created_at timestamptz not null default now())`; `events` with a column per `EventRecord` field, CHECK constraints for every enumerated column, `slug text not null unique`, `created_at/updated_at timestamptz not null default now()`, `created_by/updated_by text`, and an index on `(status, event_date)`.
- [ ] **Step 2:** `migrations/1789100000001_permissions-events.js`: the business-supporters pattern; admins and editors `edit`, everyone else `view`.
- [ ] **Step 3:** `migrations/1789100000002_events-seed.js`: insert both events `ON CONFLICT (slug) DO NOTHING`; the Ball's picture is `/assets/img/ball-lockup.svg` (whole, night), its logo `/assets/img/the-designer-rooms.png`.
- [ ] **Step 4:** `ls migrations | sort | tail -3` shows these three last.
- [ ] **Step 5:** Commit.

### Task 5: The database module

**Files:** Create `src/db/events.ts`.

- [ ] Functions: `getEventsSettings()`, `setEventsPageOn(on, actor)`, `listAllEvents()`, `getEvent(id)`, `createEvent(input, actor)`, `updateEvent(id, input, actor)`, `deleteEvent(id, actor)`, `listPageEvents(today)`, `insertEventImage(mime, bytes, userId)`, `getEventImage(id)`. Every write goes through `writeWithAudit` with actions `events.page_switched`, `events.created`, `events.updated`, `events.deleted` and entity `event` / `events_settings`. Slugs are unique: on collision append `-2`, `-3`.
- [ ] Commit.

### Task 6: The permission section

**Files:** Modify `src/admin/permissions.ts`, `assets/js/admin/app.js` (`SECTIONS`, `OPERATIONAL_EDITOR_SECTIONS`), `features/steps/admin-permissions.steps.js`; tests `admin-permissions.test.ts`, `admin-sections-in-sync.test.ts`.

- [ ] Failing test: editors get `events: "edit"`, viewers `"view"`. Implement, run, commit.

### Task 7: Public routes and the switch's reach

**Files:** Create `src/routes/events.ts`; Modify `src/app.ts`, `src/routes/site.ts`, `src/routes/ball.ts`, `Dockerfile`; Create `features/events.feature`, `features/steps/events.steps.js`.

- [ ] **Step 1: Failing BDD.** Scenarios: switch off gives 404 for `/events` and no `href="/events"` in the home nav; switch on gives 200 with the seeded cards in date order and the home, about and ball navs carry the link after About; a draft, a past event and a not-yet-scheduled event are absent; `/sitemap.xml` lists `/events` only when on; `/media/events/<unknown uuid>` is 404 and a non-uuid is 404.
- [ ] **Step 2:** Implement: `GET /events` reads the switch, falls through with `next()` when off, else renders; `Cache-Control: no-cache` like the ball page. Nav injection in the home route (both branches), the `_redirects` loop, `/supporters` and the ball page route. `eventsOn` passed to both sitemap renderers. `events.html` added to the Dockerfile `COPY` line.
- [ ] **Step 3:** `npm run build`, unit tests pass; BDD runs in CI.
- [ ] **Step 4:** Commit.

### Task 8: The admin API

**Files:** Create `src/routes/admin-events.ts`; Modify `src/app.ts`; extend `features/events.feature`.

- [ ] Routes: `GET /api/admin/events` (events:view) returns `{ pageOn, events }`; `POST /api/admin/events` and `PUT /api/admin/events/:id` (events:edit) validate with `eventInputSchema` and return the saved record; `DELETE /api/admin/events/:id` (events:edit); `PATCH /api/admin/events/settings` (events:edit AND role admin) `{ pageOn }`; `POST /api/admin/events/preview` (events:view) `{ event, id? }` returns `{ card, page }` HTML documents for the iframes; `POST /api/admin/event-images` (events:edit) base64 upload, `validateUpload`, returns `{ id, src }`. `app.use("/api/admin/event-images", express.json({ limit: IMAGE_JSON_BODY_LIMIT }))` before the global parser.
- [ ] BDD: no token gives 401; an editor flipping the switch gets 403; an admin creates, updates, publishes and deletes an event and each leaves an audit row; invalid input gives 400 with the field named.
- [ ] Commit.

### Task 9: The admin screen

**Files:** Modify `admin.html` (nav button under Content after Partners; `view-events` section), `assets/js/admin/app.js` (loader in `selectView`, list, form binding, debounced preview into two iframes sized to content, save/publish/delete, switch, image upload reusing the newsletter shrink), `assets/css/admin.css` (the mock-up's styles, scoped under `#view-events`).

- [ ] Port the mock-up. The switch shows its state in words and asks for confirmation before turning the page on or off. Only admins see the switch button; others see its state.
- [ ] Unit test: the admin shell lists the Events tab under Content with `data-view="events"`; nothing inside the view uses `overflow: auto` or `scroll`.
- [ ] Drive it in the browser against the local server with a seeded database, or by the headless screenshot harness against a static render when no database is available.
- [ ] Commit.

### Task 10: The prototype script, README, verification, ship

- [ ] `assets/js/events.js`: delegate clicks from the deck element, `resetCards(deck)` for re-renders, `window.nbccEvents = { initDeck, setFace, resetCards }`. Keep the jsdom tests green.
- [ ] README: the route, the switch, the admin section, the three tables, the seed.
- [ ] `npm run lint && npm run build && npm run test:unit` (the Windows-only perf-budget CRLF failure is known and not real).
- [ ] `/ship`: re-check the task number immediately before opening the PR; watch `pr.yml` to green; merge; watch the production deploy. The switch is off, so nothing appears on the public site until an admin turns it on.

## Self-review

- Spec coverage: switch (Tasks 5, 7, 8, 9), events CRUD and statuses (1, 5, 8, 9), past events (1, 7), pictures (4, 5, 8, 9), permissions (4, 6), seed (4), menu and sitemap (3, 7), reserved path (3), Dockerfile (7), audit (5, 8), tests throughout. No gaps.
- Placeholders: none.
- Names: `EventRecord`, `eventInputSchema`, `isOnPage`, `sortForPage`, `renderDeck`, `renderEventsPage`, `DECK_MARKER`, `addEventsNavLink` are used consistently.
