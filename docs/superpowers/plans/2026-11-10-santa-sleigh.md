# Santa Sleigh Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Kilmarnock Santa Sleigh page at `/sleigh` that takes online gifts, shows the year's total (online + card machine + bucket cash) on a road of one house per night, with an admin section, a Donations tile, and printable posters.

**Architecture:** Copies `/bag` (src/ball/bags-page.ts, routes in src/routes/ball.ts): a page drawn whole in TS with its own CSS/JS, a checkout marker that becomes `donations.source = 'santa_sleigh'`, a thank-you page read back from the Stripe session, and a UK-date switch. Two additive tables hold the nights and settings. Card-reader gifts are tagged by a time-window SQL after commit, like `tagDonationSource`.

**Tech Stack:** Express + TypeScript, node-pg-migrate, Stripe Checkout + Terminal webhooks, Vitest, Cucumber.

**Spec:** `docs/superpowers/specs/2026-11-10-santa-sleigh-design.md`

## Global Constraints

- Main address `/sleigh` (Jaimie, on approval: "/sleigh as default for poster etc."). `/santa-sleigh` 301 → `/sleigh`. Thank you `/sleigh/thank-you`.
- NBCC's exact words: "children, young people and vulnerable adults across South West Scotland"; `ABOUT_NBCC_SHORT` from `src/email/brand.ts` verbatim. Never "Ayrshire" as the reach. "volunteer led". House copy rules as `ball-bags-page.test.ts`: no dashes, gifts "could", scripts as files, own links only.
- Brand: Playfair Display + Poppins, the six colours, logo on cream; no additions to `styles.css`.
- Motion: transform/opacity only; `prefers-reduced-motion: reduce` stops all of it.
- One-off gifts from a person only (as `/bag`, the form asks a person's name), £2 minimum, Gift Aid with `SINGLE_DONATION_WORDING`.
- Card machine window: `night_on + COALESCE(starts_at,'17:00') - 1 hour` to `night_on + COALESCE(ends_at,'21:00') + 1 hour`, Europe/London.
- Bucket cash never in Donations figures. Sleigh-tagged card gifts not in "Card reader".
- Additive migration numbered `1791200000420`, sorts last.
- Repo is public: invented fixture names only.

## Review Focus

1. A card gift tapped at 23:30 on a night whose times are TBC → not sleigh (window ends 22:00). Test in Task 2.
2. A night's times edited after gifts came in → gifts re-sorted both ways. Test in Task 2.
3. The page after the last night but before switch-off → thank-you state, giving still works; from `off_on` → 302 `/`. Test in Task 1.
4. The total read fails (database down) → the page still renders, without a number. Test in Task 4.
5. A sleigh checkout body that also carries `redBag`/`ball`/`fundraiserId`/`ballBags` → 400. Test in Task 3.

---

### Task 1: Model and switch (pure)

**Files:** Create `src/sleigh/model.ts`; Test `test/unit/sleigh-model.test.ts`

**Interfaces — Produces:**
- `SLEIGH_PATH = "/sleigh"`, `SLEIGH_OLD_PATH = "/santa-sleigh"`, `SLEIGH_THANKS_PATH = "/sleigh/thank-you"`, `SLEIGH_SOURCE = "santa_sleigh"`, `SLEIGH_MIN_PENCE = 200`.
- `interface SleighNight { id: number; nightOn: string /* YYYY-MM-DD */; areas: string; startsAt: string | null /* HH:MM */; endsAt: string | null }`
- `interface SleighSettings { seasonFrom: string; offOn: string }`
- `sleighPhase(today: string, nights: SleighNight[], offOn: string): "before" | "on" | "after" | "off"` — `off` when today ≥ offOn; `after` when today > last night; `on` when today is a night; else `before`.
- `roadStop(today: string, nights: SleighNight[]): number` — index of tonight's night, else of the next one (`0` before the first), `nights.length` after the last. Nights sorted by date.
- `timesLabel(n: SleighNight): string` — "Timings TBC" when either time is null, else "6pm to 8.30pm" style (no dash).
- `dayLabel(nightOn): { day: "Tue", date: "15", month: "Dec" }`.

- [ ] Tests: phase boundaries with the seven 2026 nights (2026-12-14 before, 2026-12-15 on, 2026-12-19 before (a gap day), 2026-12-23 after, 2027-01-31 off); roadStop 0/3/7; timesLabel TBC and "6pm to 8.30pm"; dayLabel for 2026-12-20 is Sun.
- [ ] Implement; run `npx vitest run test/unit/sleigh-model.test.ts` → PASS; commit.

### Task 2: Data — migration, queries, card tagging

**Files:** Create `migrations/1791200000420_santa-sleigh.js`, `src/db/sleigh.ts`; Modify `src/db/stripe-webhook-model.ts` (DONATION_SOURCES + `sourceFromCheckoutSession` reads `sleigh === "true"`), `src/db/stripe-webhook.ts` (`tagDonationSource` also handles `charge.succeeded`); Test `test/unit/sleigh-migration.test.ts`, `test/unit/sleigh-db.test.ts`, update `test/unit/donation-source.test.ts`.

Migration: `sleigh_nights(id serial pk, night_on date unique not null, areas text not null, starts_at time null, ends_at time null, bucket_pence integer not null default 0 check >= 0, updated_at timestamptz default now())` seeded with the seven 2026 nights from the spec; `sleigh_settings(id integer pk check id=1, season_from date not null default '2026-11-01', off_on date not null default '2027-01-31', updated_at)` + `INSERT (id) VALUES (1) ON CONFLICT DO NOTHING`.

**Interfaces — Produces (src/db/sleigh.ts):**
- `SLEIGH_WINDOW_SQL` — a SQL fragment `EXISTS (SELECT 1 FROM sleigh_nights n WHERE (d.created_at AT TIME ZONE 'Europe/London') >= n.night_on + COALESCE(n.starts_at, time '17:00') - interval '1 hour' AND (d.created_at AT TIME ZONE 'Europe/London') <= n.night_on + COALESCE(n.ends_at, time '21:00') + interval '1 hour')`.
- `TAG_CARD_SLEIGH_SQL` = `UPDATE donations d SET source = 'santa_sleigh' WHERE d.stripe_charge_id = $1 AND d.source IS NULL AND d.payment_channel = 'in_person' AND <window>`.
- `RESORT_UNTAG_SQL`, `RESORT_TAG_SQL` (both ways, in_person only, tag only since `season_from`).
- `listNights(): Promise<SleighNight & { bucketPence: number; cardPence: number; cardGifts: number }[]>`
- `getSleighSettings(): Promise<SleighSettings>`; `saveNight(id, { areas?, startsAt?, endsAt?, bucketPence? }, actor)` (audit row, then re-sort); `saveSleighSettings({ offOn }, actor)`.
- `sleighTotals(): Promise<{ onlinePence: number; cardPence: number; bucketPence: number; totalPence: number; gifts: number } | null>` cached 60 s, last good value on error, `null` if never read (copy `cachedRead` in `src/db/red-bag-workshops.ts`); `readSleighTotalsNow()` uncached for the admin. Net pence = `GREATEST(amount_pence - refunded_amount_pence,0)`, `payment_status='paid'`, `source='santa_sleigh'`, `created_at >= season_from`.

- [ ] Tests (DB-free, as `gift-sources-db.test.ts`/`donation-source.test.ts` do): migration records createTable for both, seeds 7 nights, sorts last; `DONATION_SOURCES` now ends with `"santa_sleigh"`; `sourceFromCheckoutSession({metadata:{sleigh:"true"}})` → `"santa_sleigh"`; `tagDonationSource` on a `charge.succeeded` card_present event runs `TAG_CARD_SLEIGH_SQL` with the charge id, and on an online card charge runs nothing; window SQL text contains `'17:00'`, `'21:00'`, `interval '1 hour'`, `Europe/London`.
- [ ] Implement; run the tests; commit.

### Task 3: Checkout marker

**Files:** Modify `src/routes/api.ts`; Test `test/unit/sleigh-checkout.test.ts`.

- `sleigh: z.boolean().optional()`; refines: `mode === "once"`, `amount >= SLEIGH_MIN_PENCE`, `donorType === "individual"`, never with `fundraiserId`/`redBag`/`ball`/`ballBags`.
- `metadata.sleigh = "true"`; return URLs `sleighReturnUrls()` → success `${PORTAL_BASE_URL}/sleigh/thank-you?session_id={CHECKOUT_SESSION_ID}`, cancel `${PORTAL_BASE_URL}/sleigh`; hosted only; card-only methods as `/bag`; product line name "Santa Sleigh gift to NBCC".
- [ ] Tests via `buildSessionParams` as `ball-bags-checkout.test.ts` does: metadata, urls, refusals (each of the five combinations, £1.99, monthly, company). Implement; pass; commit.

### Task 4: The page, route and assets

**Files:** Create `src/sleigh/page.ts`, `src/routes/sleigh.ts`, `assets/css/sleigh.css`, `assets/js/sleigh.js`, `assets/img/santa-sleigh-1600.webp`, `assets/img/santa-sleigh-840.webp`; Modify `src/app.ts` (mount before site router), `src/site/pages.ts` (SITE_PAGES `/sleigh` listed; PRIVATE_PAGES `/sleigh/thank-you` link-only; RESERVED_PREFIXES `/sleigh`, `/santa-sleigh`); Test `test/unit/sleigh-page.test.ts`, `test/unit/sleigh-script.test.ts`, `features/sleigh.feature` + steps.

**Interfaces:** `renderSleighPage({ nights, phase, stop, totalPence: number | null }): string`; `renderSleighThanks(amountPence: number | null): string`; `amountFromSession(session): number | null`.

Layout (the mockup, order fixed): cream top bar with logo; night-sky hero (snow two depths, moon, rooftops, the sleigh picture gliding in then bobbing); total card over the road with one house per night (date + area under each, the little sleigh at `stop`, number counts up); give (£5 £10 £20 £50, own amount, name, email, Gift Aid, Give £N); "Who's behind the sleigh?" (short description verbatim, 7,657 red bags in 2025, link /about-us); other ways (Fill a Red Bag `/fill`, volunteer `/get-involved/volunteer`, newsletter `/newsletter`); last band; registration footer. `after` phase: heading "Thank you, Kilmarnock", giving kept. Route: `GET /sleigh` (phase `off` → 302 `/`; `?at=after` previews after, noindex + no-store), `GET /santa-sleigh` 301, `GET /sleigh/thank-you` (session_id regex as `/bag`).

- [ ] Tests: copy rules; exact words; no "Ayrshire"; seven houses in order with "Timings TBC"; total absent when `null`; reduced-motion block in CSS; transform/opacity only in keyframes; script posts `{mode:"once", sleigh:true, amount}`; BDD: `/sleigh` 200, `/santa-sleigh` 301 to `/sleigh`, thank-you without session 200 plain.
- [ ] Implement with the design skills (impeccable, animate, delight); run tests; preview in the Browser pane; commit.

### Task 5: Admin — Santa Sleigh view and Donations tile

**Files:** Create `src/routes/admin-sleigh.ts`, `assets/js/admin/sleigh.js`, `assets/css/admin-sleigh.css`; Modify `src/app.ts`, `admin.html` (nav button `data-view="sleigh"` gated `data-view-gate="donations"`, view section, tile `data-gl-score="sleigh"`), `assets/js/admin/app.js` (selectView, `DONATION_SOURCES` entry `{source:"santa_sleigh"}`, pill), `src/admin/gift-sources.ts` (bucket `sleigh`, line "Santa Sleigh" after "Card reader", `SLEIGH_NOTE`), `src/db/overview-numbers.ts` (read 1 adds `$7 → 'sleigh'`; read 4 adds `AND source IS DISTINCT FROM 'santa_sleigh'`), `src/db/admin.ts` (`PLACE_WHERE.card_reader` excludes sleigh), `src/donations/labels.ts`; Tests: new `test/unit/admin-sleigh.test.ts`, updated `gift-sources*.test.ts`, `admin-donation-sources-route.test.ts`, `admin-gift-log.test.ts`.

Endpoints (authorizeSection "donations"): `GET /api/admin/sleigh` (view) → `{ nights, settings, totals }`; `PATCH /api/admin/sleigh/nights/:id` (edit) zod `{ areas?: string 1..120, startsAt?: "HH:MM"|null, endsAt?: "HH:MM"|null, bucketPence?: int 0..10_000_000 }`; `PATCH /api/admin/sleigh/settings` (edit) `{ offOn: YYYY-MM-DD }`.

- [ ] Tests, implement, pass, commit.

### Task 6: Posters

**Files:** Create `src/sleigh/posters.ts`; Modify `src/routes/admin-sleigh.ts` (`GET /api/admin/sleigh/poster?night=all|<id>&size=a4|a3`, donations view, returns a print-ready HTML page); `assets/js/admin/sleigh.js` (buttons per night and for all, A4/A3); Test `test/unit/sleigh-posters.test.ts`.

`renderSleighPoster({ nights, night: SleighNight | null, size: "a4" | "a3", qr: string })`: `@page { size: A4|A3 }`, full-bleed night sky, the sleigh picture, "Santa's coming to …" (the area, or "Kilmarnock"), the date(s) and "Timings TBC", the QR (`qrSvg("https://nbcc.scot/sleigh")`) with "Scan to give" and `nbcc.scot/sleigh`, the short description, registration line. Fonts embedded via `/assets/fonts`. Auto-opens print.

- [ ] Tests: all-nights poster lists seven dates and areas; one-night poster names only its area; A3 sets `size: A3`; QR present and encodes `https://nbcc.scot/sleigh`; no dashes. Implement, render to PDF locally and look; commit.

### Task 7: README, ship

- [ ] README sections (Santa Sleigh page, admin, posters); full `npm run lint && npm run build && npx vitest run`; `/ship`.
