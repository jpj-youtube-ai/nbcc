#!/usr/bin/env bash
# Poll the health endpoint until it returns 200 or we give up.
# Used by both the PR job (localhost) and the deploy jobs (ALB URL).
set -euo pipefail
URL="${1:?usage: smoke.sh <base-url>}"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${URL}/health" || true)"
  if [ "$code" = "200" ]; then
    echo "smoke ok (${URL})"
    exit 0
  fi
  echo "attempt ${i}: got '${code}', retrying..."
  sleep 6
done
echo "smoke failed against ${URL}"
exit 1
