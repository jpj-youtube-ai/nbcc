<!-- THROUGHLINE:START -->
## Working conventions

- **Branches:** `task-<key>-<slug>` (e.g. `task-014-event-log-table`). The board sets this at claim time.
- **PRs & commits:** the PR title and the squash commit message **start with** `[TASK-NNN]`.
- **Squash-merge:** the repo squash-merges seeded from the PR title, so each task
  lands on `master` as one clean `[TASK-NNN]` line — no per-commit linter needed.
- **One task per PR.** Each task implements exactly its linked `REQ-NNN`.

## Task pickup

- Pick an open, unclaimed task from the board; it sets your branch `task-<key>-<slug>`.
- Implement exactly the task's linked `REQ-NNN`. Work beyond it is drift and is flagged at PR time.
- Open a PR whose title starts with `[TASK-NNN]`; it squash-merges as one clean line.

## Spec contract

- `SPEC.md` is a generated projection — never hand-edit it; it is materialized from the requirement log.
<!-- THROUGHLINE:END -->

# CLAUDE.md

Instructions for Claude (and Claude Code) working in this repo. This is a
walking-skeleton baseline: it boots, serves `/health`, connects to Postgres,
and has one unit test and one BDD scenario that pass. Your job is to build
features on top of it without breaking the conventions below.

The **Working conventions** block above is Throughline-managed and governs
*workflow* (branch naming, `[TASK-NNN]` PR titles, squash-merge, the spec
contract). The rest of this file documents the *codebase* and its engineering
rules. Where the two ever appear to disagree on process, the Throughline block
wins.

## Architecture (one paragraph)

A single containerised Express + TypeScript service runs on AWS Fargate behind
an Application Load Balancer, in two environments (staging, production). It
talks to RDS Postgres and a couple of external HTTP APIs. Config comes from
environment variables (`.env` locally, SSM-injected on ECS). CI builds the
image once, runs DB migrations as a separate task, deploys to ECS, and smoke-
tests `/health`; the ECS circuit breaker rolls back failed deploys.

## Golden rules (do not violate)

1. **Every change is a green PR with tests.** Implement the change *with tests*
   and open a PR that passes lint, build, unit, and BDD before it merges. Branch
   naming and merge mechanics are set by the **Working conventions** above (task
   branches, `[TASK-NNN]` titles, squash-merge) — follow those; don't reintroduce
   a "branch off `main`, merge to `main`" flow that contradicts them.
2. **Expand-contract migrations.** A migration that ships with a code change is
   *additive only* (new table/column/index, nullable or with a default).
   Destructive changes (drop/rename column, NOT NULL on existing data) ship in
   a *later* release, after the old code is fully gone. This is what keeps a
   code-level rollback safe. Never write a destructive migration in the same
   release as the code that stops using the old shape.
3. **Config goes through the schema.** Add any new config value in
   `src/config/schema.ts` AND `.env.example` AND, for AWS, as an SSM parameter
   in `infra/modules/app/main.tf` plus the task-definition `secrets`/
   `environment` block in `infra/modules/app/ecs.tf`. Never read `process.env`
   directly outside the config module.
4. **Secrets never in code, never in the image.** They live in SSM and are
   injected at runtime. `.env` is gitignored. Don't log secret values.
5. **Tests are required.** Logic gets a Vitest unit test; user-visible
   behaviour gets a Cucumber `.feature`. Keep unit tests DB-free (test pure
   functions / schemas); use BDD for HTTP behaviour.
6. **`/health` stays fast and cheap.** It backs the load-balancer health check
   and the deploy rollback trigger. Don't add heavy work to it.

## Where things go

- HTTP routes: `src/routes/*.ts`, mounted in `src/app.ts`.
- External API clients: `src/clients/*.ts` (wrap `fetch`, read keys from config).
- DB access: import the pool from `src/db/pool.ts`.
- Migrations: `migrations/<timestamp>_<name>.js` (node-pg-migrate, CommonJS).
- Unit tests: `test/unit/*.test.ts` (Vitest).
- BDD: `features/*.feature` + `features/steps/*.js` (Cucumber, CommonJS, hit
  `process.env.BASE_URL`).
- Infra: Terraform under `infra/` — edit the reusable module in
  `infra/modules/app/`, per-env differences in `infra/envs/{staging,production}/`.
  See **Infrastructure changes (Terraform)** below and `infra/README.md`.

## How to add things

- **A route:** create `src/routes/foo.ts` exporting a `Router`, mount it in
  `src/app.ts`, add a `features/foo.feature` scenario.
- **An external API client:** add `src/clients/foo.ts`; add its base URL +
  key to the config schema, `.env.example`, and (for AWS) SSM + the task def.
- **A migration:** `npx node-pg-migrate create my_change` then edit the
  generated file. Additive only (see rule 2).
