---
name: ship
description: Use when asked to "ship" the current work, or on `/ship` — drives the branch to a green, merged, staging-deployed state end to end. Auto-assigns the task number from GitHub Actions (latest task +1), opens the PR, watches pr.yml to green, self-merges, triggers a staging infra apply if the diff touches infra/, watches the staging deploy, then STOPS at the production boundary and hands you the manual prod-promote command. Never deploys production.
---

# Ship it (implement → PR → green → staging), stop before prod

## Overview

`/ship` automates the whole safe span of the PR workflow in one go and stops at
the production gate. It does **not** deploy production — prod promotion is manual
by design (required-reviewer gate on the `production` Environment), so `/ship`
only prints the exact promote command for you to run when you choose.

The flow is a watch loop with a hard stop:

```
number → preflight → sync → commit → push → PR → watch green
       → self-merge → (staging infra apply if infra changed) → watch staging
       → report staging URL + validated SHA → STOP, print prod command
```

Red at any gate ⇒ stop, open the failing job, fix, re-push, re-watch. **Never
merge a red or still-pending PR** — merging `main` deploys staging.

## Task number: latest from Actions + 1

The number is taken from GitHub, not minted by hand:

1. **Already on a task branch** (`task-<num>-<slug>`) → use that number. Don't
   reassign.
2. **Not on a task branch** → compute the next number from Actions (plus merged
   PR titles as a collision guard) and create `task-<NNN>-<slug>`:

```bash
# highest TASK number seen across recent Actions runs + all PR titles, then +1
LAST=$( { gh run list --limit 200 --json headBranch,displayTitle \
             --jq '.[].headBranch, .[].displayTitle';
           gh pr list --state all --limit 200 --json title --jq '.[].title'; } \
        | grep -oiE 'task[-_ ]?[0-9]+' | grep -oE '[0-9]+' \
        | sort -n | tail -1 )
NEXT=$(( ${LAST:-0} + 1 ))
echo "next task number: $NEXT"
```

Then branch off `main` (take the slug from the `/ship <slug>` argument, or derive
a short kebab-case slug from the change):

```bash
git switch main && git pull --ff-only
git switch -c "task-${NEXT}-<slug>"
```

> Note: Actions+1 is a heuristic. If two ships run close together they can pick
> the same number — the run that pushes second will just re-pick on the next
> `/ship`. The PR-title cross-check above makes a collision with already-merged
> work unlikely.

## Steps (create a todo per item)

1. **Number & branch** — resolve `TASK-NNN` per the rule above; be on
   `task-NNN-<slug>`.
2. **Preflight, fail fast** — `npm run lint && npm run build && npm run test:unit`.
   Fix anything red before pushing; don't spend a CI round-trip on a typo. If the
   change adds a **config key**, confirm it's also in the `pr.yml` env block (the
   CI app-boot needs it there, beyond the schema/`.env.example`/SSM/task-def
   wiring — see the `add-config` skill).
3. **Sync** — `git fetch origin` and, if the branch already exists on the remote
   (the board may have pre-seeded it), `git rebase origin/task-NNN-<slug>`.
   Re-run build/tests if the rebase pulled in changes.
4. **Commit** — stage the intended files and commit outstanding work:
   `git commit -m "[TASK-NNN] <subject>"`. The squash-merge seeds the `main` line
   from the **PR title**, so the `[TASK-NNN]` prefix is what keeps history clean.
5. **Push** — `git push -u origin task-NNN-<slug>`.
6. **Open (or reuse) the PR** — title must start `[TASK-NNN]`:
   ```bash
   gh pr create --base main --title "[TASK-NNN] <subject>" --body "<what & why>" \
     || gh pr view --json url --jq .url   # reuse if one already exists
   PR=$(gh pr view --json number --jq .number)
   ```
7. **Watch to green** — block on the required `pr.yml` gate:
   ```bash
   gh pr checks "$PR" --watch
   ```
   For a long wait, hand this to a background watcher and continue once it reports
   green. Do not proceed while anything is pending.
8. **Merge only on green** — self-merge and delete the branch:
   ```bash
   gh pr merge "$PR" --squash --delete-branch
   ```
   Red ⇒ **do not merge**: `gh run view <run-id> --log-failed`, fix the cause,
   push, and return to step 7.
9. **Staging infra apply — only if the diff touched `infra/`.** The staging app
   deploy auto-starts on the merge push and can **race** an infra change (a new
   SSM param/secret the task-def references must exist first, or the ECS task
   won't start). If `git diff --name-only main~1 main | grep -q '^infra/'`,
   trigger the staging apply immediately after merge and watch it:
   ```bash
   gh workflow run infra.yml -f environment=staging -f action=apply
   gh run watch "$(gh run list --workflow=infra.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```
   If the app deploy failed because infra wasn't there yet, re-run it after the
   apply succeeds: `gh run rerun <deploy-staging-run-id>`.
10. **Watch the staging deploy** — merging `main` triggers **Deploy staging**
    (unless the merge was docs-only — `deploy-staging.yml` has
    `paths-ignore: **/*.md`, so a pure `.md` change deploys nothing; skip the
    watch and say so):
    ```bash
    RID=$(gh run list --workflow=deploy-staging.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
    gh run watch "$RID"
    ```
11. **Report and STOP.** On staging green, report the staging URL (the ALB
    `public_url`, echoed in the Deploy-staging run summary) and the validated SHA,
    then print — **do not run** — the prod-promote command:
    ```bash
    SHA=$(git rev-parse HEAD)   # the merged commit staging validated
    echo "PROMOTE (run yourself when ready): gh workflow run deploy-prod.yml -f image_sha=$SHA"
    ```
    Production is a human decision: the promote command waits for you.

## Hard stops (do not cross)

- **Never deploy production.** `/ship` ends at the printed promote command. The
  `production` Environment's required-reviewer gate would block an auto-dispatch
  anyway; don't try to route around it.
- **Never merge red or pending.** The green `pr.yml` `test` check is the only
  gate that keeps a broken build off `main` (and out of staging).
- **Never `terraform apply` by hand or from app code.** Infra changes go through
  the **Infra** workflow (step 9); the `guard.js` hook blocks a local
  `terraform apply`.
- **Don't rebuild for prod.** Promotion reuses the *same* staging-validated image
  by SHA (`deploy-prod.yml -f image_sha=<SHA>`).

## Common mistakes

- **Watching the wrong run** — after merge, filter runs by
  `--workflow=deploy-staging.yml --branch main` and take the newest; the merge
  also kicks other workflows.
- **Forgetting the infra race (step 9)** — a config/secret change that needs
  `infra/` applied will fail the staging task start if the app deploy wins the
  race. Apply staging infra, then re-run the deploy.
- **Assuming a docs-only merge deployed** — `**/*.md`-only merges skip Deploy
  staging entirely (`paths-ignore`); there's nothing to watch or promote.
- **Merging with a pending check** — `gh pr checks --watch` must exit green
  first; a pending gate is not a pass.
