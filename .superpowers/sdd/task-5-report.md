# Task 5 report — Public endpoint stores enquiries (retire the forward)

Branch: `task-177-contact-inbox`

## Files modified

- `src/routes/api.ts`
  - Removed `import { forwardEnquiry } from "../clients/contact";`.
  - Added imports: `contactEnquirySchema` (`../contact/schema`), `insertEnquiry` (`../db/contact`).
  - Removed the old `contactBodySchema` (Zod object) — replaced by the shared `contactEnquirySchema`.
  - Rewrote `postContact`:
    - Honeypot: `req.body.company` non-empty string → `200 { status: "sent" }`, nothing stored.
    - Per-IP rate limit via `createRateLimiter({ max: 5, windowMs: 60_000 })` (already imported for
      `/api/my-story`) → `429` on exceed.
    - Zod validation via `contactEnquirySchema` → `400` on invalid.
    - `insertEnquiry(parsed.data)` → `200 { status: "sent" }` on success, `500` on DB failure
      (logs the error message only, mirrors the `/api/my-story` error-logging style).
  - Route registration changed from `apiRouter.post("/api/contact", postContact)` to also apply
    `express.urlencoded({ extended: false, limit: "16kb" })` scoped to that route (see App.ts
    finding below).
- `test/unit/contact-endpoint.test.ts` — rewritten. Mocks `src/db/contact` (`insertEnquiry`)
  instead of `src/clients/contact` (`forwardEnquiry`). Covers: valid store + 200, optional
  lastName, 400 for each invalid-body case, honeypot silently accepted, per-IP 429 after 5
  requests, 500 on DB failure. All requests in each test group use unique IPs so the shared
  in-module rate-limiter state doesn't leak between test cases (only the dedicated rate-limit
  test intentionally reuses one IP).
- `contact.html` — added a hidden honeypot field inside `#contactForm`, mirroring the exact
  My Story pattern (`<div hidden aria-hidden="true"><label for="company">Leave blank
  <input type="text" id="company" name="company" tabindex="-1" autocomplete="off" /></label></div>`).
  My Story's honeypot has no dedicated CSS class — it relies on the plain `hidden` attribute — so
  I reused that pattern verbatim rather than introducing a new `.hp-field` CSS rule, since no such
  off-screen utility class exists in `assets/css/styles.css` today (checked: no `hp-field` /
  `honeypot` rule was found there).
- `features/contact.feature` — updated the feature description to say the endpoint stores in the
  isolated contact database instead of forwarding. Scenario bodies were unchanged (they already
  assert `200`/`status: "sent"` for a valid submission and `400` for an invalid one, which still
  holds under store behaviour).

## `test/unit/contact.test.ts` — NOT changed

Per the task's guidance, I only touch this file if it fails to compile/run due to the endpoint
changes. It drives `initContactForm` (the browser form handler in `assets/js/main.js`) under
jsdom and does not import `src/routes/api.ts` or `src/clients/contact.ts` at all — it is fully
decoupled from the server-side rewrite. Ran it standalone: **20/20 pass, unchanged**. Left
untouched; Task 8 (honest-save `initContactForm` rewrite) owns that file's behavioural changes,
including presumably wiring a real `fetch` and adjusting the "no backend wired" preview-mode
assumption the current tests encode.

## `src/app.ts` — body-parser change: NOT needed globally, added a scoped parser on the route instead

Investigated per Step 5. Findings:
- `src/app.ts` mounts a single global `app.use(express.json())` (line 29) — this covers a JS-driven
  JSON POST to `/api/contact`.
- There is **no global `express.urlencoded()`** in `app.ts`. The only urlencoded parsing in the
  app is route-scoped: `/api/gift-aid/:token` and `/api/my-story` each apply their own
  `express.urlencoded({ extended: false, ... })` directly on the route registration in
  `src/routes/api.ts`, not in `app.ts`.
- `contact.html`'s form is a native `<form action="/api/contact" method="post">` (no
  `enctype` override), so a no-JS submission POSTs `application/x-www-form-urlencoded`, which the
  global JSON parser will NOT parse (`req.body` would be `{}`).
