# Elf Detective School, Wave 1 (sign up, paying, accounts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** By Friday 13 November 2026 a grown up can open nbcc.scot/elf, enrol their detectives, pay what they can, get a welcome email, sign in to Detective HQ and dress each detective's elf, all behind one switch that ships off.

**Architecture:** New files beside Stage A's pure logic and screens: one migration, one repository module (`src/db/elf.ts`), pure join, view and email builders in `src/elf/`, page routes and a small JSON API in `src/routes/elf.ts`, and an admin settings and sign ups screen. Paying copies the event tickets pattern (Checkout Session tagged `product: "elf_school"`, a webhook handler that runs first, emails after commit). Signing in copies the fundraiser private area (emailed 6 digit code, hashed session cookie).

**Tech Stack:** Express 4, TypeScript, zod, Postgres (node-pg-migrate, CommonJS), Stripe Checkout, SES via `src/clients/email.ts`, Vitest (jsdom for pages), Cucumber BDD.

**Spec:** `docs/superpowers/specs/2026-10-04-elf-detective-school-design.md` and its amendment `docs/superpowers/specs/2026-11-03-elf-detective-secret-places-design.md` (the amendment wins). Wave 1 is decision 13's first wave. Stage A's code is in `src/elf/` and `src/elf/pages/`; its API shapes are in `docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md` ("/api/elf/*" table).

## Global Constraints

