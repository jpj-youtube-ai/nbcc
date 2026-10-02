# Admin QR codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A QR codes screen in the admin that makes a printable (SVG) and on-screen (PNG) QR code for every public page of nbcc.scot, picks up new pages automatically, and counts scans in Analytics.

**Architecture:** A pure module `src/site/qr.ts` turns the page registry (`SITE_PAGES`) into rows and builds each code's tagged link; `src/routes/admin-qr.ts` serves the list and draws codes with the `qrcode` package; the admin screen lists them. Analytics gets a `qr` channel from `utm_medium=qr`, with a migration that only widens the channel check.

**Tech Stack:** Express + TypeScript, `qrcode` (MIT), Vitest with `jsqr` + `sharp` (test-only decoding), Cucumber BDD (CI only), node-pg-migrate.

Spec: `docs/superpowers/specs/2026-10-02-admin-qr-codes-design.md`. Ships as TASK-492.

---

## File structure

- Create `src/site/qr.ts`: `QR_BASE`, `qrSlug(path)`, `qrLink(path)`, `qrPath(raw)` (the address check), `qrRows(pages, gates)`, `drawQr(link, format)`.
- Create `src/routes/admin-qr.ts`: `GET /api/admin/qr-codes`, `GET /api/admin/qr-codes/image`. Mounted in `src/app.ts`.
- Modify `src/analytics/channel.ts` (the `qr` rule), `src/db/analytics-report.ts` (`qrCodes` panel), `assets/js/admin/app.js` (channel label, the panel, the QR screen), `admin.html` (menu item and view), `assets/css/admin.css` (the rows), `src/admin/whats-new.ts` (area and feature line), `src/db/whats-new.ts` (no arrivals for `qr`).
- Create `migrations/1791100000000_analytics-qr-channel.js` (sorts after every existing migration).
- Tests: `test/unit/site-qr.test.ts`, `test/unit/admin-qr-routes.test.ts`, `test/unit/analytics-channel.test.ts` (added cases), `test/unit/admin-app.test.ts` (the screen), `test/unit/whats-new.test.ts` (area list). BDD: `features/admin-qr.feature` with steps.
- README: a "QR codes (TASK-492)" section.

## Task 1: the pure rules (`src/site/qr.ts`)

- [ ] **Test first** (`test/unit/site-qr.test.ts`):
  - `qrSlug("/")` is `home`; `qrSlug("/ball/terms")` is `ball-terms`; `qrSlug("/about-us")` is `about-us`.
  - `qrLink("/ball")` is `https://nbcc.scot/ball?utm_medium=qr&utm_campaign=ball`; `qrLink("/")` is `https://nbcc.scot/?utm_medium=qr&utm_campaign=home`.
  - `qrPath` accepts `/give`, `/ball/terms`, `/` and ` /Give ` (trimmed, kept as typed apart from spaces); refuses `""`, `give`, `https://evil.example/x`, `//evil.example`, `/a b`, `/x?y=1`, `/x#y`, `/..`, and anything over 200 characters (returns null).
  - `qrRows(SITE_PAGES, { ballOpen: false, eventsOn: true })` has one row per registry page including children (flattened, in order), each `{ path, title, live, link }`; the ball pages are `live: false`, the events page `live: true`; with `ballOpen: true` they are live. Every path in `SITE_PAGES` (walked recursively) appears, so a new page cannot be missed.
- [ ] Run: fails (module missing). Implement. Run: passes. Commit.

## Task 2: drawing a code

- [ ] **Test first** (same file): `drawQr(link, "svg")` returns a string starting `<svg` that contains no script; `drawQr(link, "png")` returns a Buffer that decodes (sharp raw RGBA → jsQR) to exactly `link`, is 1200 pixels wide, and the SVG rasterised by sharp also decodes to `link`.
- [ ] `npm install qrcode` and `npm install -D @types/qrcode jsqr`. Run: fails. Implement with `QRCode.toString(link, { type: "svg", errorCorrectionLevel: "M", margin: 4 })` and `QRCode.toBuffer(link, { type: "png", errorCorrectionLevel: "M", margin: 4, width: 1200 })`. Run: passes. Commit.

