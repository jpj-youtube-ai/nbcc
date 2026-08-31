#!/usr/bin/env bash
# Poll the health endpoint until it returns 200 or we give up, and — when given an expected
# commit — check the service is actually RUNNING that build.
#
# Used by both the PR job (localhost, liveness only) and the deploy job (ALB URL + SHA).
#
# WHY THE SECOND ARGUMENT EXISTS (TASK-332). This script used to ask one question: "is anything
# alive at this URL?" That is not the question a deploy needs answered. On 31 Aug three
# consecutive production deploys reported success while shipping nothing: the new containers
# failed to start, ECS's circuit breaker rolled back to the previous ones, `aws ecs wait
# services-stable` then succeeded (the service IS stable — on the old revision), and this
# script cheerfully confirmed the OLD build was answering /health. Two days of changes sat
# merged and undeployed with every signal green.
#
# A deploy gate that cannot tell "shipped" from "silently reverted" is not a gate. With the SHA
# passed in, it now asserts the running service reports the commit we just built.
#
# -L: production redirects HTTP->HTTPS, so follow it and check the FINAL response. -k: the
# redirect lands on the ALB's own hostname while the cert is for nbcc.scot, so skip cert
# verification for this internal probe (it checks liveness, not TLS).
set -euo pipefail
URL="${1:?usage: smoke.sh <base-url> [expected-sha]}"
EXPECTED="${2:-}"

for i in $(seq 1 20); do
  body="$(curl -s -k -L "${URL}/health" || true)"
  code="$(curl -s -o /dev/null -w '%{http_code}' -k -L "${URL}/health" || true)"

  if [ "$code" = "200" ]; then
    if [ -z "$EXPECTED" ]; then
      echo "smoke ok (${URL})"
      exit 0
    fi
    # Tolerate any JSON shape: just look for the SHA in the body.
    case "$body" in
      *"$EXPECTED"*)
        echo "smoke ok (${URL}) running ${EXPECTED}"
        exit 0
        ;;
    esac
    echo "attempt ${i}: alive but not yet running ${EXPECTED} (${body}), retrying..."
  else
    echo "attempt ${i}: got '${code}', retrying..."
  fi
  sleep 6
done

if [ -n "$EXPECTED" ]; then
  echo "smoke FAILED against ${URL}: the service never reported ${EXPECTED}."
  echo "It is alive, so this is almost certainly a rollback: the new tasks did not start and"
  echo "ECS reverted to the previous ones. Check the ECS service events for the reason."
  exit 1
fi
echo "smoke failed against ${URL}"
exit 1