- I mirrored the `/api/my-story` pattern exactly: applied `express.urlencoded({ extended: false,
  limit: "16kb" })` as route-level middleware on `apiRouter.post("/api/contact", ...)` in
  `src/routes/api.ts`, **not** in `app.ts`. This is a one-line addition of a middleware argument
  to the existing route registration, matching the plan's "mirror the My Story wiring" instruction
  at the point where My Story's own equivalent lives (in `api.ts`, not `app.ts`) — `app.ts` itself
  needed no change since it never held per-route urlencoded config for any endpoint.

## Test outputs

### Endpoint test — RED (before rewrite)

4 of the new store-based tests failed for the expected reason (old code still called the
now-removed `forwardEnquiry`, not the mocked `insertEnquiry`; no honeypot/rate-limit branch
existed):

```
✓ 6 passed, × 4 failed
 × stores the enquiry and returns a success status — insertEnquiry called 0 times
 × accepts a missing/empty last name — insertEnquiry called 0 times
 × returns 429 after exceeding the per-IP limit — got 200
 × returns 500 when the store fails — got 200
```

### Endpoint test — GREEN (after rewrite)

```
✓ test/unit/contact-endpoint.test.ts (10 tests) 10ms
Test Files  1 passed (1)
     Tests  10 passed (10)
```

### Full unit suite

```
Test Files  126 passed (126)
     Tests  1560 passed (1560)
Duration    17.79s
```

No failures, no skipped files. `test/unit/contact.test.ts` (20 tests) and
`test/unit/contact-endpoint.test.ts` (10 tests) both included and green in this run.

### Build

```
> tsc -p tsconfig.json
(clean, no output)
```

### Lint

```
> eslint . --ext .ts
(clean, no output)
```

Confirmed no dangling `forwardEnquiry` reference: only remaining occurrence repo-wide is its
definition in `src/clients/contact.ts` (intentionally kept, out of scope per instructions) — no
importer/caller remains in `src/` or `test/`.

## BDD status — NOT run, relying on CI

`npm run test:bdd` (Cucumber) requires a running app server (`BASE_URL`, default
`localhost:3000`) booted against live `DATABASE_URL` / `STORIES_DATABASE_URL` /
`CONTACT_DATABASE_URL` Postgres instances (the contact DB additionally needs
`migrate:contact` applied). This sandbox has no local Postgres and no Docker
(`pg_isready`/`docker` both absent). I did not fake a run. `features/contact.feature` was
updated per the plan (description text only; scenario assertions were already compatible with
store behaviour). CI's `pr.yml` (wired in Task 4) creates the `contact` database and runs
`migrate:contact` before BDD, so this is the authoritative gate for this scenario — it should be
watched in the PR checks.

## Commit

Commit message: `[TASK-177] contact inbox: store submissions, retire external forward`
(hash recorded after commit — see final status line for the actual commit hash created in this
session.)

## Concerns / notes for reviewers

1. **Rate limiter is in-memory, per-task** (existing, documented limitation of
   `createRateLimiter`, same as `/api/my-story`) — acceptable for the current single-Fargate-task
   deployment; not a new risk introduced by this change.
2. **`CONTACT_FORWARD_URL` / `src/clients/contact.ts` left in place** as explicitly instructed
   (out of scope, later cleanup task) — `forwardEnquiry` is now fully dead code (unused export),
   not called from anywhere in `src/`.
3. The honeypot field name is `company`, matching the task's explicit instruction — note this
   differs from My Story's honeypot field name (`website`); intentional per this task's spec, not
   an inconsistency to "fix."
4. `test/unit/contact-endpoint.test.ts`'s rate-limit test and the other groups use distinct
   fake IPs per test to avoid cross-test contamination in the shared in-process
   `contactLimiter` state (the limiter is module-level, matching production shape) — flagging in
   case a reviewer wonders why each `it` picks a different `9.9.9.x` address.
