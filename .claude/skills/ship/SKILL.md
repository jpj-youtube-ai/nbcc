---
name: ship
description: Use when asked to "ship" the current work, or on `/ship` — drives the branch to a green, merged, production-deployed state end to end. Auto-assigns the task number from GitHub Actions (latest task +1), opens the PR, watches pr.yml to green, self-merges, applies production infra if the diff touches infra/, watches the production deploy, and reports the live URL. Merging IS the production deploy — pr.yml green is the gate.
---

# Ship it (implement → PR → green → production)

## Overview

`/ship` automates the whole PR workflow in one go. Merging to `main` deploys
production directly (there is no staging — removed in TASK-312). The only gate
is `pr.yml` green; `/ship` never merges red or pending. `/ship` never
dispatches a deploy by hand — the merge push triggers `deploy-prod.yml`.

The flow is a watch loop:

```
number → preflight → sync → commit → push → PR → watch green
       → self-merge → (prod infra apply if infra changed) → watch prod deploy
       → report prod URL + deployed SHA
```

Red at any gate ⇒ stop, open the failing job, fix, re-push, re-watch. **Never
merge a red or still-pending PR** — merging `main` deploys production.

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
   push, and return to step 7. Remember: this merge ships to production.
9. **Prod infra apply — only if the diff touched `infra/`.** The production
   deploy auto-starts on the merge push and can **race** an infra change (a new
   SSM param/secret the task-def references must exist in production before the
   deploy registers its task definition, or the ECS task won't start). If
   `git diff --name-only main~1 main | grep -q '^infra/'`, trigger the
   production apply immediately after merge and watch it:
   ```bash
   gh workflow run infra.yml -f environment=production -f action=apply
   gh run watch "$(gh run list --workflow=infra.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```
   If the deploy failed because infra wasn't there yet, re-run it after the
   apply succeeds: `gh run rerun <deploy-prod-run-id>`.
10. **Watch the production deploy** — merging `main` triggers **Deploy
    production** (unless the merge was docs-only — `deploy-prod.yml` has
    `paths-ignore: **/*.md`, so a pure `.md` change deploys nothing; skip the
    watch and say so):
    ```bash
    RID=$(gh run list --workflow=deploy-prod.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
    gh run watch "$RID"
    ```
11. **Report.** On deploy green, report the production URL (the ALB
    `public_url` — https://nbcc.scot) and the deployed SHA
    (`git rev-parse HEAD` on the merged commit). The deploy run also pushed a
    `release-YYYYMMDD-<sha7>` tag — mention it.

## Hard stops (do not cross)

- **Never merge red or pending.** With no staging, the merge ships straight to
  production — the green `pr.yml` `test` check is the entire gate.
- **Never `terraform apply` by hand or from app code.** Infra changes go through
  the **Infra** workflow (step 9); the `guard.js` hook blocks a local
  `terraform apply`.
- **Never dispatch `deploy-prod.yml` to "speed up" a merge.** The push trigger
  owns normal deploys; `workflow_dispatch` with an `image_sha` is only for
  manual redeploys/rollbacks of an earlier commit.

## Common mistakes

- **Watching the wrong run** — after merge, filter runs by
  `--workflow=deploy-prod.yml --branch main` and take the newest; the merge
  also kicks other workflows.
- **Forgetting the infra race (step 9)** — a config/secret change that needs
  `infra/` applied will fail the production task start if the deploy wins the
  race. Apply production infra, then re-run the deploy.
- **Assuming a docs-only merge deployed** — `**/*.md`-only merges skip Deploy
  production entirely (`paths-ignore`); there's nothing to watch.
- **Merging with a pending check** — `gh pr checks --watch` must exit green
  first; a pending gate is not a pass.
