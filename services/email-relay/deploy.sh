#!/usr/bin/env bash
# One-shot deploy for the NBCC email relay: deploys the Worker, sets its secrets,
# writes EMAIL_SEND_URL + CONTACT_FORWARD_URL to prod SSM, and rolls the ECS service
# so it picks them up. Idempotent — safe to re-run (put-parameter --overwrite).
#
# Prereqs (once):
#   - npm i -g wrangler && wrangler login          (Cloudflare account)
#   - Resend domain nbcc.scot verified             (DNS applied via #288)
#
# Usage (git-bash):
#   RESEND_API_KEY=re_xxx ./deploy.sh
#   # RELAY_SECRET is generated if unset; pass RELAY_SECRET=… to reuse an existing one.
set -euo pipefail
cd "$(dirname "$0")"

# git-bash/MSYS rewrites a leading "/charity-site/..." arg into a Windows path, which
# makes `aws ssm put-parameter --name /charity-site/...` fail ("must be fully
# qualified name"). Disable that path conversion for this script.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

REGION="eu-west-2"
CLUSTER="charity-site-production"
SERVICE="charity-site-production"

# --- preflight ---------------------------------------------------------------
command -v wrangler >/dev/null 2>&1 || { echo "✗ wrangler not found — run: npm i -g wrangler"; exit 1; }
command -v aws      >/dev/null 2>&1 || { echo "✗ aws CLI not found"; exit 1; }
wrangler whoami >/dev/null 2>&1     || { echo "✗ not logged in to Cloudflare — run: wrangler login"; exit 1; }
: "${RESEND_API_KEY:?✗ set RESEND_API_KEY (the re_… key) before running, e.g. RESEND_API_KEY=re_xxx ./deploy.sh}"
case "$RESEND_API_KEY" in re_*) ;; *) echo "⚠ RESEND_API_KEY doesn't start with re_ — continuing anyway";; esac

RELAY_SECRET="${RELAY_SECRET:-$(openssl rand -hex 24)}"

# --- deploy the Worker (captures the workers.dev URL) ------------------------
echo "→ wrangler deploy"
DEPLOY_OUT="$(wrangler deploy 2>&1)"
echo "$DEPLOY_OUT"
URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9._-]*\.workers\.dev' | head -1)"
[ -n "$URL" ] || { echo "✗ couldn't parse the Worker URL from deploy output — set it manually"; exit 1; }
echo "✓ deployed: $URL"

# --- set Worker secrets ------------------------------------------------------
echo "→ setting Worker secrets"
printf '%s' "$RESEND_API_KEY" | wrangler secret put RESEND_API_KEY
printf '%s' "$RELAY_SECRET"   | wrangler secret put RELAY_SECRET

# --- point the app at the relay (prod SSM) -----------------------------------
EMAIL_URL="$URL/send?key=$RELAY_SECRET"
CONTACT_URL="$URL/contact?key=$RELAY_SECRET"
echo "→ writing SSM params"
aws ssm put-parameter --region "$REGION" --overwrite --type SecureString \
  --name /charity-site/production/EMAIL_SEND_URL --value "$EMAIL_URL" >/dev/null
aws ssm put-parameter --region "$REGION" --overwrite --type SecureString \
  --name /charity-site/production/CONTACT_FORWARD_URL --value "$CONTACT_URL" >/dev/null

# --- roll the service so tasks pick up the new secrets -----------------------
echo "→ forcing ECS redeploy"
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$SERVICE" \
  --force-new-deployment >/dev/null

echo
echo "✓ done."
echo "  Worker:            $URL"
echo "  EMAIL_SEND_URL:    $URL/send?key=***"
echo "  CONTACT_FORWARD_URL: $URL/contact?key=***"
echo "  RELAY_SECRET:      $RELAY_SECRET   (also stored as a Worker secret)"
echo
echo "Test:"
echo "  curl -X POST \"$URL/send?key=$RELAY_SECRET\" -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"you@example.com\",\"fullName\":\"Test\",\"amountPence\":2500,\"currency\":\"GBP\",\"text\":\"Thanks!\",\"html\":\"<p>Thanks!</p>\"}'"
