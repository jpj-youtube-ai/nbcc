# NBCC email relay (Cloudflare Worker → Resend)

Bridges the app's custom email payloads (`src/clients/email.ts`) to Resend. The app
POSTs its own JSON shape (no subject/from/type; auth in the URL) to `EMAIL_SEND_URL`;
this Worker discriminates the payload, renders/wraps it, and sends via Resend.

The app's `EMAIL_SEND_URL` = this Worker's URL **with the shared secret in the query**:
`https://nbcc-email-relay.<subdomain>.workers.dev/send?key=<RELAY_SECRET>`.

## One-time setup

1. **Resend account** → add domain **nbcc.scot** → Resend shows DNS records (SPF TXT,
   DKIM CNAME/TXT, a bounce/return-path record). Those go in the **Route 53** zone
   (Terraform, `infra/modules/app/dns.tf`) — hand the values to the infra change; do
   not add them at Freeola (the zone is delegated to Route 53). Verify in Resend.
2. Create a **Resend API key** (`re_…`).
3. **Cloudflare**: `npm i -g wrangler` then `wrangler login`.

## Deploy

```bash
cd services/email-relay
wrangler deploy
# set secrets (prompted for each value):
wrangler secret put RESEND_API_KEY   # the re_… key
wrangler secret put RELAY_SECRET     # a long random token (e.g. openssl rand -hex 24)
# MAIL_FROM is a [vars] entry in wrangler.toml — edit there if the sender differs.
```

`wrangler deploy` prints the Worker URL. Compose `EMAIL_SEND_URL` from it + `?key=<RELAY_SECRET>`:

```bash
aws ssm put-parameter --region eu-west-2 --overwrite --type SecureString \
  --name /charity-site/production/EMAIL_SEND_URL \
  --value "https://nbcc-email-relay.<subdomain>.workers.dev/send?key=<RELAY_SECRET>"
```

Then force a prod task refresh so it picks up the new value:

```bash
aws ecs update-service --region eu-west-2 \
  --cluster charity-site-production --service charity-site-production --force-new-deployment
```

## Test

```bash
curl -X POST "https://nbcc-email-relay.<subdomain>.workers.dev/send?key=<RELAY_SECRET>" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","fullName":"Test","amountPence":2500,"currency":"GBP","text":"Thanks!","html":"<p>Thanks!</p>"}'
# → "sent"; wrong/absent key → 401
```

## Payload → email mapping

Discriminated by field presence (see `src/index.js`): `declarationLink` → Gift Aid link;
`refundedPence` → refund; `legalName` → company receipt; `link`+`fullName` → portal magic
link; `subscriptionId`+`donorName` → lapsed (admin); `subscriptionId`+`fullName` → lapsed
(donor); else `text/html` → donation confirmation. Payloads that already carry `text/html`
are sent verbatim; link/notice types are rendered here.
