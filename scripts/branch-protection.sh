#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Apply the desired branch-protection ruleset for `main`, idempotently.
#
# Run by an admin (needs the `repo` scope on a token that can administer the
# repo). Codifies the rule so it is reproducible and reviewable instead of
# living only in the GitHub UI.
#
# Policy (only the approval count was relaxed from 1 -> 0 vs the original):
#   - PRs only; the `test` check (pr.yml) must be green.
#   - 0 required approving reviews, BUT code-owner review is still required on
#     CODEOWNERS paths (infra, CI, config/secrets, migrations, Dockerfile,
#     CLAUDE.md). So a green PR that touches no owned path can merge without a
#     separate human approval; anything sensitive still needs the owner.
#   - Linear history; no force-pushes; no branch deletion.
#   - Stale reviews dismissed on new pushes.
#
# Usage:  GH_REPO=jpj-youtube-ai/nbcc ./scripts/branch-protection.sh
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="${GH_REPO:-jpj-youtube-ai/nbcc}"
BRANCH="${BRANCH:-main}"

echo "Applying branch protection to ${REPO}@${BRANCH}..."

gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["test"] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false
}
JSON

echo "Done. Current required_approving_review_count:"
gh api "repos/${REPO}/branches/${BRANCH}/protection/required_pull_request_reviews" \
  -q .required_approving_review_count
