# Remove Staging Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the staging environment (repo + live AWS) so merging to `main` auto-deploys production directly.

**Architecture:** `deploy-prod.yml` absorbs the staging workflow's build/migrate/deploy/smoke/tag jobs and triggers on push to `main`; `pr.yml` stays the sole functional gate. Staging AWS resources are terraform-destroyed via a new `destroy` action in `infra.yml` before the staging env root leaves the repo.

**Tech Stack:** GitHub Actions, Terraform (S3 backend), AWS ECS/ECR/RDS, gh CLI.

**Spec:** `docs/superpowers/specs/2026-08-28-remove-staging-design.md`

## Global Constraints

- Branch: `task-311-remove-staging`; PR title starts `[TASK-311]`; squash-merge.
- The Throughline block in CLAUDE.md is machine-managed — never touch it.
- Never run `terraform apply`/`destroy` locally — only via `infra.yml` dispatch (guard.js also blocks it).
- No BDD may ever run against production (it POSTs real data). Post-deploy check is `scripts/smoke.sh` only.
- README.md must be updated in the same PR as the behaviour change (golden rule 7).
- Ordering is load-bearing: reviewer-gate removal → commit A push → prod infra apply (from branch) → staging destroy (from branch) → commit B (delete env root) → merge → watch first auto prod deploy.

---

### Task 1: Rework `.github/workflows/deploy-prod.yml`

**Files:**
- Modify: `.github/workflows/deploy-prod.yml` (full replacement)

**Interfaces:**
- Consumes: Terraform outputs from `infra/envs/production` state — `ecs_cluster`, `ecs_service`, `task_family`, `task_definition_arn` (added in Task 3), `task_subnet_ids_csv`, `task_security_group_id`, `public_url`.
- Produces: the only deploy pipeline; Task 5's `/ship` watches `deploy-prod.yml` on `main`.

- [ ] **Step 1: Replace the file with:**

