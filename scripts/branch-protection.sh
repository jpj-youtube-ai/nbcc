#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Apply the desired branch-protection ruleset for `main`, idempotently.
#
# Run by an admin (needs the `repo` scope on a token that can administer the
# repo). Codifies the rule so it is reproducible and reviewable instead of
# living only in the GitHub UI.
#
# Policy:
#   - PRs only; the `test` check (pr.yml) must be green.
#   - 0 required approving reviews and code-owner reviews OFF, so the green check
#     is the only required gate: any PR that passes CI self-merges (the dev who
#     built it reviews locally, then merges their own PR).
#   - Linear history; no force-pushes; no branch deletion.
#
# IMPORTANT: GitHub ignores code-owner reviews entirely when
# required_approving_review_count is 0 — so leaving require_code_owner_reviews on
# would be misleading (it enforces nothing). It is explicitly OFF here to match
# reality. CODEOWNERS still auto-requests the owner as a reviewer, but that
# review is advisory, not required. To actually gate sensitive paths you must set
# required_approving_review_count to >= 1 AND turn code-owner reviews back on.
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
    "require_code_owner_reviews": false,
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