- Everything ships switched off: `elf_settings.school_on` defaults to `false`; while off, every `/elf` page and `/api/elf/*` route answers 404, but the Stripe webhook still settles orders already made.
- Do not merge or deploy anything before **Sunday 8 November 2026** (the Festive Ball is Saturday 7 November and shares the Stripe webhook). Build and push a draft PR before then; merge from the 8th.
- Sign ups open Friday 13 November 2026; door 1's first clue is Tuesday 1 December 2026 at 17:30 London time.
- Pay what you can: £5 suggested per detective, any amount from £1 per detective; both set in the admin (`entry_suggested_pence` 500, `entry_from_pence` 100).
- The entry is never Gift Aided. Only a separate, optional donation line can be, with the usual declaration. The usual cover the card fee tick is offered. The newsletter box is unticked.
- A child appears only by detective name: first name (`cleanFirstName` in `src/elf/names.ts`) plus a festive surname from `FESTIVE_SURNAMES` (`isFestiveSurname`). Never collect a real surname, school or age. Adults can play too.
- Public copy: no dashes and no hyphenated words; money wording uses "could"; write `Elves' Workshop`; never "Elf on the Shelf". Staff approve all public words: Jaimie reads every page and email in this plan before the switch goes on.
- No emailed link changes anything on GET. Recipient addresses are set in the admin, never in code.
- No inner scrollbars; every screen works at 390px wide.
- The repo is public: invented names only in tests and fixtures (01632 960 123 is the reserved fictional number). Grep the diff for real data before pushing.
- Migrations are additive and numbered above `1791200000300`; re-check the order against `origin/main` right before merging.
- Emails come from `BALL_FROM_EMAIL` (events@ on the apex) with `SES_TRANSACTIONAL_CONFIGURATION_SET`; never news.nbcc.scot.
- Admin writes use `authorizeSectionAsAdmin(req, res, "fundraising")`; reads use `authorizeSection(req, res, "fundraising", "view")` (the Get involved tab's section, so no permissions migration).
- Every task updates `README.md` for what it adds (routes table, a new "## Elf Detective School" section, config if any). No new config keys are needed: Stripe, SES, Turnstile and `ADMIN_SESSION_SECRET` already exist.
- Work only in the `elf-detective` worktree; never touch other worktrees or the shared checkout. Use `npm --prefix` and `git -C`, never `cd`.

## Review Focus

1. **The same email joins twice** (a second enrol while the first is unpaid, or after it is paid): one family per email, never two; the new detectives join that family once their order is paid. Test in Task 4.
2. **Stripe sends an event twice, or `expired` after `completed`**: the order is settled once; a paid order never turns expired; badges are never handed out twice. Test in Task 5.
3. **Amounts that should be refused**: below £1 per detective, not whole pence, over £1,000, a donation with Gift Aid but no declaration, Gift Aid ticked with no donation. Plain words back, nothing saved. Test in Task 3.
4. **The browser is closed before Stripe sends them back**: the welcome email still arrives and the grown up can still sign in with a code. Test in Task 6.
5. **A name that must not go through**: "Ruby Smith" typed as a first name, a blocked word dressed up in look alike letters, a surname not on the list. Refused with `cleanFirstName`'s reasons, before any payment. Test in Task 3.

---

### Task 1: The public calendar keeps the places secret

**Files:**
- Modify: `src/elf/pages/types.ts` (remove `CalendarView.places`), `src/elf/pages/calendar.ts` (drop the places list section), `test/unit/elf-fixtures.ts`
- Test: `test/unit/elf-page-calendar.test.ts`

**Interfaces:**
- Produces: `CalendarView` without `places`. Nothing else changes.

- [ ] **Step 1: Write the failing test** `it("never lists this year's hiding places")`: render `renderCalendarPage(calendarView(AFTERNOON))` with the fixtures' place names, and expect none of the shut doors' place names to appear anywhere in the HTML, and no element with the old places list class.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- elf-page-calendar`. Expected: FAIL.
- [ ] **Step 3:** remove the field, the section and the fixture data; keep open doors showing their place (`DoorView.place`), as now.
- [ ] **Step 4: Run** `npm --prefix W run test:unit -- elf` and `npm --prefix W run build`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `Elf Detective School: the calendar never lists the hiding places`.

### Task 2: The tables, the switch and the settings

**Files:**
- Create: `migrations/1791200000310_elf-school.js`, `src/db/elf.ts`
- Test: `test/unit/elf-db-settings.test.ts` (mocked pool, as `test/unit/stripe-webhook-tickets.test.ts` does)

**Interfaces:**
- Produces (in `src/db/elf.ts`):
  - `interface ElfSettings { schoolOn: boolean; year: number; entryFromPence: number; entrySuggestedPence: number }`
  - `getElfSettings(): Promise<ElfSettings>` (any error reads as `schoolOn: false` with the defaults, like `fundraisingIsOn`)
  - `setElfSettings(patch: Partial<Omit<ElfSettings, "year">>, actor: string): Promise<ElfSettings>` (row locked `FOR UPDATE`, upsert, `insertAudit` with action `elf.settings`)
- Tables (follow `migrations/1791200000050_fundraising-private-area.js` for ids, timestamps and style):
  - `elf_settings` one row `id = 1`: `school_on boolean not null default false`, `year int not null default 2026`, `entry_from_pence int not null default 100`, `entry_suggested_pence int not null default 500`, `updated_at`, `updated_by`.
  - `elf_families`: `id`, `email text not null unique` (stored lower case and trimmed), `grown_up_name text not null`, `newsletter boolean not null default false`, `active boolean not null default false`, `created_at`.
  - `elf_detectives`: `id`, `family_id` references `elf_families`, `first_name`, `surname`, `name_approved boolean not null default false`, `badge_number int unique` (null until paid), `look jsonb`, `fresh text[] not null default '{}'`, `active boolean not null default false`, `created_at`.
  - `elf_orders`: `id`, `reference text unique not null`, `family_id`, `detective_ids uuid[] not null`, `entry_pence int not null`, `donation_pence int not null default 0`, `fee_cover_pence int not null default 0`, `gift_aid boolean not null default false`, `declaration_id` (nullable, references `declarations`), `stripe_session_id text unique`, `status text not null default 'pending'` checked in (`pending`, `paid`, `expired`), `browser_token_hash text`, `created_at`, `paid_at`.
  - `elf_sign_in_codes` and `elf_sessions`: the same columns as the fundraiser's code and session tables, with `family_id` in place of the fundraiser.
  - `elf_badge_seq` sequence starting at 1.

- [ ] **Step 1: Write the failing tests**: `getElfSettings` returns `{ schoolOn: false, year: 2026, entryFromPence: 100, entrySuggestedPence: 500 }` when the query throws; `setElfSettings({ schoolOn: true }, "jodie@nbcc.scot")` issues `FOR UPDATE`, writes the row and an audit with action `elf.settings`.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- elf-db-settings`. Expected: FAIL.
- [ ] **Step 3:** write the migration and the two functions. Check it sorts last: `ls W/migrations | sort | tail -3`.
- [ ] **Step 4: Run** the test and `npm --prefix W run build`. Expected: PASS.
- [ ] **Step 5: Commit** `Elf Detective School: its tables and its switch, off`.

### Task 3: The rules of enrolling and paying (pure)

**Files:**
- Create: `src/elf/join.ts`
- Test: `test/unit/elf-join.test.ts`

**Interfaces:**
- Consumes: `cleanFirstName`, `isFestiveSurname` (`src/elf/names.ts`); `declarationFieldsSchema` (`src/declarations/fields.ts`); `grossedUpFeePence`, `CardFeeRate` (`src/ball/pricing.ts`); `ElfSettings` (Task 2).
- Produces:
  - `MAX_DETECTIVES = 8`
  - `joinBodySchema(settings: ElfSettings)`: a zod schema for `{ grownUpName, email, detectives: { firstName, surname }[], entryPence, donationPence, giftAid, declaration?, coverFee, newsletter, agreed: true, website?: "" (honeypot), captchaToken? }`
  - `type JoinBody = z.infer<ReturnType<typeof joinBodySchema>>`
  - `entryLimits(settings: ElfSettings, detectives: number): { fromPence: number; suggestedPence: number; maxPence: 100000 }`
  - `feeCoverPence(body: JoinBody, rate: CardFeeRate): number`: 0 unless `coverFee`; covers entry plus donation.
  - `buildElfSessionParams(o: { reference: string; body: JoinBody; feeCoverPence: number; baseUrl: string; familyId: string }): Stripe.Checkout.SessionCreateParams`: card only; line items "Elf Detective School entry" (entry), "A gift to NBCC" (donation, only when above 0), "Covering the card fee" (only when above 0); `metadata` and `payment_intent_data.metadata` carry `product: "elf_school"`, `reference`, `familyId`, `giftAid`, `feeCoverPence`; `success_url` is `${baseUrl}/elf/welcome?elf_session={CHECKOUT_SESSION_ID}`, `cancel_url` `${baseUrl}/elf/join`; `expires_at` 31 minutes ahead; `customer_email` the email.

- [ ] **Step 1: Write the failing tests** (invented names only):
  - two detectives at £5 each passes; `entryPence: 199` for two detectives fails with "at least £2 for 2 detectives"; `entryPence: 100001` fails; `entryPence: 250.5` fails.
  - `detectives: []` fails; nine detectives fails ("up to 8 detectives").
  - `firstName: "Ruby Smith"` fails with the `one-word` reason's words; a blocked word in look alike letters fails with `blocked`; `surname: "Smith"` fails ("pick a surname from the list").
  - `giftAid: true` with `donationPence: 0` fails; `giftAid: true` with a donation and no declaration fails; with both passes.
  - `agreed` false fails; a filled `website` honeypot fails.
  - `buildElfSessionParams`: the entry line never carries Gift Aid metadata of its own; the donation line is absent at 0; `metadata.product === "elf_school"`; the success URL is built from `baseUrl`, never from the body.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- elf-join`. Expected: FAIL.
- [ ] **Step 3:** implement; refusal messages in plain words, no dashes.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `Elf Detective School: the rules of enrolling and paying`.

### Task 4: The enrol page and starting a payment

**Files:**
- Create: `src/elf/pages/join.ts` (`renderJoinPage(view: JoinView): string`, using `elfPage`), `src/routes/elf.ts`, `assets/js/elf-join.js`
- Modify: `src/elf/pages/types.ts` (add `JoinView`), `src/db/elf.ts`, `src/app.ts` (mount), `src/site/pages.ts` (`RESERVED_PREFIXES` gains `elf`)
- Test: `test/unit/elf-page-join.test.ts`, `test/unit/elf-db-join.test.ts`

**Interfaces:**
- Consumes: Task 3's schema and session builder; `stripe` (`src/clients/stripe.ts`); `verifyCaptcha`, `captchaEnabled` (`src/clients/turnstile.ts`); `createRateLimiter` (`src/portal/request-limiter.ts`); `currentCardFee` (`src/routes/api.ts`, move to an exported helper if private).
- Produces:
  - `interface JoinView { settings: ElfSettings; captchaSiteKey: string | null; surnames: readonly string[]; errors?: string[] }`
  - `createPendingJoin(body: JoinBody, browserTokenHash: string, feeCoverPence: number): Promise<{ familyId: string; orderId: string; reference: string; detectiveIds: string[] }>`: one transaction; finds or creates the family by lower case email (never a second family); adds the detectives inactive; creates a `pending` order.
  - `attachStripeSession(orderId: string, sessionId: string): Promise<void>`
  - `addElfPageRoutes(router: Router, siteRoot: string): void` and `elfApiRouter(): Router` in `src/routes/elf.ts`; every route first reads `getElfSettings()` and answers 404 when `schoolOn` is false.
  - `GET /elf/join` and `POST /api/elf/join` (JSON and plain form). The POST: honeypot, rate limit 10 per IP per hour (loopback exempt, as `isLoopbackRequest`), Turnstile when enabled, schema, `createPendingJoin`, `stripe.checkout.sessions.create(params, { idempotencyKey: \`elf-${reference}\` })`, `attachStripeSession`, sets a `nbcc_elf_pending` cookie (random token; its sha256 is `browser_token_hash`; httpOnly, SameSite lax, Secure in production, 1 hour) and answers `{ url }` or redirects 303.
- `assets/js/elf-join.js`: a classic IIFE that adds and removes detective rows (up to 8), offers the surname list with a "Spin" button, keeps the total and the fee line live, and shows the Gift Aid declaration only when a donation is entered. The page works without it.

- [ ] **Step 1: Write the failing tests**:
  - page: every control has a label; no input asks for age, school or a real surname; the newsletter box is unticked; the suggested amount shown is £5 per detective and the lowest is £1; the Gift Aid wording sits only beside the donation; house rules (`test/unit/elf-pages-house-rules.test.ts` cases extended to the join page).
  - db: joining twice with `Sam@Example.com ` and `sam@example.com` gives the same `familyId` and two orders.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- elf-page-join elf-db-join`. Expected: FAIL.
- [ ] **Step 3:** implement the page, the db function, the routes and the script.
- [ ] **Step 4: Run** `npm --prefix W run test:unit -- elf`, `npm --prefix W run lint`, `npm --prefix W run build`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `Elf Detective School: enrol your detectives and pay what you can`.

### Task 5: Settling a payment, badges and the welcome email

**Files:**
- Create: `src/elf/webhook.ts`, `src/elf/emails.ts`
- Modify: `src/db/stripe-webhook.ts` (`dispatch` calls `handleElfEvent` first, before `handleTicketEvent`), `src/db/elf.ts`, `src/newsletter/self-signup.ts` (source `"elf"`), `src/clients/email.ts` (`sendElfWelcome`, `sendElfSignInCode`), `assets/js/admin/app.js` (`EMAIL_KINDS` gains `["elfWelcome", "Elf Detective School welcome"]`, `["elfSignInCode", "Elf Detective School sign in code"]`), `src/email/catalogue.ts` (group `elf`, entries for both emails), `test/unit/email-catalogue-guard.test.ts` (`EMAIL_FOLDERS` gains `src/elf`)
- Test: `test/unit/elf-webhook.test.ts`, `test/unit/elf-emails.test.ts`

**Interfaces:**
- Produces:
  - `handleElfEvent(client: PoolClient, event: Stripe.Event): Promise<{ action: "elf-paid" | "elf-expired" | "elf-ignored"; afterCommit?: () => Promise<void> } | null>`: null unless the session's `metadata.product === "elf_school"`.
  - `settleElfOrder(client, sessionId: string, paidAt: Date): Promise<{ settled: boolean; familyId: string; detectiveIds: string[] }>` in `src/db/elf.ts`: `pending` to `paid` only (locked `FOR UPDATE`); activates the family and the order's detectives; gives each detective `nextval('elf_badge_seq')`; writes the donation's declaration (as the donations path does) only when `gift_aid`; a second call does nothing.
  - `expireElfOrder(client, sessionId: string): Promise<void>`: `pending` to `expired` only.
  - `buildElfWelcomeEmail(o: { grownUpName: string; detectives: { name: string; badge: string }[]; hqUrl: string; firstClueAt: Date }): { subject: string; html: string; text: string }` using `emailShell` from `src/email/brand.ts`; badge format `EDS 0042`; says school starts on Tuesday 1 December at 5:30pm and how to sign in; no link in it changes anything.
- The welcome email goes out in `afterCommit`, best effort, like the tickets path. In the same `afterCommit`, when the family ticked the newsletter box, call `subscribeSelf({ name, email, phone: null }, "elf")` from `src/newsletter/self-signup.ts`, adding `"elf"` to its `source` union (decide with `shouldSendWelcome` whether the newsletter's own welcome also goes; one email is kinder, so return false for `"elf"`).

- [ ] **Step 1: Write the failing tests**:
  - `checkout.session.completed` for an `elf_school` session marks it paid, activates two detectives with badges, returns `elf-paid` with an `afterCommit`; the same event again changes nothing and sends nothing.
  - `checkout.session.expired` after `completed` leaves it paid.
  - a session without `product: "elf_school"` returns null (the tickets and Ball paths still run).
  - a paid order with `gift_aid` writes one declaration tied to the donation only.
  - a paid order with `newsletter` true calls `subscribeSelf` once with source `"elf"`; with it false, never.
  - the welcome email names detectives as "Detective Ruby Tinselfoot", shows `EDS 0001`, contains no dash characters, uses "could" for any money line, and its text part matches the HTML.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- elf-webhook elf-emails email-catalogue-guard admin-email-kinds`. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4: Run** those tests plus `stripe-webhook` and `email-catalogue`. Expected: PASS.
- [ ] **Step 5: Commit** `Elf Detective School: a payment settles, badges are given and the welcome email goes`.

### Task 6: Signing in

**Files:**
- Create: `src/elf/pages/sign-in.ts` (`renderSignInPage`, `renderWelcomePage`), `src/elf/session.ts`
- Modify: `src/routes/elf.ts`, `src/db/elf.ts`
- Test: `test/unit/elf-session.test.ts`, `test/unit/elf-page-sign-in.test.ts`

**Interfaces:**
- Consumes: `newSignInCode`, `readCode`, `hashSignInCode`, `codeVerdict`, `newSessionId`, `hashSessionId`, `sentFromOurOwnPage` (`src/fundraising/sign-in.ts`); `readCookie` (`src/ball/gate.ts`).
- Produces:
  - `ELF_SESSION_COOKIE = "nbcc_elf_session"`, `ELF_PENDING_COOKIE = "nbcc_elf_pending"`, `ELF_SESSION_DAYS = 30`, `elfSessionCookieOptions(production: boolean)` (httpOnly, SameSite lax, Secure in production, `path: "/"`, 30 days) in `src/elf/session.ts`.
  - `signedInFamily(req: Request): Promise<{ familyId: string } | null>` in `src/routes/elf.ts`.
  - Routes: `GET /elf/sign-in`; `POST /api/elf/sign-in/request` (always the same answer before any lookup; rate limited per email and per IP; sends `sendElfSignInCode` only to an active family); `POST /api/elf/sign-in` (code check as the fundraiser's, then a new session, any old one ended); `POST /api/elf/sign-out`; `GET /elf/welcome?elf_session=`: when the `nbcc_elf_pending` cookie's hash matches that paid order, it turns into a session and redirects to `/elf/hq`; otherwise it shows "Check your email" with the sign in link. Every POST checks `sentFromOurOwnPage`.

- [ ] **Step 1: Write the failing tests**:
  - cookie options are httpOnly, lax, path `/`, 30 days, Secure only in production.
  - the request answer is identical for an unknown email, an inactive family and an active family.
  - the welcome page with no pending cookie (the browser was closed and reopened) shows the sign in route and never signs anyone in; with a cookie for a still pending order it shows "We are just checking your payment" and refreshes itself.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- elf-session elf-page-sign-in`. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4: Run** `npm --prefix W run test:unit -- elf`. Expected: PASS.
- [ ] **Step 5: Commit** `Elf Detective School: signing in with a code`.

### Task 7: Detective HQ before school starts, and the wardrobe

**Files:**
- Create: `src/elf/views.ts`
- Modify: `src/routes/elf.ts`, `src/db/elf.ts`
- Test: `test/unit/elf-views.test.ts`, `test/unit/elf-routes-look.test.ts`

**Interfaces:**
- Consumes: `renderHqPage`, `renderWardrobePage` and their views; `wardrobeState`, `normaliseLook`, `defaultLook`, `newlyUnlocked`; `progressOf`, `rankAt`; `familyDetectiveName`; `doorInstant`, `clueTimeFor` (`src/elf/calendar.ts`).
- Produces:
  - `hqViewFor(o: { family; detectives; settings: ElfSettings; now: Date }): HqView` with `today: null` and `nextClueAt` = door 1's first clue (Tuesday 1 December 2026, 17:30 London) before December.
  - `wardrobeViewFor(o: { detective; settings: ElfSettings }): WardrobeView` with `wardrobeState({ doorsDone: 0, goldSeal: false }, false)` in wave 1.
  - `saveLook(detectiveId: string, familyId: string, look: ElfLook, tried: string[]): Promise<ElfLook>` in `src/db/elf.ts`: only a detective of that family; stores `normaliseLook` of what was sent against the state built on the server; removes `tried` keys from `fresh`; tolerates repeated `tried` keys.
  - Routes: `GET /elf/hq`, `GET /elf/hq/wardrobe/:detectiveId`, `POST /api/elf/look` (JSON `{ detectiveId, look, tried }`, answers `{ ok: true, look }`) and the plain form post (fields `detective`, `skin`, `hair`, `hairStyle`, `outfit`, `piece-<slot>="style:colour"`), both signed in and `sentFromOurOwnPage`.

- [ ] **Step 1: Write the failing tests**:
  - on 13 November 2026 at 09:00, `hqViewFor` gives `today: null` and `nextClueAt` equal to `2026-12-01T17:30:00Z`.
  - a posted look with a piece that unlocks at 6 doors comes back as the starter piece; a look posted for another family's detective is refused 404.
  - the same `tried` key sent twice clears it once and errors never.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- elf-views elf-routes-look`. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4: Run** `npm --prefix W run test:unit -- elf`. Expected: PASS.
- [ ] **Step 5: Commit** `Elf Detective School: Detective HQ and the wardrobe, live`.

### Task 8: The calendar, the rules page and the privacy page

**Files:**
- Create: `src/elf/pages/rules.ts` (`renderRulesPage(view: { settings: ElfSettings }): string`)
- Modify: `src/elf/views.ts` (`calendarViewFor(o: { settings: ElfSettings; now: Date }): CalendarView`), `src/routes/elf.ts` (`GET /elf`, `GET /elf/rules`, `GET /api/elf/calendar`, `GET /api/elf/door/:n`, `GET /api/elf/me`), `privacy.html` (a short Elf Detective School section), `README.md`
- Test: `test/unit/elf-views.test.ts`, `test/unit/elf-page-rules.test.ts`

**Interfaces:**
- `calendarViewFor`: 24 doors, all `shut` before December, each door's `clueAt` from `clueTimeFor`, `shapeUrl: null` and `bigPrize: false` until wave 2's admin, `elfName` from `ELF_NAMES` in order, `price` from settings as words ("£1", "£5").
- The rules page says, in plain words: what the game is; pay what you can; a grown up must be with under 16s at hiding places; the main prize is judged by Jodie, Head Elf, never drawn at random; children appear only by detective name; photos come down and children's details are deleted at the end of January; how to contact NBCC.

- [ ] **Step 1: Write the failing tests**: on 20 November 2026 every door is `shut`, door 1 counts down to `2026-12-01T17:30:00Z`, and no place name appears; the rules page contains "judged" and "never drawn", contains no dash characters, and names `Elves' Workshop` correctly if it names it at all; with `schoolOn` false `/elf`, `/elf/rules`, `/elf/join` and `/api/elf/calendar` answer 404.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- elf-views elf-page-rules`. Expected: FAIL.
- [ ] **Step 3:** implement; add the privacy section and the README "## Elf Detective School" section (routes, data, where it lives, the switch).
- [ ] **Step 4: Run** `npm --prefix W run test:unit -- elf` and build. Expected: PASS.
- [ ] **Step 5: Commit** `Elf Detective School: the calendar counts down, with its rules and privacy words`.

### Task 9: The admin: the switch, the price and the sign ups

**Files:**
- Create: `src/routes/admin-elf.ts`, `assets/js/admin/elf.js`
- Modify: `src/app.ts`, `admin.html` (script tag), `assets/js/admin/app.js` (a "Elf Detective School" part in the Get involved tab that calls `window.NBCCAdminElf.mount(el, authFetch)`), `src/db/elf.ts`
- Test: `test/unit/admin-elf.test.ts`

**Interfaces:**
- `GET /api/admin/elf/settings`, `PATCH /api/admin/elf/settings` (admin only; `entryFromPence` 100 to 1000, `entrySuggestedPence` at least `entryFromPence` and at most 5000).
- `GET /api/admin/elf/signups`: `{ families: number, detectives: number, entryPence: number, donationPence: number, giftAidPence: number, recent: { reference, grownUpName, detectives: string[], paidAt }[] }` for paid orders only, newest 50.
- `listElfSignups(): Promise<...>` in `src/db/elf.ts`.

- [ ] **Step 1: Write the failing tests**: a viewer can GET but not PATCH (403); `entrySuggestedPence` below `entryFromPence` is refused 400 with plain words; pending and expired orders are not counted.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- admin-elf`. Expected: FAIL.
- [ ] **Step 3:** implement, styled like `assets/js/admin/red-bag-list.js`; status messages use `is-ok` / `is-error`, never `.err`.
- [ ] **Step 4: Run** the test, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `Elf Detective School: the admin switch, price and sign ups`.

### Task 10: Adding a detective later

**Files:**
- Modify: `src/elf/pages/join.ts`, `src/routes/elf.ts`, `src/elf/pages/hq.ts` (an "Add a detective" link)
- Test: `test/unit/elf-page-join.test.ts`

**Interfaces:**
- A signed in family's `GET /elf/join` shows only the detectives part and the payment (no grown up name or email fields); `POST /api/elf/join` takes the family from the session and ignores any email sent. Everything else is Task 4 and Task 5.

- [ ] **Step 1: Write the failing tests**: signed in, the page has no email field; a posted email different from the family's is ignored and the order joins the signed in family.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4: Run** `npm --prefix W run test:unit -- elf`. Expected: PASS.
- [ ] **Step 5: Commit** `Elf Detective School: add a detective later`.

### Task 11: The screens get the walkthrough's look

**Files:**
- Modify: `assets/css/elf.css`, `src/elf/pages/calendar.ts`, `src/elf/pages/join.ts`, `src/elf/pages/hq.ts`
- Reference: the walkthrough's source in the scratchpad `elf-walkthrough/index.html` (session c02867c3) and live `assets/css/ball-bags.css` and `assets/css/red-bag.css`.

Use the design skills first (`redesign-existing-projects`, `animate`, `delight`), then `polish`. Bring in the walkthrough's look: cream page with the gold glow and blush, the red present hero with the school's elf peeking out and the "Top secret!" tag and "24 prizes" seal, gift tag prize labels in Caveat, gold sparkles, springy entrances, falls of gold stars and hearts at proud moments. Transform and opacity only; nothing plays for reduced motion; nothing waits for an animation.

- [ ] **Step 1:** extend `test/unit/elf-pages-house-rules.test.ts` so every page still passes (labels, sizes, alt words, no dashes) and add `it("plays nothing for someone who asked for less motion")` checking `elf.css` has a `prefers-reduced-motion: reduce` block covering the new animations.
- [ ] **Step 2: Run** `npm --prefix W run test:unit -- elf`. Expected: the new test FAILS.
- [ ] **Step 3:** restyle; check at 390px and desktop in the browser pane with a stand in route, no horizontal scroll, no inner scrollbars.
- [ ] **Step 4: Run** `npm --prefix W run test:unit -- elf`, lint, build. Expected: PASS.
- [ ] **Step 5: Commit** `Elf Detective School: the screens get the walkthrough's look`.

### Task 12: End to end, and shipping switched off

**Files:**
- Create: `features/elf-join.feature`, `features/steps/elf-join.steps.js`
- Modify: `README.md`

- [ ] **Step 1: Write the BDD scenarios** (invented families, suffix "(bdd-elf)", cleaned up in hooks): with the school switched off, `/elf` is 404; switched on, a grown up enrols two detectives, the stub checkout comes back, a signed webhook settles it, the welcome email is logged, the pending cookie signs them in, HQ shows both detectives, a look is saved and comes back normalised; the same webhook again changes nothing.
- [ ] **Step 2:** push a **draft** PR early so CI runs the BDD (there is no local database). Expected: `pr.yml` green.
- [ ] **Step 3:** show Jaimie every page and both emails (screenshots at 390px and desktop) and get a yes on the words.
- [ ] **Step 4:** on or after **Sunday 8 November 2026**: re-check migration order against `origin/main`, claim the TASK number, finish with `/ship`. The school stays switched off.
- [ ] **Step 5:** on Friday 13 November, Jaimie (or staff) switches it on in Admin, Get involved.

## Not in wave 1 (wave 2, before 1 December)

Places, prizes and shapes in the admin; the three clues, the names that also count and the reveal time; the typed guess; the clue email; claiming, stamps and the daily running; staff ticking first names; Elf HQ team emails; photos. Deleting children's details at the end of January is a later wave, before 31 January 2027.