```yaml
name: Deploy production
# Merging to main deploys production directly. pr.yml (lint, build, unit, full
# BDD against a local app + DB + Stripe stub) is the pre-merge gate; there is
# no staging environment (removed in TASK-311). The production GitHub
# Environment holds AWS_ROLE_ARN but has no required reviewers.
on:
  push:
    branches: [main]
    # Docs-only changes shouldn't rebuild/redeploy the service.
    paths-ignore:
      - "**/*.md"
  # Manual redeploy / rollback of an earlier commit (image is rebuilt from that
  # commit if its SHA tag is no longer in ECR).
  workflow_dispatch:
    inputs:
      image_sha:
        description: "Commit SHA to (re)deploy; defaults to the current main HEAD"
        required: false

permissions:
  id-token: write   # OIDC into AWS
  contents: write   # push the release tag

concurrency: deploy-production

env:
  AWS_REGION: eu-west-2
  PROJECT: charity-site
  ENVIRONMENT: production
  # `terraform init` re-downloads providers every run without a shared cache; point
  # it at a cached dir so subsequent deploys reuse the plugins (see Cache step below).
  TF_PLUGIN_CACHE_DIR: ${{ github.workspace }}/.terraform-plugin-cache

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production   # source of AWS_ROLE_ARN; no required reviewers
    steps:
      - name: Resolve deploy SHA
        run: echo "DEPLOY_SHA=${{ inputs.image_sha || github.sha }}" >> "$GITHUB_ENV"

      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.image_sha || github.sha }}
          # Full history: a dispatched commit SHA isn't always reachable in a
          # shallow (depth 1) fetch, which makes checkout fail to resolve it.
          fetch-depth: 0

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr

      - uses: docker/setup-buildx-action@v3

      - name: Resolve image + skip build if already in ECR (build once by SHA)
        id: img
        run: |
          echo "IMAGE=${{ steps.ecr.outputs.registry }}/${PROJECT}:${DEPLOY_SHA}" >> "$GITHUB_ENV"
          # Idempotent by design: the SHA tag is immutable, so if this commit's image is
          # already in ECR (e.g. a re-run after a *later* step failed — a raced infra apply,
          # a flaky migration — or a workflow_dispatch rollback), reuse it instead of
          # rebuilding. A fresh SHA still builds.
          if aws ecr describe-images --repository-name "${PROJECT}" --image-ids imageTag="${DEPLOY_SHA}" >/dev/null 2>&1; then
            echo "Image ${DEPLOY_SHA} already present in ECR — reusing (build once by SHA)."
            echo "exists=true" >> "$GITHUB_OUTPUT"
          else
            echo "exists=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Build & push image (layer-cached via GitHub Actions cache)
        if: steps.img.outputs.exists == 'false'
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ env.IMAGE }}
          # Most commits change only app code, so the base/npm-install layers restore
          # from the Actions cache instead of rebuilding — build drops from ~40s toward ~15s.
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Cache Terraform providers
        uses: actions/cache@v4
        with:
          path: ${{ env.TF_PLUGIN_CACHE_DIR }}
          key: tf-plugins-${{ runner.os }}-${{ hashFiles('infra/**/*.tf') }}
          restore-keys: tf-plugins-${{ runner.os }}-

      - uses: hashicorp/setup-terraform@v3

      - name: Read infra wiring from state
        working-directory: infra/envs/production
        run: |
          mkdir -p "$TF_PLUGIN_CACHE_DIR"
          terraform init -input=false
          {
            echo "CLUSTER=$(terraform output -raw ecs_cluster)"
            echo "SERVICE=$(terraform output -raw ecs_service)"
            echo "FAMILY=$(terraform output -raw task_family)"
            echo "TASK_DEF_ARN=$(terraform output -raw task_definition_arn)"
            echo "SUBNETS=$(terraform output -raw task_subnet_ids_csv)"
            echo "SG=$(terraform output -raw task_security_group_id)"
            echo "ALB_URL=$(terraform output -raw public_url)"
          } >> "$GITHUB_ENV"

      - name: Register new task definition (swap image only)
        run: |
          # Read TERRAFORM's managed task-def revision (env-bearing), NOT the family's "latest": a deploy
          # that raced an infra apply must never strand a Terraform-set env var like the publishable key
          # (TASK-215/216 embedded-key race). $FAMILY stays exported above for reference/back-compat.
          CURRENT=$(aws ecs describe-task-definition --task-definition "$TASK_DEF_ARN" --query 'taskDefinition')
          NEW=$(echo "$CURRENT" | jq --arg IMG "$IMAGE" '
            .containerDefinitions[0].image = $IMG
            | {family, networkMode, requiresCompatibilities, cpu, memory,
               executionRoleArn, taskRoleArn, containerDefinitions}')
          ARN=$(aws ecs register-task-definition --cli-input-json "$NEW" \
                  --query 'taskDefinition.taskDefinitionArn' --output text)
          echo "TASK_ARN=$ARN" >> "$GITHUB_ENV"

      - name: Run all DB migrations (expand phase, before deploy)
        # One Fargate task runs every DB's provisioning + migration in order, instead
        # of five separate `ecs run-task` calls. Each run-task pays ~50s of Fargate
        # cold-start regardless of how little SQL it does, so folding the five into a
        # single container command (chained with && to preserve order and fail fast)
        # cuts ~4x that startup overhead off the deploy. Order matters: each `bootstrap:*`
        # provisions its separate database + role and MUST precede that DB's `migrate:*`.
        run: |
          TASK=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
            --task-definition "$TASK_ARN" \
            --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
            --overrides '{"containerOverrides":[{"name":"app","command":["sh","-c","npm run migrate && npm run bootstrap:stories && npm run migrate:stories && npm run bootstrap:contact && npm run migrate:contact"]}]}' \
            --query 'tasks[0].taskArn' --output text)
          aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
          CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" \
                   --query 'tasks[0].containers[0].exitCode' --output text)
          echo "migration exit code: $CODE"
          [ "$CODE" = "0" ]

      - name: Deploy service
        run: |
          aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
            --task-definition "$TASK_ARN" >/dev/null
          # `wait services-stable` caps at ~10 min (40 x 15s). A slow-draining
          # deploy can converge just after that, so the waiter errors while the
          # rollout is actually fine. Retry up to 3 waits (~30 min total) before
          # failing; the ECS circuit breaker still owns real rollback.
          for attempt in 1 2 3; do
            if aws ecs wait services-stable --cluster "$CLUSTER" --service "$SERVICE"; then
              echo "service stable (attempt $attempt)"
              exit 0
            fi
            echo "services-stable wait attempt $attempt timed out; retrying"
          done
          echo "service did not stabilize after 3 waits" >&2
          exit 1

      - name: Smoke test production
        run: bash scripts/smoke.sh "$ALB_URL"

      - name: Tag release (deployed to production)
        # Only on the normal push path — a workflow_dispatch rollback of an old
        # SHA shouldn't mint a fresh release tag for it.
        if: github.event_name == 'push'
        run: |
          TAG="release-$(date +%Y%m%d)-${DEPLOY_SHA::7}"
          git tag "$TAG"
          git push origin "$TAG"
```

