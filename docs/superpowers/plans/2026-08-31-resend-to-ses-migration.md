# Resend → Amazon SES Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every outbound email (newsletter, transactional, contact enquiry) and inbound delivery-event ingestion off Resend + the Cloudflare Worker relay onto Amazon SES directly, leaving zero Resend references in the repo.

**Architecture:** The app sends straight to the SESv2 HTTP API from ECS using the task role (hand-rolled SigV4, zero new npm deps — the npm registry is blocked on the owner's machine, so an `@aws-sdk` dependency would break local dev entirely). The Worker's branded templates move into `src/email/templates.ts`. Delivery events arrive via SES → SNS → a token-gated `POST /api/webhooks/ses/:token` route that maps them onto the existing `newsletter_email_events` store (the `svix_event_id` column now carries the SNS MessageId; column rename would be a destructive migration, so the name stays). Terraform gains SES identities (apex + news subdomain), Easy-DKIM DNS, custom MAIL FROM, two configuration sets (newsletter with click tracking, transactional without), an SNS topic + HTTPS subscription, and the task-role `ses:SendEmail` grant; all `resend_*` DNS records and SSM params go.

**Tech Stack:** Node 20 `fetch` + `node:crypto` (SigV4, SNS envelope handling), Express, Terraform (aws provider, `aws_sesv2_*`), Vitest, Cucumber.

**Spec:** The previous conversation turn's phase plan (Phases 0–4) + `docs/NEWSLETTER-STATUS.md` constraints. No standalone spec doc; this plan is the spec of record.

## Global Constraints

- **Zero new npm dependencies** (registry blocked locally; `exceljs` precedent in NEWSLETTER-STATUS.md).
- **Zero occurrences of the Resend provider** in code/infra/docs when done (`grep -ri resend` may only match the English verb "resend", e.g. resending an invite/code in `src/routes/admin-users.ts`, `src/declarations/status.ts`, `features/stripe-webhook.*`).
- **Exported function names + payload interfaces of `src/clients/email.ts` stay identical** — 10+ call sites must not change.
- **`svix_event_id` DB column stays** (expand-contract: no destructive migration). It now stores the SNS MessageId; idempotency semantics unchanged.
- **Stub seam preserved:** outside production, sends are no-network no-ops unless explicitly enabled; production never stubs. New seam: `EMAIL_PROVIDER` config (`"stub"` default / `"ses"`), replacing the `.example`-URL convention.
- **Golden rule 3 for every config change:** `src/config/schema.ts` + `.env.example` + SSM/`main.tf` + task-def/`ecs.tf` + `exec_secrets` IAM (secrets only) + **`pr.yml` env block** (6th place, per project memory).
- **Errors thrown by the SES client must carry the real HTTP status + body** so `dispositionFor` (`src/newsletter/send-failure.ts`) keeps classifying 429/503/504 as "defer".
- **Do NOT weaken** the `dockerfile-scripts-shipped` guard or deploy workflow command shapes.
- **Merge gating (operational, not code):** this PR must only merge after (a) `infra.yml` apply creates + verifies the SES identities/DNS, and (b) SES production access is granted. Until then production would fail transactional sends. Recorded in the PR body + NEWSLETTER-STATUS.md.

---

### Task 1: SigV4 signer + AWS credential resolution (`src/clients/aws-sigv4.ts`)

**Files:**
- Create: `src/clients/aws-sigv4.ts`
- Test: `test/unit/aws-sigv4.test.ts`

**Interfaces (Produces):**
- `signRequest(opts: {method: string; url: string; headers: Record<string,string>; body: string; region: string; service: string; credentials: AwsCredentials; now?: Date}): Record<string,string>` — returns the full header map incl. `Authorization`, `x-amz-date`, and `x-amz-security-token` when a session token is present.
- `interface AwsCredentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string }`
- `resolveAwsCredentials(fetchImpl?: typeof fetch): Promise<AwsCredentials>` — env vars first (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`), else the ECS container-credentials endpoint `http://169.254.170.2${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}`, cached until 5 min before `Expiration`.

**Steps:**
- [ ] Failing test: canonical-request/signature against a fixed vector (known key/date/body → expected `Authorization` string, computed once by hand with node crypto in the test itself is NOT allowed — precompute the literal). Include: session-token header inclusion, signed-headers ordering, payload hash of empty vs non-empty body.
- [ ] Implement (pure `node:crypto` HMAC-SHA256 chain: date → region → service → `aws4_request`).
- [ ] Test credential resolution: env-var path; ECS path via injected fake `fetch`; caching + expiry refresh.
- [ ] Implement resolution + cache.
- [ ] `npm run test:unit -- aws-sigv4` green; commit.

### Task 2: SES send client (`src/clients/ses.ts`)

**Files:**
- Create: `src/clients/ses.ts`
- Test: `test/unit/ses-client.test.ts`

**Interfaces (Produces):**
- `interface SesMessage { to: string; from: string; replyTo?: string; cc?: string; subject: string; html?: string; text?: string; headers?: Record<string,string>; configurationSet?: string }`
- `sendSesEmail(msg: SesMessage, deps?: {fetchImpl?: typeof fetch}): Promise<void>` — POST `https://email.${config.SES_REGION}.amazonaws.com/v2/email/outbound-emails` with SigV4; throws `Error("SES send responded <status>: <first 300 chars>")` on non-2xx (status text keeps `dispositionFor` working: SES throttling = 429).
- Body shape: `{FromEmailAddress, Destination:{ToAddresses:[to], CcAddresses?}, ReplyToAddresses?, Content:{Simple:{Subject:{Data}, Body:{Html?,Text?}, Headers:[{Name,Value}]?}}, ConfigurationSetName?}`.

**Steps:**
- [ ] Failing tests (fake fetch): request URL/host per region; body mapping incl. headers array + cc + config set omission when unset; error message carries status + body detail.
- [ ] Implement.
- [ ] Unit green; commit.

### Task 3: Branded templates move into the app (`src/email/templates.ts`)

**Files:**
- Create: `src/email/templates.ts` (port of `services/email-relay/src/index.js` shell/heading/bodyP/note/button/codeBox/`relayBuilt`/`appBody`/`buildContact` — colours, copy, and subjects verbatim; drop the no-`kind` deploy-skew heuristics and the legacy `page()` fallback except where `buildContact` uses it)
- Create: `test/unit/email-templates.test.ts` (ports the still-relevant assertions of `test/unit/email-relay-build.test.ts`)
- Delete: `test/unit/email-relay-build.test.ts`

**Interfaces (Produces):**
- `buildKindEmail(kind: "donation"|"receipt"|"refund"|"loginCode"|"adminInvite"|"adminReset"|"portal"|"declaration"|"lapsedDonor"|"lapsedAdmin", p: Record<string, unknown>): {subject: string; html: string; text: string}` — same subjects/copy as the relay.
- `buildContactEmail(p: {firstName?: string; lastName?: string; email: string; message: string}): {subject: string; html: string; text: string}`.

**Steps:**
- [ ] Write failing tests first (subjects per kind, code box carries code, links escaped, registration line present for relay-built kinds and absent duplicate for app-built ones, contact enquiry formats name/message).
- [ ] Port implementation.
- [ ] Delete old relay test. Unit green; commit.

### Task 4: Config schema swap

**Files:**
- Modify: `src/config/schema.ts` — remove `RESEND_WEBHOOK_SECRET`, `EMAIL_SEND_URL`, `CONTACT_FORWARD_URL`; add:
  - `EMAIL_PROVIDER: z.enum(["stub","ses"]).default("stub")`
  - `SES_REGION: z.string().min(1).default("eu-west-1")` (align with `var.region` at wiring time)
  - `SES_NEWSLETTER_CONFIGURATION_SET: z.string().default("")`
  - `SES_TRANSACTIONAL_CONFIGURATION_SET: z.string().default("")`
  - `MAIL_FROM: z.string().email().default("noreply@nbcc.scot")`
  - `CONTACT_TO_EMAIL: z.string().email().default("giving@nbcc.scot")`
  - `SES_WEBHOOK_TOKEN: z.string().default("")` (blank = webhook answers 503, mirroring the old unconfigured behaviour)
- Modify: `.env.example` (same removals/additions, commented)
- Modify: `.github/workflows/pr.yml` env block — remove the three, add `SES_WEBHOOK_TOKEN: ci-ses-webhook-token` (BDD signs nothing; token is the trust boundary). `EMAIL_PROVIDER` stays default `stub`.
- Modify: `vitest`-adjacent unit tests that boot config, if any reference removed keys.

**Steps:**
- [ ] Edit schema + `.env.example` + `pr.yml`.
- [ ] `npm run build` + unit; fix fallout (grep `EMAIL_SEND_URL|CONTACT_FORWARD_URL|RESEND_WEBHOOK_SECRET` across `src/ test/ features/`). Commit.

### Task 5: `src/clients/email.ts` + `src/clients/contact.ts` on SES

**Files:**
- Modify: `src/clients/email.ts` — every exported interface + function name unchanged. `useStub = config.EMAIL_PROVIDER !== "ses" && config.NODE_ENV !== "production"`; `emailConfigured = config.EMAIL_PROVIDER === "ses"`; `emailStubbed = useStub` (login-code leak guard depends on it). Each send maps to `sendSesEmail`:
  - kinds with app-built bodies (`donation`, `receipt`, `refund`) and relay-built kinds (`declaration`, `portal`, `adminInvite`, `adminReset`, `loginCode`, `lapsedDonor`, `lapsedAdmin`) → `buildKindEmail` → from `config.MAIL_FROM`, transactional config set.
  - `sendNewsletter` → verbatim content; headers `List-Unsubscribe`/`List-Unsubscribe-Post` from `unsubscribeUrl`; `configurationSet: config.SES_NEWSLETTER_CONFIGURATION_SET`; error must keep carrying status+detail (Task 2 guarantees).
  - `sendThankYou` (+cc), business invite/capture/reminder, ball confirmation/reminder → verbatim content, transactional config set.
- Modify: `src/clients/contact.ts` — `forwardEnquiry` → `buildContactEmail` → SES to `config.CONTACT_TO_EMAIL`, `replyTo` = enquirer; same seam.
- Modify: `src/newsletter/send-failure.ts` — comment only (the "relay wraps everything as 502" note is stale; SES client surfaces real statuses).
- Test: extend `test/unit/email-templates.test.ts` or add `test/unit/email-client-ses.test.ts` only if a pure mapping function is extracted; the client itself stays DB/network-free-tested via the stub seam as today (existing suites cover callers).

**Steps:**
- [ ] Rewrite both clients; grep for `EMAIL_SEND_URL` leftovers.
- [ ] `npm run lint && npm run build && npm run test:unit`; fix fallout (several newsletter suites import these modules). Commit.

### Task 6: SES/SNS event pipeline (`src/newsletter/ses-events.ts`, `src/routes/ses-webhook.ts`)

**Files:**
- Create: `src/newsletter/ses-events.ts`
- Create: `src/routes/ses-webhook.ts`
- Modify: `src/db/newsletter-events.ts` — `ParsedResendEvent`→`ParsedEmailEvent` import/type, `recordResendEvent`→`recordEmailEvent` (callers: new route + tests), comments updated; SQL untouched.
- Modify: `src/app.ts` — mount swap.
- Delete: `src/routes/resend-webhook.ts`, `src/newsletter/resend-events.ts`, `test/unit/resend-webhook.test.ts`
- Test: `test/unit/ses-webhook.test.ts`

**Interfaces (Produces):**
- `parseSnsEnvelope(rawBody: string): {type: "SubscriptionConfirmation"; subscribeUrl: string} | {type: "Notification"; messageId: string; message: string} | null` — validates `SubscribeURL` host is `sns.<region>.amazonaws.com` over https.
- `parseSesEvent(message: string): ParsedEmailEvent | null` — `eventType` map `Delivery→delivered, Bounce→bounced, Complaint→complained, Open→opened, Click→clicked`; email from `mail.destination[0]` (lowercased); `occurredAt` from the per-event timestamp falling back to `mail.timestamp`; `detail` = the `bounce` object on bounces; `linkUrl` from `click.link`.
- `suppressionFor(event: ParsedEmailEvent)` — complaint always; bounce only when `detail.bounceType === "Permanent"` (detail words from `bouncedRecipients[0].diagnosticCode` fallback `bounce.bounceSubType`).
- Route `POST /api/webhooks/ses/:token` (raw body before `express.json`, like Stripe): 503 when `SES_WEBHOOK_TOKEN` blank; 401 on token mismatch (timing-safe compare); SubscriptionConfirmation → fetch `subscribeUrl`, 200; Notification → `recordEmailEvent(messageId, parsed)` + suppression + `REPEAT_BOUNCE_LIMIT`(3) repeat-bounce logic ported verbatim from the old route; 200 on drops, 500 on DB failure (SNS retries).

**Steps:**
- [ ] Failing unit tests: envelope parsing (confirmation host allowlist, bad JSON), event mapping per type, permanent-vs-transient suppression, timestamp fallback.
- [ ] Implement `ses-events.ts`; green.
- [ ] Write route + `newsletter-events` rename; delete old files; mount in `app.ts`.
- [ ] `npm run lint && npm run build && npm run test:unit`. Commit.

### Task 7: BDD swap

**Files:**
- Modify: `features/newsletter.feature` lines ~287–326 — rewritten as SES: "When SES reports a delivered event for …", retry step, wrong-token step (replaces UNSIGNED), click step.
- Modify: `features/steps/newsletter.steps.js` — `postSesEvent(token, envelope)` to `/api/webhooks/ses/${token}`; SNS Notification envelope `{Type:"Notification", MessageId, TopicArn:"arn:aws:sns:eu-west-1:000000000000:ci", Message: JSON.stringify(sesEvent), Timestamp}`; SES event bodies per type; token from `process.env.SES_WEBHOOK_TOKEN || "ci-ses-webhook-token"`.

**Steps:**
- [ ] Rewrite feature + steps.
- [ ] Local BDD run per memory recipe (free port, `.env` sourced, DB on 5435, clear `stripe_webhook_events` + empty `claim_batches` cruft). Full suite, not just newsletter (page-marker coupling). Fix until green. Commit.

### Task 8: Infra — SES identities, DNS, config sets, SNS, IAM; Resend teardown

**Files:**
- Create: `infra/modules/app/ses.tf`:
  - `aws_sesv2_email_identity` ×2 (`var.domain_name`, `news.${var.domain_name}`), Easy DKIM; `mail_from_attributes` → `bounce.${var.domain_name}` / `bounce.news.${var.domain_name}`.
  - Route53: 3 DKIM CNAMEs per identity (`dkim_signing_attributes` tokens), MAIL FROM MX `feedback-smtp.${var.region}.amazonses.com` + SPF `v=spf1 include:amazonses.com ~all` per identity. Gated `local.create_zone` like the records they replace.
  - `aws_sesv2_configuration_set` ×2: `${local.name}-newsletter` (tracking_options `links.news.${var.domain_name}`, https_policy REQUIRE) and `${local.name}-transactional` (no tracking).
  - Event destinations → one `aws_sns_topic` (`${local.name}-ses-events`): newsletter set subscribes SEND/DELIVERY/BOUNCE/COMPLAINT/CLICK; transactional set DELIVERY/BOUNCE/COMPLAINT.
  - `random_password.ses_webhook_token` (32, no specials) → `aws_ssm_parameter.ses_webhook_token` (SecureString, value managed) → `aws_sns_topic_subscription` https endpoint `https://${var.domain_name}/api/webhooks/ses/${random_password…result}` with `endpoint_auto_confirms = true`.
- Modify: `infra/modules/app/dns.tf` — delete `resend_dkim`, `resend_mx`, `resend_spf`, `news_dkim`, `news_mx`, `news_spf`, `resend_tracking`; repoint `news_tracking` (`links.news.…`) CNAME → `r.${var.region}.awstrack.me`; scrub Resend from `txt_apex`/`dmarc` comments (SPF/DMARC values themselves unchanged — SES envelope lives on `bounce.*` with its own SPF).
- Modify: `infra/modules/app/main.tf` — delete `resend_webhook_secret`, `email_send_url`, `contact_forward_url` params.
- Modify: `infra/modules/app/ecs.tf` — secrets: drop the three, add `SES_WEBHOOK_TOKEN` (valueFrom + `exec_secrets` ARN); environment: add `SES_REGION` (var.region), `SES_NEWSLETTER_CONFIGURATION_SET`, `SES_TRANSACTIONAL_CONFIGURATION_SET` (resource names), `EMAIL_PROVIDER=ses`, `MAIL_FROM`, `CONTACT_TO_EMAIL` (vars); new `aws_iam_role_policy.task_ses` on the task role: `ses:SendEmail` on both identity ARNs + both configuration-set ARNs.
- Modify: `infra/modules/app/variables.tf` — `mail_from` (default `noreply@nbcc.scot`), `contact_to_email` (default `giving@nbcc.scot`).

**Steps:**
- [ ] Write all TF; `terraform fmt` + `terraform validate` in the module (init -backend=false).
- [ ] Commit. (Apply is manual via `infra.yml` — never from session; guard blocks it anyway.)

### Task 9: Docs + scrub

**Files:**
- Modify: `README.md` (config table, email/webhook sections, project structure — `services/email-relay` gone), `docs/NEWSLETTER-STATUS.md` (provider = SES; merge-gating note; 70/day cap now obsolete once quota confirmed), `.env.example` cross-check.
- Delete: `services/email-relay/` (entire directory).

**Steps:**
- [ ] Delete relay dir; update docs.
- [ ] Full scrub: `grep -ri resend` — only English-verb matches may remain (list them in the PR body). Also `grep -ri "svix\|EMAIL_SEND_URL\|CONTACT_FORWARD_URL\|RESEND"`.
- [ ] `npm run lint && npm run build && npm run test:unit` + full local BDD. Commit.

### Task 10: Verify + PR

- [ ] superpowers:verification-before-completion — run every gate, show output.
- [ ] Push branch, open PR titled with placeholder task number; PR body carries the deploy-gating warning (infra apply + SES production access BEFORE merge). Do **not** self-merge without the user's go — merging deploys production onto an unverified SES account.

## Self-Review notes

- Spec coverage: send path (T1–T5), events (T6), BDD (T7), infra (T8), scrub/docs (T9) — all previous-turn phases covered except operational steps (sandbox exit, list prune) which are not code.
- `recordEmailEvent` name used consistently (T6). `ParsedEmailEvent` shape identical to old `ParsedResendEvent` so `newsletter-events` SQL untouched.
- Deliberate risks called out: click-tracking HTTPS policy may need manual verification at apply time; merge gated on SES production access.
