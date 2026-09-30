# Admin > Analytics page (TASK-482) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin > Analytics shows, for the last 7, 30 or 90 days next to the period before, how many
people visited, where they came from, where they are, what they looked at and clicked, what they
used, and who is on the site right now; with the collecting switch at the top.

**Architecture:** One SQL module (`src/db/analytics-report.ts`) reads the slim rows of both periods
(views, clicks grouped by day, kind and label, newsletter titles, the last 5 minutes). One pure module
(`src/analytics/report.ts`) turns rows into every panel: the periods, visits split at a 30 minute gap,
bounce, averages ignoring nulls, entry pages, channels, places, devices. The route
(`src/routes/admin-analytics.ts`) gates on `analytics` view/edit and returns one payload. The page is
plain JS in `app.js`, a view in `admin.html`, styles in `admin.css`, in the Events page's idiom.

**Tech Stack:** Express + TypeScript, pg, Vitest (+ jsdom harness), Cucumber (CI only). No new
dependencies.

Builds on #602 (TASK-479): `analytics_views`, `analytics_clicks`, `analytics_settings`,
`getAnalyticsSettings`, `setCollecting`, `pulseSwitch.forget()`, the `analytics` permission.

---

### Task 1: the pure report (`src/analytics/report.ts`)

**Files:** Create `src/analytics/report.ts`; Test `test/unit/analytics-report.test.ts`.

- `periodsFor(today: string, days: 7|30|90)` returns `{ current: {from,to}, previous: {from,to} }`,
  inclusive UK days, the previous period the same length ending the day before.
- `splitVisits(views)` groups by `(day, visitor)`, orders by `at`, starts a new visit when the gap to
  the previous view is MORE than 30 minutes. A visit is `{ views[], entry: views[0] }`.
- `buildPanels(views, clicks, period)` returns headline `{visitors, visits, views, bounceShare}`,
  `daily[]` (every day of the period, zero filled), `channels[]` (visits by the entry view's
  channel), `otherWebsites[]` (visits by source, other_websites only), `newsletters[]` (visits by
  campaign, newsletter only), `cities[]`, `countries[]`, `pages[]` (views, visitors, average active
  seconds and scroll ignoring nulls, entry share of all visits), `clickKinds[]`, `clicks[]`,
  `devices[]`, `browsers[]`. Visitors everywhere are distinct `(day, visitor)` pairs.
- `countryName(code)` via `Intl.DisplayNames('en', { type: 'region' })`, the code itself if unknown.
- `labelNewsletters(rows, titles)` swaps a numeric campaign for its newsletter's subject.

TDD: write each test with invented rows first (split exactly at 30 minutes stays one visit, 31 splits;
a one view visit is a bounce; nulls ignored in averages; the entry page is the first by time; the
previous period is the same length and ends the day before), watch it fail, implement, pass, commit.

### Task 2: SQL (`src/db/analytics-report.ts`)

`readAnalyticsReport(days, now)`: one query for views over both periods, one for clicks grouped by
day, kind, label, one for newsletter subjects where campaigns are numeric ids, one for right now
(`count(DISTINCT visitor)` where `at > now() - interval '5 minutes'`). Returns
`{ days, current, previous, rightNow, generatedAt }`. Covered by the BDD scenario against Postgres.

### Task 3: the route (`src/routes/admin-analytics.ts`, mounted in `src/app.ts`)

- `GET /api/admin/analytics?days=` (analytics view): 400 for anything but 7, 30, 90 (default 30).
- `GET /api/admin/analytics/settings` (analytics view): `getAnalyticsSettings()`.
- `PUT /api/admin/analytics/settings` (analytics edit), `{ collecting: boolean }` strict:
  `setCollecting(collecting, actorOf(claims))`, then `pulseSwitch.forget()`.
- Test `test/unit/admin-analytics-routes.test.ts`: 401 without a session, 403 for a viewer and an
  editor (analytics none), 200 for view, 403 on PUT with view only, 200 on PUT with edit and
  `forget` called, 400 on a bad body or bad days.

### Task 4: the page (admin.html, app.js, admin.css)

- Nav item `data-view="analytics"` in the Admin group; the group label shows for team or analytics.
- View `#view-analytics`: switch card (`.an-switch`, like `.ev-switch`), period chips
  (`.admin-segmented`), figures (`.admin-stats` with change lines), the line (inline SVG with a
  screen reader summary), then panels in a two column grid that is one column on a phone.
- Lists show the top 10 and a "Show all" button that grows the page. No inner scrollbars.
- Empty: "Not enough visits yet". Failure: "could not load". The DB-IP credit under the places.
- Test `test/unit/admin-analytics-page.test.ts` (jsdom harness): nav gating, switch read only vs
  editable and the PUT it sends, every panel empty, failed and filled, Show all.

### Task 5: BDD, README, checks, browser

- `features/analytics-admin.feature` + `features/steps/analytics-admin.steps.js`: the page needs the
  permission; an admin flips the switch and it is audited; the numbers from seeded views.
- README section. `npm run lint`, `npm run build`, `npm run test:unit`, `npx cucumber-js --dry-run`.
- Stand-in server with invented data at 1280px and 360px.