- [ ] **Step 2: Verify** — `git diff` the file; confirm: no `environment: staging` reference, `contents: write` present, `concurrency: deploy-production` present, no unit/BDD steps.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-prod.yml
git commit -m "[TASK-311] deploy-prod: trigger on main push, build image, tag release"
```

---

### Task 2: `infra.yml` — production-only + `destroy` action

**Files:**
- Modify: `.github/workflows/infra.yml`

**Interfaces:**
- Produces: dispatchable `destroy` action used by Task 7. NOTE: for the staging destroy dispatch (Task 7) the `environment` choice must still include `staging`; it is removed again in Task 8's commit B after the destroy.

- [ ] **Step 1: Edit** — three changes:
  1. `plan-on-pr` job matrix: `env: [staging, production]` → `env: [production]`.
  2. dispatch `action` input options: `[plan, apply]` → `[plan, apply, destroy]`.
  3. dispatch run step — replace the if/else with:

```yaml
      - working-directory: infra/envs/${{ inputs.environment }}
        run: |
          terraform init -input=false
          case "${{ inputs.action }}" in
            apply)   terraform apply   -input=false -auto-approve -no-color ;;
            destroy) terraform destroy -input=false -auto-approve -no-color ;;
            *)       terraform plan    -input=false -no-color ;;
          esac
```

  Leave the `environment` input options as `[staging, production]` for now (Task 8 trims it).

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/infra.yml
git commit -m "[TASK-311] infra workflow: destroy action; PR plans production only"
```

---

### Task 3: Export `task_definition_arn` from the production env root

**Files:**
- Modify: `infra/envs/production/outputs.tf`

**Interfaces:**
- Produces: `terraform output -raw task_definition_arn` for Task 1's "Read infra wiring" step. The module already exposes `module.app.task_definition_arn` (staging's root exports it today). The output lands in state only after Task 7's prod apply — the new deploy workflow fails on this output until then.

- [ ] **Step 1: Add** after the `task_family` line in `infra/envs/production/outputs.tf`:

```hcl
output "task_definition_arn" { value = module.app.task_definition_arn }
```

- [ ] **Step 2: Commit**

```bash
git add infra/envs/production/outputs.tf
git commit -m "[TASK-311] prod env root: export task_definition_arn for deploys"
```

---

### Task 4: Delete `deploy-staging.yml`

**Files:**
- Delete: `.github/workflows/deploy-staging.yml`

- [ ] **Step 1:**

```bash
git rm .github/workflows/deploy-staging.yml
git commit -m "[TASK-311] remove staging deploy workflow"
```

---

### Task 5: Rewrite the `/ship` skill for the no-staging flow

**Files:**
- Modify: `.claude/skills/ship/SKILL.md`

**Interfaces:**
- Consumes: `deploy-prod.yml` on `main` (Task 1), `infra.yml` apply production (Task 2).

- [ ] **Step 1: Edit** — keep the task-number section and steps 1–8 unchanged; change:
  - Frontmatter `description`: "…drives the branch to a green, merged, production-deployed state end to end. Auto-assigns the task number from GitHub Actions (latest task +1), opens the PR, watches pr.yml to green, self-merges, applies production infra if the diff touches infra/, watches the production deploy, and reports the live URL. Merging IS the production deploy — pr.yml green is the gate."
  - Title/overview: replace the "stop before prod" framing. New flow diagram:

