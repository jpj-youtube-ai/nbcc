# charity-site

Containerised TypeScript service on AWS Fargate, fronted by an ALB, with a
Postgres (RDS) database and a couple of external API integrations. Two
environments (staging, production) with a build-once, promote-the-same-artifact
pipeline.

## What's here

```
src/                 Express + TypeScript app (health, static site, /api stubs, config, db)
migrations/          node-pg-migrate migrations (expand-contract)
test/unit/           Vitest unit tests (DB-free)
features/            Cucumber BDD (.feature + JS step defs)
scripts/             bootstrap-aws.sh, branch-protection.sh (one-time) + smoke.sh
infra/modules/app/   Reusable Terraform module (VPC, ALB, ECS, RDS, secrets)
infra/envs/          Thin per-env roots: staging/ and production/
.github/workflows/   pr.yml, deploy-staging.yml, deploy-prod.yml, infra.yml
.claude/             Claude Code automation (hooks, reviewer agents, skills)
.mcp.json            MCP servers for this repo (github, postgres)
index.html …         Static site: Home, About, Donate, Contact (HTML pages)
assets/              Shared site stylesheet (css/styles.css) + script (js/main.js)
_redirects           Clean-URL rewrite/redirect rules for the static site
```

## Static site

A four-page static site lives at the repo root and is **served by the Express
service** (TASK-005 / REQ-033): `index.html` (Home), `about.html` (About),
`donate.html` (Donate), `contact.html` (Contact). Each is a complete HTML5
document that links the **one** shared stylesheet `assets/css/styles.css` and the
**one** shared script `assets/js/main.js` (loaded with `defer`) — no inline or
per-page styles/scripts, no build step. View it by opening any page in a browser,
or by running the app (below) and visiting the clean URLs.

It is intentionally a skeleton: navigation, footer, and page content sections
arrive in their own requirements (REQ-002, REQ-003, REQ-010+) and are empty
placeholders in the markup for now. The shared-asset wiring is verified by
`test/unit/static-site.test.ts` (`npm run test:unit`). `src/routes/site.ts`
serves `/`, the clean URLs and `/assets`, and the Dockerfile copies the four
pages + `assets/` + `_redirects` into the runtime image — so the marketing site
ships and deploys with the service.

### Clean URLs

Each page is served at a clean, canonical URL (no `.html`):

| Clean URL   | Serves        |
|-------------|---------------|
| `/`         | `index.html`  |
| `/about-us` | `about.html`  |
| `/donate`   | `donate.html` |
| `/contact`  | `contact.html`|

The mapping lives in the repo-root **`_redirects`** file, a host-agnostic
Netlify-style format. The Express site router (`src/routes/site.ts`) parses it
and applies the same rules at runtime, and the file is also honoured natively by
**Netlify** / **Cloudflare Pages** for any future static host:

```
/about-us      /about.html     200    # rewrite: serve the page, URL stays clean
/donate        /donate.html    200
/contact       /contact.html   200
/index.html    /               301!   # canonicalise raw .html onto the clean URL
/about.html    /about-us       301!   # ! forces the redirect over the real file
/donate.html   /donate         301!
/contact.html  /contact        301!
```

`200` is a *rewrite* (content served, address bar unchanged); `301!` is a forced
permanent redirect — the `!` is required because the `.html` files physically
exist and would otherwise be served directly. `/` serves `index.html`
automatically, so it needs no rewrite rule. REQ-033 (hosting) is resolved by
serving the site from the existing Express/ECS service (see the API + budget
notes below); the same `_redirects` file stays valid for a static host later.

