# charity-site

Containerised TypeScript service on AWS Fargate, fronted by an ALB, with a
Postgres (RDS) database and a couple of external API integrations. Two
environments (staging, production) with a build-once, promote-the-same-artifact
pipeline.

## What's here

```
src/                 Express + TypeScript app (health check, config, db, clients)
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

A standalone four-page static site lives at the repo root, independent of the
Express service: `index.html` (Home), `about.html` (About), `donate.html`
(Donate), `contact.html` (Contact). Each is a complete HTML5 document that links
the **one** shared stylesheet `assets/css/styles.css` and the **one** shared
script `assets/js/main.js` (loaded with `defer`) — no inline or per-page
styles/scripts. View it by opening any page in a browser, or by serving the repo
root with any static file server.

It is intentionally a skeleton: navigation, footer, and page content sections
arrive in their own requirements (REQ-002, REQ-003, REQ-010+) and are empty
placeholders in the markup for now. The shared-asset wiring is verified by
`test/unit/static-site.test.ts` (`npm run test:unit`). The site is not part of
the container image (the Dockerfile copies only `src/`, `migrations/`, and build
config), so it does not affect the service build or deploy.

### Clean URLs

Each page is served at a clean, canonical URL (no `.html`):

| Clean URL   | Serves        |
|-------------|---------------|
| `/`         | `index.html`  |
| `/about-us` | `about.html`  |
| `/donate`   | `donate.html` |
| `/contact`  | `contact.html`|

The mapping lives in the repo-root **`_redirects`** file, a host-agnostic
Netlify-style format honoured natively by **Netlify** and **Cloudflare Pages**:

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
automatically, so it needs no rewrite rule. This is URL mapping only; it does
**not** pick the host (REQ-033).

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

To exercise the acceptance check locally, serve the repo root with any static
server that honours `_redirects` (e.g. `npx netlify dev`) and request `/`,
`/about-us`, `/donate`, `/contact`. The mapping itself is verified host-free by
`test/unit/clean-urls.test.ts` (`npm run test:unit`).

### SEO & social metadata

Every page's `<head>` carries a unique set of SEO + social-share tags following
one shared structure (same tags/order on each page; only the values differ):
`<title>`, `<meta name="description">`, a `<link rel="canonical">`, Open Graph
(`og:type`/`og:site_name`/`og:title`/`og:description`/`og:url`/`og:image`) and
Twitter card tags. `canonical` and `og:url` are absolute and match the clean URL
above; no title/description/canonical is duplicated across pages. Verified by
`test/unit/seo-metadata.test.ts`.

> **Placeholder domain:** canonical/`og:url`/`og:image` use
> `https://www.example.org` because no production domain exists yet (hosting is
> REQ-033). Replace it across the four pages + `test/unit/seo-metadata.test.ts`
> in one find/replace when the real domain lands. The share image
> (`/assets/img/og-image.png`) is **referenced only** — the asset/pipeline is
> REQ-034.

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