```
number → preflight → sync → commit → push → PR → watch green
       → self-merge → (prod infra apply if infra changed) → watch prod deploy
       → report prod URL + deployed SHA
```

  - Overview paragraph: "Merging to `main` deploys production directly (there is no staging — removed in TASK-311). The only gate is `pr.yml` green; `/ship` never merges red or pending. `/ship` never dispatches a deploy by hand — the merge push triggers `deploy-prod.yml`."
  - Step 9 becomes: prod infra apply — same logic, `-f environment=production`; the race note now reads: a new SSM param/secret the task-def references must exist in production before the deploy's task-def registration, so apply immediately after merge and re-run the deploy if it lost the race.
  - Step 10 becomes: watch `deploy-prod.yml` (`gh run list --workflow=deploy-prod.yml --branch main …`); docs-only merges still skip it (`paths-ignore: **/*.md`).
  - Step 11 becomes: report the production URL (`public_url` from the run) + deployed SHA. Delete the promote-command printing.
  - Hard stops: delete "Never deploy production" and "Don't rebuild for prod"; add "**Never merge red or pending** — with no staging, the merge ships straight to production, so `pr.yml` green is the entire gate." Keep the terraform-apply and watching-the-wrong-run notes (retarget wording to `deploy-prod.yml`). Delete the "Assuming a docs-only merge deployed" promote sentence's staging references but keep the docs-only caveat.

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/ship/SKILL.md
git commit -m "[TASK-311] /ship: merge deploys production; drop promote boundary"
```

---

### Task 6: Docs — CLAUDE.md, README.md, infra/README.md

**Files:**
- Modify: `CLAUDE.md` (outside the Throughline block), `README.md`, `infra/README.md`

- [ ] **Step 1: CLAUDE.md** — grep `staging` and update every hit outside the Throughline block:
  - Architecture paragraph: "in two environments (staging, production)" → "in a single production environment".
  - PR-workflow preamble (the `/ship` blockquote): mirror Task 5's new description — merge deploys production; no promote command; "applies production infra if the diff touches `infra/`".
  - Step 4 of the manual workflow list: "merging to `main` deploys to staging" → "merging to `main` deploys to production".
  - **Deploy model** section: replace the build-once/promote bullets with: "Merging to `main` triggers `deploy-prod.yml`: build image by SHA (skip if in ECR), run migrations as a one-off task, update the ECS service, smoke-test, tag a release. There is no staging environment and no promotion step; `pr.yml` is the functional gate. Migrations still never run on app boot. Rollback: ECS circuit breaker + smoke gate, or `workflow_dispatch` `deploy-prod.yml` with an earlier SHA."
  - Infra section: env-roots wording "per-env differences in `infra/envs/{staging,production}/`" → "the production root in `infra/envs/production/` (the module stays env-agnostic; staging was removed in TASK-311)". Update the table row "Make a setting differ per env" accordingly ("set it in `infra/envs/production/main.tf`"). Gotchas: drop "The `production` Environment's required-reviewer gate also gates the Infra apply" (gate removed); reword the three-places secret gotcha to production-only phrasing if it names both envs.
- [ ] **Step 2: README.md** — update the hits found at lines ~5, 17–18, 3595, 3612–3688, 3949:
  - Intro: build-once-promote sentence → single production environment, deploy-on-merge.
  - Project structure listing: `infra/envs/` line → `production/ only`; workflows line → `pr.yml, deploy-prod.yml, infra.yml`.
  - GitHub setup section (~3595): only the `production` Environment, **no required reviewers** (holds `AWS_ROLE_ARN`).
  - SSM examples (~3612–3650): change `/charity-site/staging/…` example paths to `/charity-site/production/…`.
  - First-apply + pipeline walkthrough (~3654–3688): apply production via Infra workflow; merge to main → `deploy-prod.yml` builds/migrates/deploys/smokes/tags; delete the staging-BDD and promotion paragraphs.
  - `~3949` RDS bullet: "single-AZ in staging, multi-AZ in prod" → "multi-AZ in production".
  - Line ~3515/3538/2221 mentions: reword in place (staging no longer exists — e.g. "staging/local admins" → "local admins").
- [ ] **Step 3: infra/README.md** — same sweep (lines 11, 50, 64–72 table, 91, 109, 139, 171–191, 237–273): one environment; env table becomes a single production column; setup instructions apply production only; the deploy-flow section describes `deploy-prod.yml` on merge; ops snippets (`terraform output`, `aws logs tail /ecs/charity-site-production`) use production; the teardown note points at `infra.yml` destroy dispatch rather than local `terraform destroy`.
- [ ] **Step 4: Verify** — `grep -ni staging CLAUDE.md README.md infra/README.md`: remaining hits must be historical notes (task history, "removed in TASK-311") only, plus the untouched Throughline block.
- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md infra/README.md
git commit -m "[TASK-311] docs: single production environment, deploy on merge"
```

---

### Task 7: Ops — gate removal, prod apply, staging destroy (from the branch)

**Files:** none (gh/AWS operations). Run from the repo root; branch pushed first.

- [ ] **Step 1: Remove required reviewers from the `production` environment** (must precede the merge; JSON via `--input -`, the `-f` flag mis-types fields):

```bash
echo '{"wait_timer":0,"prevent_self_review":false,"reviewers":[],"deployment_branch_policy":null}' \
  | gh api --method PUT repos/jpj-youtube-ai/nbcc/environments/production --input -
gh api repos/jpj-youtube-ai/nbcc/environments/production --jq '.protection_rules'
```

