# TASK-005 — Hosting (REQ-033) + performance budget

**Task:** TASK-005 — serve the four marketing pages + two API endpoints, and
define a mobile performance budget. **Direction chosen (owner): Path A —** reuse
the existing Express/ECS/ALB service instead of a static host or new AWS infra.

## Divergence from the issue (flagged)

The issue's wording assumes a *static deploy + serverless functions*
(`vercel.json`/`netlify.toml`, an `/api` functions dir). The owner chose to reuse
the existing AWS container service, which is **neither static nor serverless**.
So this PR delivers the **spirit** of REQ-033 — the four pages reachable at their
clean URLs, `/api/*` wired to the two stubbed endpoints, and a documented +
tested performance budget — but via the Express app behind the ALB. The PR
description will call this out explicitly.

## Architecture

The ALB already routes to the Fargate container running Express. We extend that
app to also serve the marketing site and the two API stubs:

```
ALB ── Fargate (existing) ── Express
   GET  /                      -> index.html        (static file)
   GET  /about-us|/donate|/contact -> the page html (200, served in place)
   GET  /about.html|… /index.html  -> 301 to the clean URL
   GET  /assets/*              -> static assets
   POST /api/checkout-session  -> 501 stub (REQ-029, logic out of scope)
   POST /api/contact           -> 501 stub (REQ-030, logic out of scope)
   GET  /health                -> unchanged
```

The static pages stay plain HTML at the repo root (REQ-001) — **no build step is
introduced** for them; Express just serves the files. The placeholder
`GET /` renderer (`src/routes/home.ts`) is **replaced** by serving the real
`index.html`, so `home.ts` and `test/unit/home.test.ts` are removed.

### Clean URLs: `_redirects` becomes the single source of truth

`createSiteRouter` parses the existing repo-root `_redirects` (from TASK-002) and
applies each rule: `200` → serve the target file at the clean path; `301!` →
permanent redirect. So one file drives both the Express runtime *and* any future
static host, and `clean-urls.test.ts` keeps guarding it. `/` is served as
`index.html` explicitly (no `_redirects` rule, per TASK-002).

### Site root resolution

`siteRoot = resolve(__dirname, "..")` (CommonJS): repo root locally and under
`tsx`, `/app` in the container. Only `/` + the clean URLs + `/assets` are served
(explicit `sendFile` + `express.static` on `assets/` only) — repo files like
`package.json` are never exposed.

### Packaging

The runtime Docker image must now contain the site, so the runtime stage copies
`index.html about.html donate.html contact.html _redirects` and `assets/` into
`/app`. (README's "not part of the image" note is updated.) `.dockerignore`
already permits these.

## Components

- `src/routes/site.ts` — `parseRedirects(text): Rule[]` (pure, unit-tested) +
  `createSiteRouter(siteRoot): Router`.
- `src/routes/api.ts` — `apiRouter` with the two `501` stubs, each returning
  `{ error: "Not Implemented", requirement: "REQ-029"|"REQ-030" }`.
- `src/app.ts` — mount `apiRouter`, `healthRouter`, `createSiteRouter(siteRoot)`;
  drop the home router.
- Remove `src/routes/home.ts`, `test/unit/home.test.ts`.
- `Dockerfile` — copy the static site into the runtime image.

## Fonts & images (perf)

- **Fonts:** keep the existing **system font stack** — zero web-font downloads,
  the lowest-weight option, trivially within "≤ 2 font files". Policy documented:
  any future web fonts are capped at two families, self-hosted subset `woff2`,
  `font-display:swap`.
- **JS:** already non-render-blocking (`<script defer>`); kept, and enforced.
- **Images:** none yet; the required pattern (intrinsic `width`/`height`,
  `loading="lazy"`, modern formats, no framework bundles) is documented and
  enforced for any `<img>` that later appears.

## Performance budget (mobile) — documented in README

| Metric | Budget |
|---|---|
| Lighthouse Performance (mobile) | ≥ 95 |
| Total transfer / page | ≤ 150 KB |
| Requests / page | ≤ 15 |
| Font files | ≤ 2 |
| LCP (mobile) | < 2.5 s |

## Testing (golden rules 1 & 5)

- `test/unit/site.test.ts` — `parseRedirects` returns the expected rule set.
- `test/unit/perf-budget.test.ts` — per page: summed bytes of its resources
  (html+css+js, an uncompressed proxy for transfer) ≤ cap; ≤ 2 font files;
  every `<script src>` has `defer`/`async`/`module` (no render-blocking JS);
  one stylesheet; any `<img>` has `width`+`height`+`loading="lazy"`; request
  count ≤ cap. Budget constants live in the test.
- `features/site.feature` + steps — BDD over the live app: `/`, `/about-us`,
  `/donate`, `/contact` → 200 with the right page; `/about.html` → 301 →
  `/about-us`; `POST /api/checkout-session` and `POST /api/contact` → 501. This
  is the acceptance check at the HTTP layer.
- Real **Lighthouse** can't run in CI (needs headless Chrome); README documents
  the manual command. The structural budget test is the CI gate.
- Existing `static-site`, `clean-urls`, `seo-metadata`, `config` tests and the
  `health` feature stay green (the `/` home scenario still matches because
  `index.html` contains "Charity Site").

## Out of scope

- The endpoints' real logic (REQ-029 checkout, REQ-030 contact).
- A static-host/serverless deploy (Paths B/C) and the share-image asset (REQ-034).

## Files

- New: `src/routes/site.ts`, `src/routes/api.ts`, `test/unit/site.test.ts`,
  `test/unit/perf-budget.test.ts`, `features/site.feature`,
  `features/steps/site.steps.js`, this spec.
- Edit: `src/app.ts`, `Dockerfile`, `README.md`.
- Remove: `src/routes/home.ts`, `test/unit/home.test.ts`.
- Unchanged but now runtime-load-bearing: `_redirects`, the four pages, `assets/`.