## Task 3: the routes (`src/routes/admin-qr.ts`)

- [ ] **Test first** (`test/unit/admin-qr-routes.test.ts`, the session and the gates mocked):
  - The list needs a session (401) and site view (403 for someone without it); it answers `{ pages: qrRows(...) }`.
  - The image: `?path=/ball&format=svg` answers `image/svg+xml` with `Content-Disposition: attachment; filename="nbcc-qr-ball.svg"`; `format=png` answers `image/png` and `nbcc-qr-ball.png`; a bad path or format is 400 with "Give an address on nbcc.scot, starting with /"; `Cache-Control: private, no-store`.
- [ ] Implement with `authorizeSection(req, res, "site", "view")`, `isGateOpen(await getSettings(), new Date())` and `(await getEventsSettings()).pageOn` for the gates (each read failing counts as not live), mount in `src/app.ts`. Run: passes. Commit.

## Task 4: Analytics

- [ ] **Test first** (`test/unit/analytics-channel.test.ts`): `classifyArrival({ referrer: "", utm: { medium: "qr", campaign: "ball" }, ownHosts })` is `{ channel: "qr", source: null, campaign: "ball" }`; `QR` in any case counts; a `utm_source` alongside does not change it.
- [ ] Implement: `Channel` gains `"qr"`; the rule sits after the email rule and before "any other utm_source". Migration `1791100000000_analytics-qr-channel.js`: drop `analytics_views_channel_check` and add it again with `'qr'` included (`down` puts the old list back). Check the constraint's real name in the first migration's generated SQL (node-pg-migrate names a column check `<table>_<column>_check`).
- [ ] `src/db/analytics-report.ts`: `qrCodes: await visitsBy(p, "campaign", "channel = 'qr'")` in `panels`, and its type in `Panels`. Admin: `qr: "QR code"` in the channel labels and a "QR codes scanned" list of campaigns (the page slug) with visits, in the same style as "Other websites". jsdom test for the label and the list.
- [ ] Commit.

## Task 5: the admin screen

- [ ] **Test first** (`test/unit/admin-app.test.ts`): a "QR codes" menu item for someone who can view Site pages and not for someone who cannot; opening it lists every page from the answer with its title, address, "not live yet" where it applies, a preview `<img>` whose `src` is the SVG image URL, and Download SVG and Download PNG links to the image URLs (with `download`); the other-address box makes a row for `/give` and refuses `give` with "Give an address on nbcc.scot, starting with /".
- [ ] Implement in `admin.html` (menu item `data-view="qr" data-view-gate="site"` after Site pages; `section#view-qr`), `assets/js/admin/app.js` (`loadQr`, called from the view switch; the image URL carries the session the same way other admin downloads do — check how the CSV links authenticate and follow that), and `assets/css/admin.css`. The previews are `<img>` tags; rows become cards on a phone like the other admin lists.
- [ ] New pill: `qr` in `Area`, `AREAS` (`section: "site", level: "view"`), a `FEATURES` line dated 2026-10-02, and `latestArrival` returns null for `qr` (no arrivals). Update `test/unit/whats-new.test.ts`'s area list.
- [ ] Check it in headless Chrome at 1280 and 375 pixels with a stand-in server; nothing scrolls sideways. Commit.

## Task 6: BDD, README, review, ship

- [ ] `features/admin-qr.feature`: an admin lists the QR pages and gets the Festive Ball's SVG and PNG; a request without a session is 401; a visit arriving with `utm_medium=qr` is counted under the QR code channel (via the pulse, as the analytics feature does).
- [ ] README "QR codes (TASK-492)"; lint, build, the affected unit tests; independent review (logic and a migration, so it is required); the migration-safety reviewer; `/ship`; check live.