Expected: `protection_rules` shows no `required_reviewers` entry.

- [ ] **Step 2: Push the branch** (commit A = Tasks 1–6):

```bash
git push -u origin task-311-remove-staging
```

- [ ] **Step 3: Apply production infra from the branch** — seeds `task_definition_arn` into prod state so the first auto-deploy can read it (only diff vs state is the new output — safe):

```bash
gh workflow run infra.yml -r task-311-remove-staging -f environment=production -f action=apply
gh run watch "$(gh run list --workflow=infra.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: apply green; plan shows `Changes to outputs` only (no resource changes). If resource changes appear, STOP and inspect — state may have drifted.

- [ ] **Step 4: Destroy staging** (IRREVERSIBLE — staging RDS data gone, no snapshot):

```bash
gh workflow run infra.yml -r task-311-remove-staging -f environment=staging -f action=destroy
gh run watch "$(gh run list --workflow=infra.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: destroy green (~10–15 min; RDS deletion dominates). Verify: `aws ecs list-clusters --region eu-west-2` (PowerShell) no longer lists `charity-site-staging`; `https://staging.nbcc.scot` stops resolving after DNS TTL.

---

### Task 8: Commit B — delete the staging env root + trim `infra.yml`

**Files:**
- Delete: `infra/envs/staging/` (tracked files via `git rm`; also remove the untracked `.terraform/` dir and `.terraform.lock.hcl` left on disk)
- Modify: `.github/workflows/infra.yml` (environment choices → `[production]`)

- [ ] **Step 1:** (only after Task 7 Step 4 is green)

```bash
git rm -r infra/envs/staging
rm -rf infra/envs/staging          # clears untracked .terraform/, lock file
```

- [ ] **Step 2:** In `infra.yml`, dispatch `environment` input: `options: [staging, production]` → `options: [production]`.
- [ ] **Step 3: Commit + push**

```bash
git add .github/workflows/infra.yml
git commit -m "[TASK-311] remove staging env root; infra dispatch production-only"
git push
```

---

### Task 9: Ship — PR, green, merge, watch the first auto prod deploy

- [ ] **Step 1: Preflight** — `npm run lint && npm run build && npm run test:unit` (nothing in this PR touches src/, but the gate is cheap).
- [ ] **Step 2:** Open PR `[TASK-311] Remove staging: main auto-deploys production`; `gh pr checks --watch` to green; `gh pr merge --squash --delete-branch`. (Follow `/ship`; its staging steps are already rewritten by Task 5.)
- [ ] **Step 3: Watch the first production auto-deploy:**

```bash
RID=$(gh run list --workflow=deploy-prod.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID"
```

Expected: build (fresh SHA) → migrations exit 0 → service stable → smoke green → `release-…` tag pushed. If "Read infra wiring" fails on `task_definition_arn`, Task 7 Step 3 didn't land — re-run it (from `main` now) and re-run the deploy.

---

### Task 10: Post-merge cleanup — GitHub env + memory

- [ ] **Step 1: Delete the staging GitHub environment:**

```bash
gh api --method DELETE repos/jpj-youtube-ai/nbcc/environments/staging
```

- [ ] **Step 2: Memory updates** (`C:\Users\paulp\.claude\projects\C--Users-paulp-Documents-nbcc\memory\`):
  - Rewrite `aws-deployment.md`: drop the staging URL/flow; record — single production env; merge to `main` auto-deploys prod via `deploy-prod.yml` (build by SHA, migrate, deploy, smoke, release tag); prod required-reviewer gate REMOVED 2026-08-28 (TASK-311), infra applies unattended; rollback = workflow_dispatch `deploy-prod.yml` with an earlier SHA; keep the CLI-path/ECR-immutable/MSYS gotchas.
  - Delete `infra-apply-both-envs-before-prod-promote.md`; remove its MEMORY.md index line. Add to `aws-deployment.md`: infra-before-deploy race still exists for PROD (apply infra, then re-run deploy).
  - MEMORY.md: update the `aws-deployment` hook line ("single prod env, deploy on merge, gate removed").

---

## Self-Review (done at write time)

- Spec coverage: §1→Task 1+3, §2→Tasks 2+7+8+10, §3→Tasks 4+5+6+8, §4→Tasks 7–10, memory→Task 10. No gaps.
- Destroy-before-delete ordering preserved (Task 7 before Task 8); infra.yml keeps `staging` choice until commit B.
- `task_definition_arn` naming consistent across Tasks 1/3/7/9.