**Equivalent rules on other hosts** (if `_redirects` isn't honoured), should the
host decision land elsewhere:

- **Netlify `netlify.toml`** — one block per rule:
  ```toml
  [[redirects]]
  from = "/about-us"
  to = "/about.html"
  status = 200
  [[redirects]]
  from = "/about.html"
  to = "/about-us"
  status = 301
  force = true
  ```
- **Vercel `vercel.json`** — `rewrites` for the clean URLs, `redirects` (with
  `"permanent": true`) for the `.html → clean` canonicalisation.
- **nginx** — `location = /about-us { try_files /about.html =404; }` for the
  rewrite, plus `location = /about.html { return 301 /about-us; }`.
- **Apache `.htaccess`** — `RewriteRule ^about-us$ about.html [L]` for the
  rewrite, plus `RewriteRule ^about\.html$ /about-us [R=301,L]`.

To exercise the acceptance check locally, run the app (`npm run build && node
dist/index.js`) and request `/`, `/about-us`, `/donate`, `/contact`. The
`features/site.feature` BDD asserts this end-to-end against the running app, and
`test/unit/clean-urls.test.ts` + `test/unit/site.test.ts` verify the rules
host-free. The `_redirects` file also works as-is on a static host
(e.g. `npx netlify dev`).

### Navigation

Every page mounts the same sticky top nav in its `<header class="nav">` slot
(REQ-002, ported from the NBCC design): the logo lockup (50px) linking to `/`,
links to `/`, `/about-us`, `/donate`, `/contact`, a persistent Donate button, and
a mobile burger.
Behaviour lives in the one shared `assets/js/main.js` (`initNav`): a passive +
`requestAnimationFrame`-throttled scroll listener flips the bar from transparent
to a cream/hairline/shadow state past 24px; the burger toggles the link panel
(`aria-expanded`/`aria-controls`) and Escape closes it and restores focus. The
current page's link is marked `class="active" aria-current="page"`. Verified by
`test/unit/nav.test.ts` (static markup + jsdom behaviour).

> The brand is the **master logo lockup** (nav 50px, footer 74px) — a lightweight
> ~12 KB display-sized PNG at `assets/img/nbcc-logo.png` with `alt`, intrinsic
> `width`/`height` and `loading="lazy"`. The optimised/responsive asset pipeline
> is REQ-034. Page `<title>`s still carry the "Charity Site" placeholder (a later
> rename).

### Footer

Every page mounts the same maroon footer in its `<footer class="site-footer">`
slot (REQ-003, ported from the NBCC design), **identical across all four pages**:
three columns — the logo lockup (74px) + social links (Instagram/Facebook/X),
**Explore** (the clean URLs `/`, `/about-us`, `/donate`, `/contact`), and
**Ways to give** (`/donate`, `/contact`) — plus a legal strip with the SCIO line
and the OSCR registration link for charity **SC047995**. Styling lives in the
shared `assets/css/styles.css` under a commented `FOOTER (REQ-003)` block (maroon
background, cream text, reuses `--maroon`/`--cream`/`--line`/`--maxw`; columns
stack at ≤680px). The logo is the only `<img>` (social icons are inline SVG) and
declares width/height + `loading="lazy"`, so the perf budget holds. Verified by
`test/unit/footer.test.ts`.

### SEO & social metadata

Every page's `<head>` carries a unique set of SEO + social-share tags following
one shared structure (same tags/order on each page; only the values differ):
`<title>`, `<meta name="description">`, a `<link rel="canonical">`, Open Graph
(`og:type`/`og:site_name`/`og:title`/`og:description`/`og:url`/`og:image`) and
Twitter card tags. `canonical` and `og:url` are absolute and match the clean URL
above; no title/description/canonical is duplicated across pages. Verified by
`test/unit/seo-metadata.test.ts`.

> **Placeholder domain:** canonical/`og:url`/`og:image` use
> `https://www.example.org` because there's no production domain / custom
> hostname yet. Replace it across the four pages + `test/unit/seo-metadata.test.ts`
> in one find/replace when the real domain lands. The share image
> (`/assets/img/og-image.png`) is **referenced only** — the asset/pipeline is
> REQ-034.

### Brand colour system (REQ-004)

All colours are defined once as CSS custom properties in a single `:root` block in
`assets/css/styles.css`. The six official NBCC colours — Deep Crimson `#C02238`
(`--crimson`), Rich Maroon `#800000` (`--maroon`), Natural Cream `#F8F5EE`
(`--cream`), Elfin Tan `#D29C8A` (`--tan`), Dark Slate `#333333` (`--slate`),
Holly Green `#1A531A` (`--holly`) — plus derived surfaces `--card`, `--line`,
`--tan-soft`, `--holly-soft`, `--slate-soft` (and `--cream-NN` alpha tints for
dark surfaces). **Every `color`/`background`/`border` value references a
`var(--…)` token**; the only hex/rgb literals live inside `:root`.

Contrast rule: body/long-form text is never set in Elfin Tan or Holly Green on
cream/card surfaces. Enforced by `test/unit/brand-colours.test.ts`. Typography is
documented below (REQ-005); the logo asset is REQ-034.

### Typography (REQ-005)

Two families, both **self-hosted** as latin-subset `woff2` in `assets/fonts/` (one
weight each, to stay within the perf budget's ≤ 2 font files): **Playfair Display
700** for headings (`--font-head`, set in `var(--crimson)`) and **Poppins 400**
for body, nav, buttons and labels (`--font-body`). Each token includes a system
fallback stack. Sizes come from `clamp()` scale tokens — `--fs-hero`,
`--fs-page-intro`, `--fs-section`, `--fs-lede`, `--fs-body`, `--fs-eyebrow`. The
two `@font-face` blocks live in the one shared stylesheet (no build step); other
weights (e.g. nav/footer 500/600) synthesise from the single weight. **Google
Fonts** (preconnect + a non-`.css` stylesheet link per page) is the documented
alternative. Enforced by `test/unit/typography.test.ts`.

### Layout, radius and shadow tokens (REQ-006)

Layout primitives live in the same canonical `:root` as the colours and type:

- **Width & padding:** `--maxw: 1180px` caps the shared content container, with
  fluid side padding `--pad: clamp(20px, 5vw, 48px)`. The nav, footer and
  `.site-main` all use this pair, so every page region lines up at 1180 px.
- **Radius:** `--radius: 16px` (cards), `--radius-lg: 24px` (large cards/figures),
  `--radius-pill: 999px` (pills/buttons).
- **Shadows:** three levels, all **warm-tinted off maroon `#800000`** (not neutral
  grey) — `--shadow-sm`, `--shadow`, `--shadow-lg`.
- **Sticky-nav offset:** `--nav-h: 78px`; headings and `[id]` anchors get
  `scroll-margin-top: calc(var(--nav-h) + 1rem)` so anchored content isn't hidden
  under the fixed nav.

Every padding/radius/shadow value references a token (no inline literals — keeps
the brand-colours contract). Enforced by `test/unit/layout-tokens.test.ts`.

### Brand marks (REQ-007)

The signature divider — a thin **Holly Green** hairline with a centred **crimson**
diamond — is the `.rule` component in the shared stylesheet (`BRAND MARKS`
block). It's drawn entirely with pseudo-elements (`::before` = the hairline,
`::after` = a rotated-square diamond with a `--cream` halo) — **no image**, so the
perf budget is unaffected — and uses token-only colours (`--holly`, `--crimson`).
Use it **sparingly, directly under a heading** (`<div class="rule"></div>` sits
under each page `<h1>`); later section heads reuse the same class. Enforced by
`test/unit/brand-marks.test.ts`.

The same `BRAND MARKS` block also sizes the **master logo lockup** — `.brand img`
(nav, 50px) and `.foot-brand img` (footer, 74px) — and gives it clear space (the
footer `margin-bottom` plus the nav `.wrap` gap). The lockup is used whole; see
the Navigation note for the asset (REQ-034 owns the optimised pipeline).

### Motion system (REQ-008)

Restrained, token-driven motion (`--ease`, `--motion-fast`, `--motion`,
`--reveal`, consistent with the nav timings) in the shared `MOTION` CSS block:

- **Scroll reveal:** `.reveal` starts faded + nudged down; `initReveal` in
  `assets/js/main.js` (exported alongside `initNav`) uses an `IntersectionObserver`
  to add `.is-visible` as each element enters the viewport.
- **Hover lifts:** interactive surfaces lift `translateY(-1px)` on hover, following
  the `.nav-cta` pattern — extended to `.card` / `.btn` / `.tier` so they inherit
  it when those arrive (REQ-009).
- **Reduced-motion off-switch (REQ-032):** `@media (prefers-reduced-motion:
  reduce)` disables all transitions/animations (`none !important`) and forces
  `.reveal` fully visible. `initReveal` also reveals everything immediately when
  reduced motion is set or `IntersectionObserver` is unavailable — content is
  never left hidden.

The elements that carry `.reveal` (hero, pillars, tiers) arrive in REQ-010+; this
ships the system + the guard. Verified by `test/unit/motion.test.ts`.

### Global UI components (REQ-009)

Reusable, token-only components in the shared `GLOBAL UI COMPONENTS` block:

- **Buttons** — `.btn` is the pill base (mirrors the `.nav-cta` pattern:
  `--radius-pill`, Poppins, `11px 24px`, `--shadow-sm`) with three variants:
  `.btn-primary` (crimson fill / cream text, maroon hover), `.btn-ghost`
  (transparent + maroon outline/text, fills maroon on hover), `.btn-holly` (holly
  fill / cream text). An **animated arrow** (`.btn::after`, a pseudo-element)
  slides on hover/focus, gated by `--motion-fast`/`--ease` so the
  prefers-reduced-motion off-switch disables it — no `<img>`.
- **Card** — `.card` is the shared surface (`var(--card)` bg, `var(--line)`
  hairline, `var(--shadow)`, `var(--radius)`; `.card-lg` uses `--radius-lg`).

`.btn`/`.card`/`.tier` inherit the hover-lift transition from the MOTION block —
it isn't re-declared. All colours are tokens (no hex/rgb outside `:root`). The
consumers (pillars/tiers/reassurance/team) mount these classes in REQ-010+; this
ships only the system. Verified by `test/unit/ui-components.test.ts`.

### Home hero (REQ-010)

`index.html`'s `<main>` opens with the hero — the first page to mount the design
system as content. It **reuses** existing systems only: the `.btn`/`.card`
components (REQ-009), the `.rule` divider + logo lockup (REQ-007), `.reveal`
(REQ-008) and the `:root` tokens. A `HOME HERO (REQ-010)` CSS block adds only
hero-specific layout (two-column grid stacking ≤680px, `.eyebrow`, `.hero-emph`,
proof-card positioning) — token-only colours.

Content: a crimson eyebrow ("Volunteer run Scottish charity"), an H1 with
"forgotten" emphasised maroon italic (`.hero-emph`), a lede on the volunteer run,
year round mission, two CTAs (**Donate now** `.btn-primary` → `/donate`, **Who we
help** `.btn-ghost`), the logo lockup as the illustration, and a floating proof
card (`.card`) reading "7,657 Red Bags Full of Joy delivered in 2025". Honours
the copy rules (REQ-031, no dashes) and accessibility floor (REQ-032: alt text,
keyboard-focusable CTAs). Verified by `test/unit/home-hero.test.ts`.

> The eyebrow uses crimson rather than the baseline's holly green because the
> brand-colours contrast guard forbids holly text on light surfaces; `.hero-emph`
> italic is synthesised (only Playfair 700 normal is self-hosted). The hi-res hero
> logo asset is REQ-034.

### Home pillars (REQ-011)

Below the hero, a tinted band (`HOME PILLARS` CSS block, `var(--holly-soft)`
background, `--radius-lg`) holds four `.card` pillars in a responsive grid
(4-across → 2-col ≤900px → 1-col ≤680px). Each pillar is an `<article class="card
pillar reveal">` with a decorative `aria-hidden` inline-SVG icon (crimson via
`currentColor` — the contrast guard forbids holly text), an `<h2>` title and a
one-line of leaflet copy: **Volunteer run**, **South West Scotland**, **Red Bags
Full of Joy**, **7,657 delivered in 2025**. Reuses `.card`/`.reveal`/tokens only —
no `<img>`, no new fonts, token-only colours. Verified by
`test/unit/home-pillars.test.ts`.

### Home why-your-donation-matters (REQ-012)

After the pillars, a tinted band (`HOME WHY-YOUR-DONATION-MATTERS` CSS block,
`var(--tan-soft)` background, `--radius-lg`) in a two-column layout (copy + photo
slot, stacking ≤680px). The copy column has an eyebrow ("Why your donation
matters"), an emotive `<h2>` ("Every pound reminds someone they have not been
forgotten."), the `.rule` divider under it, two leaflet paragraphs, and a
**Support NBCC** `.btn-primary` linking to `/donate`. The photo column is a
`.photo-slot` placeholder (a `<figure>` with a decorative camera icon + caption,
**no `<img>` yet** — the real packing/delivery photo is REQ-034). Token-only
colours, reusing `.btn`/`.rule`/`.reveal`/`.card` tokens. Verified by
`test/unit/home-why.test.ts`.

### Closing CTA strip (REQ-013)

A reusable crimson conversion panel (`CLOSING CTA STRIP` CSS block,
`background: var(--crimson)`, cream text, `--radius-lg`, centred) at the foot of
`<main>` on **index.html and about.html only** (donate/contact are out of scope).
Each is a semantic `<section class="closing-cta reveal" aria-labelledby="...">`
with an `<h2>` and a **Donate now** `.btn-primary` → `/donate`. The structure is
shared; only the headline differs: Home is "Help us reach even more in 2026",
About is "Be part of the next chapter". On the crimson strip the global
`.btn-primary` is reused with a scoped token-only inversion (cream fill, crimson
text) so it stays high-contrast (REQ-032) — matching the prototype; the global
button is unchanged. Token-only colours, `.reveal` reused. Verified by
`test/unit/closing-cta.test.ts`.

### About intro (REQ-014)

`about.html`'s `<main>` opens with a centred intro (`ABOUT INTRO` CSS block) that
reuses the home systems: a crimson `.eyebrow` ("About us"), the base `<h1>`
("Powered by kindness, driven by community"), the `.rule` divider under it, and a
`.lede` introducing **The Night Before Christmas Campaign (NBCC)** in Annbank,
Ayrshire, supporting children, young people and vulnerable adults across South
West Scotland, from Girvan to Largs. The full name is introduced with the acronym
so the copy still leads with "NBCC" elsewhere (REQ-031). No new fonts/images,
token-only; the `.page-sections` placeholder and the closing CTA strip are kept.
Verified by `test/unit/about-intro.test.ts`.

### About our story (REQ-015)

Below the intro, a two-column "our story" section (`ABOUT OUR STORY` CSS block)
tells the founding narrative: an "Our story" `<h2>` (styled as the eyebrow), the
founding quote "Do all children get a Christmas Eve box like I do?" (Playfair
italic, crimson) attributed to **Tygan, age twelve, Annbank, 2015**, the origin
paragraphs, and a captioned headshot placeholder — a `.photo-slot` `<figure>` with
a decorative `aria-hidden` person icon and a `<figcaption>` (no `<img>` yet; the
real Tygan headshot is REQ-034). This is the one section carried from the existing
NBCC site rather than the 2025 leaflet, so its copy is flagged with a
`CONTENT VERIFICATION` HTML comment. Reuses `.photo-slot`/`.reveal`/tokens;
token-only colours. Stacks ≤680px. Verified by
`test/unit/about-our-story.test.ts`.

### API endpoints

Two marketing endpoints are wired as routes but **not yet implemented** — each
returns `501 Not Implemented` until its own requirement lands:

| Method + path | Status | Requirement |
|---|---|---|
| `POST /api/checkout-session` | `501` stub | REQ-029 (payment) |
| `POST /api/contact` | `501` stub | REQ-030 (contact form) |

They live in `src/routes/api.ts`; TASK-005 wires only the routing.

> **Hosting (REQ-033):** the marketing site and these endpoints are served by the
> **existing Express service on ECS/Fargate behind the ALB** — not a static host
> or serverless platform. This deliberately reuses the current AWS infra; the
> issue's "static deploy + serverless functions" (Vercel/Netlify) wording was
> adapted accordingly. The `_redirects` file + per-host notes above keep a
> static-host migration cheap if that ever changes.

### Performance budget

The four pages target a low-weight mobile budget:

| Metric | Budget |
|---|---|
| Lighthouse Performance (mobile) | ≥ 95 |
| Total transfer / page | ≤ 150 KB |
| Requests / page | ≤ 15 |
| Web-font files | ≤ 2 |
| LCP (mobile) | < 2.5 s |

How it's kept:

- **Fonts:** **two** self-hosted latin-subset `woff2` (Playfair Display + Poppins,
  one weight each, `font-display: swap`) — exactly at the ≤ 2 font-file cap,
  ~31 KB total. See **Typography (REQ-005)** above. Google Fonts is the documented
  alternative.
- **JS:** the one shared script loads with `defer` (never render-blocking); no
  framework bundles, no build step.
- **Images:** none yet; any `<img>` must declare intrinsic `width`/`height`, use
  `loading="lazy"`, and a modern format (WebP/AVIF).

`test/unit/perf-budget.test.ts` enforces the structural invariants (transfer
weight, ≤ 2 font files, no render-blocking JS, image attributes, request count)
in CI. A full **Lighthouse** pass needs headless Chrome, so run it manually
against the running app (mobile is Lighthouse's default form factor):

```bash
npm run build && node dist/index.js &     # serve on :3000
npx lighthouse http://localhost:3000/ --only-categories=performance --view
# repeat for /about-us, /donate, /contact
```

## Prerequisites

- Node 20, Docker, AWS CLI v2, Terraform >= 1.6
- An AWS account and a GitHub repo

## Local development

```bash
cp .env.example .env
docker compose up -d db          # Postgres only
npm ci
npm run migrate                  # apply migrations
npm run dev                      # http://localhost:3000/health
```

Or run the whole thing in containers: `docker compose up` (and
`docker compose run --rm migrate` once to migrate).

Tests:

```bash
npm run test:unit                # Vitest, no DB needed
node dist/index.js & npm run test:bdd   # Cucumber against localhost
```

## One-time AWS bootstrap

CI assumes an IAM role via OIDC and keeps Terraform state in S3 - both must
exist before any workflow runs. Run once, as an admin:

```bash
GITHUB_ORG=your-org GITHUB_REPO=charity-site ./scripts/bootstrap-aws.sh
```

Then in GitHub repo Settings:
- Create Environments `staging` and `production`; add **required reviewers** to
  `production` (this is the prod deploy approval gate).
- On each environment set a variable `AWS_ROLE_ARN` to the role ARN the script
  printed.
- Apply the `main` branch-protection ruleset: `./scripts/branch-protection.sh`
  (PRs only, green `test` check required, **0** required approving reviews; see
  the script header for the full policy). The green `test` check is the only
  required gate, so any passing PR self-merges — the dev who built it reviews
  locally, then merges. Code-owner reviews are **off**: GitHub ignores them when
  0 approvals are required, so the flag is left off rather than implying a gate
  that doesn't exist. `.github/CODEOWNERS` still auto-requests the owner as a
  reviewer, but that review is advisory. To actually gate sensitive paths, raise
  the approval count to ≥ 1 and re-enable code-owner reviews in the script.

Finally, set the real secret values (the bootstrap leaves placeholders):

```bash
aws ssm put-parameter --name /charity-site/staging/EXTERNAL_API_ONE_KEY \
  --type SecureString --value 'real-key' --overwrite
# ...repeat for EXTERNAL_API_TWO_KEY and for the production path.
```

## Provisioning infrastructure

Infra is **not** applied automatically on push (that's how a stray PR replaces
your database). Apply it deliberately:

- GitHub: **Actions -> Infra -> Run workflow -> environment: staging ->
  action: apply**. Repeat for production.
- Or locally: `cd infra/envs/staging && terraform init && terraform apply`.

Apply staging first, then production. On the very first apply the ECS service
starts with a placeholder image and is unhealthy until the first real deploy -
so run the staging pipeline (below) right after.

## Deploy flow

1. **Open a PR** -> `pr.yml` runs lint, build, migrations, **unit + BDD**.
2. **Merge to main** -> `deploy-staging.yml`:
   builds + pushes the image (tagged by commit SHA, to the shared ECR repo),
   runs migrations as a one-off task, deploys to ECS, smoke-tests `/health`,
   runs **unit + BDD against the live staging URL**, then tags a release.
3. **Promote to production manually** -> run `deploy-prod.yml`
   (**Actions -> Deploy production -> Run workflow**) with the staging-validated
   commit SHA. It deploys the *same image* to production and smoke-tests it.
   Production does **not** auto-deploy on staging success; the `production`
   environment's **required-reviewer approval** gate still applies.

Rollback is automatic: the ECS deployment circuit breaker reverts to the last
healthy task set if a deploy fails its health checks, and a failed smoke/BDD
step fails the run so a bad image never reaches production.

## Configuration

Every config value lives in `src/config/schema.ts` and `.env.example`. Locally
they come from `.env`; in AWS the same keys are SSM parameters that ECS injects
as environment variables, so the app reads `process.env` identically in both.
Secrets are never in code or in the image.

## Cost & gotchas

- Tasks run in public subnets with no NAT gateway (saves ~£25-30/mo); the
  security groups only allow inbound from the ALB. Flip to private+NAT in
  `infra/modules/app/main.tf` if you must.
- RDS is `db.t4g.micro`, single-AZ in staging, multi-AZ in prod.
- The DB password is generated and stored in SSM, so it lands in Terraform
  state - keep the state bucket locked (the bootstrap script does). Or switch
  to `manage_master_user_password = true` (noted in `rds.tf`).
- The bootstrap IAM roles are broad (PowerUser + IAM). Tighten before prod.
- HTTPS isn't wired yet - add an ACM cert + 443 listener once you have a domain.

> Generated as a starting baseline. Run `terraform validate` / `plan` and
> `npm ci` before trusting it end to end.
