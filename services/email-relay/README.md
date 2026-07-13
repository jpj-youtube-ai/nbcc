# NBCC email relay (Cloudflare Worker → Resend)

Bridges the app's custom email payloads (`src/clients/email.ts`) to Resend. The app
POSTs its own JSON shape (no subject/from/type; auth in the URL) to `EMAIL_SEND_URL`;
this Worker discriminates the payload, renders/wraps it, and sends via Resend.

Two routes, both authed by the same `?key=<RELAY_SECRET>`:
- `EMAIL_SEND_URL`     = `…workers.dev/send?key=<RELAY_SECRET>`    for transactional emails
- `CONTACT_FORWARD_URL` = `…workers.dev/contact?key=<RELAY_SECRET>` for contact-form enquiries
  (emailed to `CONTACT_TO`, reply-to the enquirer)

## One-time setup

1. **Resend account** → add domain **nbcc.scot** → Resend shows DNS records (SPF TXT,
   DKIM CNAME/TXT, a bounce/return-path record). Those go in the **Route 53** zone
   (Terraform, `infra/modules/app/dns.tf`). Hand the values to the infra change; do
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
# MAIL_FROM is a [vars] entry in wrangler.toml; edit there if the sender differs.
```

`wrangler deploy` prints the Worker URL. Compose `EMAIL_SEND_URL` from it + `?key=<RELAY_SECRET>`:

```bash
aws ssm put-parameter --region eu-west-2 --overwrite --type SecureString \
  --name /charity-site/production/EMAIL_SEND_URL \
  --value "https://nbcc-email-relay.<subdomain>.workers.dev/send?key=<RELAY_SECRET>"

aws ssm put-parameter --region eu-west-2 --overwrite --type SecureString \
  --name /charity-site/production/CONTACT_FORWARD_URL \
  --value "https://nbcc-email-relay.<subdomain>.workers.dev/contact?key=<RELAY_SECRET>"
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

## Payload -> email mapping

Every transactional send carries an explicit `kind` (set by `src/clients/email.ts`), and the
Worker routes on it (see `buildEmail` in `src/index.js`), wrapping every email in ONE branded
shell (maroon page, cream body panel, NBCC logo letterhead, and a maroon contact/legal footer
bar, modelled on the admin thank-you letter email) with its OWN correct subject:

| `kind` | subject | body built by |
|---|---|---|
| `donation` | Thank you for your donation to NBCC | app |
| `receipt` | Your NBCC donation receipt | app |
| `refund` | Your NBCC refund confirmation | app |
| `loginCode` | Your NBCC admin sign-in code | relay |
| `adminInvite` | Your NBCC admin account invitation | relay |
| `adminReset` | Reset your NBCC admin password | relay |
| `portal` | Your NBCC donor portal link | relay |
| `declaration` | Add Gift Aid to your NBCC donation | relay |
| `lapsedDonor` | Your NBCC monthly donation has stopped | relay |
| `lapsedAdmin` | A monthly NBCC subscription has lapsed | relay |

The maroon footer bar (phone `01292 811 015`, `giving@nbcc.scot`, `nbcc.scot`) appears on every
kind. The `donation` / `receipt` / `refund` kinds already ship html + text from the app, ending
with the charity registration line, so the shell wraps that content with a contacts-only footer
(no duplicate registration); the `relay`-built kinds are rendered here and get the registration in
the footer. The `newsletter` and `thankYou` flags are unchanged (each already ships its own fully
branded html + subject + repliable from). If a payload arrives WITHOUT a `kind` (an app and Worker
deployed at different times), the old field-presence heuristics still route it, as a deploy-skew
safety net. The whole file stays email-safe (tables + inline styles + web-safe fonts + a hosted
logo url, never base64) and free of em/en dashes.
