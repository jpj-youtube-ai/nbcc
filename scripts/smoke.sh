#!/usr/bin/env bash
# Poll the health endpoint until it returns 200 or we give up.
# Used by both the PR job (localhost) and the deploy jobs (ALB URL).
#
# -L: production redirects HTTP->HTTPS (the nbcc.scot HTTPS listener), so the plain-HTTP ALB URL the
# deploy passes returns 301 — follow it and check the FINAL code. -k: the redirect lands on the ALB's
# own hostname while the cert is for nbcc.scot, so skip cert verification for this internal health
# probe (it checks liveness, not TLS). Staging is HTTP-only, so neither flag changes its behaviour.
set -euo pipefail
URL="${1:?usage: smoke.sh <base-url>}"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -k -L "${URL}/health" || true)"
  if [ "$code" = "200" ]; then
    echo "smoke ok (${URL})"
    exit 0
  fi
  echo "attempt ${i}: got '${code}', retrying..."
  sleep 6
done
echo "smoke failed against ${URL}"
exit 1
