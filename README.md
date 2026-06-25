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
(REQ-002, ported from the NBCC design): brand → `/`, links to `/`, `/about-us`,
`/donate`, `/contact`, a persistent Donate button, and a mobile burger.
Behaviour lives in the one shared `assets/js/main.js` (`initNav`): a passive +
`requestAnimationFrame`-throttled scroll listener flips the bar from transparent
to a cream/hairline/shadow state past 24px; the burger toggles the link panel
(`aria-expanded`/`aria-controls`) and Escape closes it and restores focus. The
current page's link is marked `class="active" aria-current="page"`. Verified by
`test/unit/nav.test.ts` (static markup + jsdom behaviour).

> Uses the **nav-relevant token subset** from the NBCC baseline
> (`--crimson`/`--maroon`/`--cream`/`--line`…); the full design-token system and
> web fonts are REQ-004/006, the logo image is REQ-034, and the footer slot is
> REQ-003. The brand reads "NBCC" while page `<title>`s still carry the
> "Charity Site" placeholder (a later rename).

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

- **Fonts:** a pure **system font stack** — zero web-font downloads. If web fonts
  are ever added, cap at two families, self-host subset `woff2`, and use
  `font-display: swap`.
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
