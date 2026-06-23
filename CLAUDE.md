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
