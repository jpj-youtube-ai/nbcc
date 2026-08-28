# Remove the staging environment — design

Date: 2026-08-28
Task: TASK-311
Status: approved in-session by Paul

## Why

Staging is not used. Every merge to `main` builds, migrates, deploys and
BDD-tests a staging stack nobody looks at, and production promotion is a manual
second step that adds latency without adding review (the same person merges and
promotes). Staging also costs money continuously (ALB + Fargate + RDS).

Decision: **remove staging entirely; merging to `main` auto-deploys
production.** `pr.yml` (lint, build, unit, full BDD against a local app + DB +
Stripe stub) becomes the sole functional gate, pre-merge.

## Decisions (made with Paul in-session)

1. **Deploy flow:** auto-deploy production on merge to `main`.
2. **Live staging AWS resources:** destroy now (RDS data permanently lost —
   `deletion_protection=false`, `skip_final_snapshot=true` — accepted).
3. **Prod approval gate:** dropped. The `production` GitHub environment's
   required-reviewer gate is removed; deploys and prod infra applies run
   unattended. `pr.yml` green + squash-merge is the boundary.

## Accepted trade-off

With staging gone, a failure `pr.yml` cannot catch (ECS task fails to start on
real AWS wiring, a migration that misbehaves on real data) hits production
directly. Safety net: migrations run as a one-off task *before* the service
update, the ECS deployment circuit breaker rolls back a service that won't
stabilise, and the post-deploy smoke test fails the run loudly.

## 1. Reworked `deploy-prod.yml` (absorbs the staging workflow's jobs)

Triggers:

- `push` to `main` with `paths-ignore: "**/*.md"` (docs-only merges deploy
  nothing) — the new normal path.
- keeps `workflow_dispatch` with an **optional** `image_sha` input for manual
  redeploys / rollbacks of an already-built image. When omitted, the checked-out
  `github.sha` is used.

Steps (merging the best of both current workflows):

1. OIDC into AWS, ECR login, buildx.
2. **Build once by SHA, skip if present** — the idempotent
   `ecr describe-images` check + GHA layer cache, ported from
   `deploy-staging.yml`. This replaces prod's "never build" assumption: the
   image is now built here because there is no staging pipeline to build it.
3. Read wiring from `infra/envs/production` Terraform state — including
   **`task_definition_arn`**, porting the TASK-215/216 embedded-key race fix to
   prod (the current prod workflow reads the family's latest revision, which
   can strand a Terraform-set env var; staging already read Terraform's
   managed revision). Requires `task_definition_arn` to be exported from
   `infra/envs/production/outputs.tf` (add if missing — module already
   outputs it).
4. Register new task definition (swap image only).
5. Run all DB migrations as one Fargate run-task (expand phase, before deploy),
   same chained command as today.
6. `update-service` + `services-stable` wait with the existing 3-attempt retry.
7. Smoke test the prod ALB URL (`scripts/smoke.sh`).
8. Tag `release-YYYYMMDD-<sha7>` and push the tag (needs `contents: write`).

**No BDD against production.** The staging pipeline's post-deploy BDD run
(`not @db and not @stub-only`) exercises public POST endpoints (signup,
donation flows) and would write junk into real production data. Smoke only.

The job keeps `environment: production` — that is where the `AWS_ROLE_ARN`
variable lives — but the environment no longer has required reviewers.

`concurrency: deploy-production` serialises overlapping merges.

## 2. Destroying staging

- `infra.yml` gains a third dispatch action: `destroy`
  (`terraform destroy -auto-approve`). Kept permanently — small and useful.
- Dispatch it for staging **from the task branch** (`gh workflow run -r
  task-311-remove-staging`) while `infra/envs/staging/` still exists on that
  branch. Tears down: ALB + listeners + cert, ECS cluster/service/task defs,
  RDS (no final snapshot), the three security groups, staging SSM parameters,
  the `staging.nbcc.scot` Route53 records, log group.
- After destroy: delete the `staging` GitHub environment (`gh api`). The
  staging S3 state key remains, empty — harmless. The staging OIDC deploy role
  created by `scripts/bootstrap-aws.sh` stays in AWS, inert (documented, not
  removed; the script is one-time bootstrap and is updated only with a comment).

## 3. Repo cleanup (same PR)

- Delete `.github/workflows/deploy-staging.yml`.
- Delete `infra/envs/staging/` (after the destroy has run green).
- `infra.yml`: PR-plan matrix and dispatch environment choices become
  `[production]` only.
- **`/ship` skill rewrite** (`.claude/skills/ship/SKILL.md`): flow becomes
  `number → preflight → sync → commit → push → PR → watch green → self-merge →
  (prod infra apply if diff touched infra/) → watch prod deploy → report prod
  URL + SHA`. The infra-race step now targets production (a task-def secret
  must exist in SSM before the deploy). The "stop at the production boundary"
  concept is gone — the boundary is `pr.yml` green + the merge itself. `/ship`
  still never dispatches a deploy by hand; the merge push triggers it.
- CLAUDE.md: "Deploy model", "PR workflow" preamble, and infra-gotcha bullets
  updated (no staging, no promotion, prod required-reviewer note removed).
  The Throughline-managed block is untouched.
- `README.md` + `infra/README.md`: deploy-flow and environments sections
  updated.
- Memory: `aws-deployment.md` rewritten for the new flow;
  `infra-apply-both-envs-before-prod-promote.md` deleted (obsolete — one env).

## 4. Order of execution

1. `gh api`: remove required reviewers from the `production` environment
   (before the merge, or the first auto-deploy stalls waiting for a click).
2. Commit everything **except** the `infra/envs/staging/` deletion on
   `task-311-remove-staging`; push. (The destroy dispatch runs the branch's
   `infra.yml` against `infra/envs/staging`, so the env root must still exist
   at that ref.)
3. Dispatch `infra.yml` `destroy` for staging from the branch; watch to green.
4. Second commit: delete `infra/envs/staging/`; push.
5. `/ship` the branch: PR → green → merge → first auto prod deploy → watch.
6. Delete the `staging` GitHub environment.

## Out of scope

- Removing the staging OIDC role / state key from AWS (inert leftovers, noted).
- Any change to `pr.yml` — it already carries the full test gate.
- Stripe test-mode webhook endpoints pointed at `staging.nbcc.scot` (none in
  use; the destroy makes the DNS name NXDOMAIN and Stripe test webhooks, if
  any exist, simply fail — nothing to migrate).
