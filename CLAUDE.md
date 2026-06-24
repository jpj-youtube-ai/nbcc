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
   a "branch off `main`, merge to `main`" flow that contradicts them. Drive the PR
   to a green merge in-session — see **PR workflow** below.
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
7. **README.md tracks every change.** Update `README.md` in the same PR as the
   change — whenever you touch setup, commands, config, routes/behaviour, project
   structure, infra, or the deploy flow, reflect it in the matching README
   section. A change that leaves README.md stale is incomplete.

## Working method: the superpowers skills are required

The **superpowers** plugin is part of how we work in this repo — not optional. It
encodes the disciplines that make the golden rules above actually hold, so
skipping a relevant skill is skipping the rule it backs. Before acting on a task,
check whether a skill applies and invoke it; if there's even a small chance one
fits, use it (see `superpowers:using-superpowers`). Announce the skill you're
using and follow it exactly.

Use them at the matching point in the work:

- **Before any feature or behaviour change** → `superpowers:brainstorming` to pin
  down intent and design before writing code.
- **Before multi-step work** → `superpowers:writing-plans`, then
  `superpowers:executing-plans` / `superpowers:subagent-driven-development`.
- **Implementing a feature or bugfix** → `superpowers:test-driven-development`.
  This is *how* golden rules 1 & 5 are met — write the test first, then the code.
- **Any bug, test failure, or surprise** → `superpowers:systematic-debugging`
  before proposing a fix.
- **Before claiming done / committing / opening a PR** →
  `superpowers:verification-before-completion` — run the checks and show the
  output; evidence before assertions.
- **Completing or merging** → `superpowers:requesting-code-review` and
  `superpowers:finishing-a-development-branch`; when given feedback,
  `superpowers:receiving-code-review`.
- **Isolated or parallel work** → `superpowers:using-git-worktrees` and
  `superpowers:dispatching-parallel-agents`.

Explicit user instructions still win where they conflict; otherwise these skills
override default behaviour. Don't rationalize your way out of a relevant skill.

## PR workflow (Claude drives this in-session: lint → wait for green → merge)

Don't open a PR and walk away — take it to a green merge in the same session,
acting as the watcher:

1. **Lint locally first (fail fast).** Run `npm run lint` (and `npm run build`)
   before you push, and fix anything red — don't spend a CI round-trip on a typo.
2. **Open the PR** off the task branch (`task-<key>-<slug>`, title starting
   `[TASK-NNN]` — see Working conventions).
3. **Wait for the checks to go green.** Block on the PR's checks until they
   finish: `gh pr checks <pr> --watch` (or watch the `PR checks` run). The required
   gate is `pr.yml` — lint, build, migrations, unit, BDD. Do not proceed while
   anything is still pending. For a long wait, hand it to a background watcher /
   subagent and continue once it reports green.
4. **Merge only on green — then do it automatically.** All checks pass ⇒
   squash-merge it yourself (`gh pr merge <pr> --squash --delete-branch`). Anything
   red ⇒ **do not merge**: open the failing job, fix the cause, push, and wait
   again. Never merge a red or still-pending PR, and never bypass the checks —
   merging to `main` deploys to staging, so a red merge ships a broken build.

The shape is a watch loop: open → wait → (green ⇒ squash-merge) / (red ⇒ fix &
repeat). This is enforced server-side too: `main` has branch protection — PRs
only, the `test` check (`pr.yml`) must be green, 1 approving review, plus
code-owner review on the paths in `.github/CODEOWNERS`. The repo owner is an admin
and can bypass in a pinch; everyone else is fully gated.

## Resolving merge conflicts

This codebase is deliberately **additive** — a feature is usually new files, and
shared files grow by appending — so most conflicts are two people *both adding*
something. Default to **keeping both sides**, not picking one:

- `src/app.ts` — mount **both** routers.
- `src/config/schema.ts` + `.env.example` — keep **both** new config keys.
- `migrations/` — keep **both** migration files. They're additive
  (expand-contract) and independent, so order between them doesn't matter; **never
  edit an already-merged migration**.
- `CLAUDE.md` / docs — keep **both** sections, and **preserve the
  `<!-- THROUGHLINE:START … END -->` block verbatim** (it is machine-managed) —
  merge other edits around it.
- `.github/CODEOWNERS`, `features/*.feature` — additive; keep both.

The exception: when both sides changed the **same logic** (not additive), do
**not** just concatenate them — that ships duplicated or broken code. Reconcile
the two intents into one correct version, and if intent is unclear, ask the other
author rather than guessing.

A resolved conflict is a code change like any other: **run `npm run lint &&
npm run build && npm run test:unit`** (and BDD if HTTP behaviour changed) before
pushing, and let the PR's `pr.yml` go green (see **PR workflow**). To keep
conflicts rare and trivial, `git rebase main` often on small, single-task PRs.

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
  The `/add-config` skill scaffolds all of these at once.

## Claude Code automation (`.claude/`)

This repo ships Claude Code tooling that mechanically enforces the rules above so
they can't be tripped by accident. It's committed and team-wide, in `.claude/`
plus `.mcp.json`. After changing anything under `.claude/`, open `/hooks` (or
restart Claude Code) so it reloads the config.

- **Hooks** (`.claude/settings.json` → `.claude/hooks/`):
  - `guard.js` (PreToolUse) **blocks** edits/commands that violate a "never edit
    / never run" rule: hand-editing `SPEC.md`, editing a migration **already
    merged to `main`** (expand-contract), editing `.env`, altering the
    machine-managed marker block, or running `terraform apply`. New/unmerged
    migrations stay editable. It **fails open** on its own errors, so a guard bug
    can never block legitimate work.
  - `check-ts.js` (PostToolUse) runs ESLint on the edited file and `tsc --noEmit`
    after any `src/`/`test/` `*.ts` edit, surfacing lint/type errors in-session
    instead of a CI round-trip (golden rule 1).
- **Reviewer subagents** (`.claude/agents/`, read-only — run at PR time):
  - `config-drift-reviewer` — verifies a new config value/secret is wired through
    every golden-rule-3 touch-point (schema, `.env.example`, SSM, task def, and
    the `exec_secrets` IAM policy for secrets).
  - `migration-safety-reviewer` — verifies a migration is additive-only
    (expand-contract) and safe to ship with a code-level rollback.
- **Skills** (`.claude/skills/`): `/add-config` and `/new-route` scaffold those
  two recipes through every required file. Invocable by you and by Claude.
- **MCP servers** (`.mcp.json`, approve on first start):
  - `github` — PRs, checks, and Actions over the GitHub MCP (OAuth on first use).
  - `postgres` — read-mostly access to the **local** dev DB via `DATABASE_URL`
    (default `localhost:5435`, matching the local port convention). **Never**
    point it at staging/prod; those creds live in SSM.

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