- **A config value:** schema + `.env.example` + SSM param + task def env/secret.

## Commands

```bash
npm run dev            # local dev server (tsx watch)
npm run build          # tsc -> dist/
npm run migrate        # apply migrations
npm run test:unit      # Vitest
npm run test:bdd       # Cucumber (set BASE_URL; defaults to localhost:3000)
npm run lint
```

## Deploy model (don't fight it)

- **Never run `terraform apply` from app code or an app deploy.** Infra changes
  go through `infra.yml` (plan on PR, manual apply). App deploys only build an
  image and update the ECS service.
- The image is built once in the staging pipeline and the *same* image (by SHA,
  in the shared ECR repo) is promoted to production. Don't rebuild for prod.
- Migrations run as a one-off `ecs run-task` *before* the service updates -
  never on app boot (that races across tasks and a bad migration blocks every
  task from starting).
- Rollback is the ECS circuit breaker plus the smoke/BDD gate; you don't script
  rollback by hand.

## Infrastructure changes (Terraform)

Infra lives in `infra/`, split into a **reusable module** and **thin per-env
roots**. Change the module once and both environments inherit it; use the env
roots *only* for per-environment differences. Apply through the **Infra**
workflow (plan on PR, manual `apply` via `workflow_dispatch`) — never
`terraform apply` shared state by hand, and never from an app deploy. Full
walkthrough: `infra/README.md`.

Where things live:

- **`infra/modules/app/`** — edit here for anything both envs share:
  - `main.tf` — VPC/subnets, CloudWatch log group, the generated DB password, and
    the **SSM parameters** (the `DATABASE_URL` is assembled here, including the
    required `sslmode=no-verify`).
  - `alb.tf` — ALB, target group, HTTP listener, and the three security groups
    (alb ⇽ internet:80; task ⇽ alb:`app_port`; rds ⇽ task:5432).
  - `ecs.tf` — ECS cluster, the **task definition** (container `environment` +
    `secrets`), the ECS service, and the **execution/task IAM roles**.
  - `rds.tf` — the Postgres instance.
  - `variables.tf` — every knob (with defaults); `outputs.tf` — the values the
    deploy workflows read back from state (cluster, service, family, subnets, SG,
    `alb_dns_name`).
- **`infra/envs/{staging,production}/`** — edit here ONLY for env differences.
  `main.tf` sets the module inputs that differ (CIDRs, `desired_count`,
  `multi_az`, `deletion_protection`, `skip_final_snapshot`); `backend.tf` is the
  S3 state config; `outputs.tf` re-exports module outputs. Add an env by copying a
  root.
- **`scripts/bootstrap-aws.sh`** — one-time account setup (OIDC provider, per-env
  deploy roles, the state bucket, the shared ECR repo). Only re-run when those
  change.

Common change → where to make it:

| Change | Edit |
|---|---|
| New AWS resource shared by both envs | a `.tf` in `infra/modules/app/` |
| Tune an existing resource for all envs | that resource in `infra/modules/app/` |
| Make a setting differ per env | add a `variable` (module `variables.tf`) + set it in each `infra/envs/*/main.tf` |
| **New secret/config the app reads** | SSM param in `main.tf` **+** the `secrets`/`environment` block in `ecs.tf` **+** that param's ARN in the `exec_secrets` IAM policy in `ecs.tf` **+** (app side) `src/config/schema.ts` and `.env.example` (golden rule 3) |
| Open a port / change network reachability | the security groups in `alb.tf` |
| Change DB size / version | `rds.tf` (shared); AZ/protection/snapshot are per-env knobs in the env root |
| Add HTTPS | a 443 listener + ACM cert in `alb.tf` (note already in the file) |
| A value the deploy pipeline needs | add an `output` in module `outputs.tf` **and** re-export it in each env `outputs.tf` |

Infra gotchas (these have already bitten):

- A new **secret** must be added in three places or the task won't start: the SSM
  parameter (`main.tf`), the task-def `secrets` (`ecs.tf`), AND the
  `exec_secrets` IAM policy resource list (`ecs.tf`).
- RDS **enforces TLS** (`rds.force_ssl=1`). The `DATABASE_URL` must carry
  `sslmode` (we use `no-verify`); don't drop it. Local dev uses a plain URL.
- The `production` Environment's required-reviewer gate **also gates the Infra
  `apply`** (its job runs in `environment: production`), so prod infra changes
  wait for approval too.
- The ECS service sets `lifecycle.ignore_changes = [task_definition,
  desired_count]`: **CI owns the running image and scale, Terraform owns
  everything else.** Roll a new image via a deploy, not Terraform.

## If you prefer NestJS

This skeleton is intentionally minimal Express. The structure maps cleanly:
routes -> controllers/modules, `src/config` -> `ConfigModule` with a validation
schema, clients -> injectable providers. Keep the golden rules either way.
