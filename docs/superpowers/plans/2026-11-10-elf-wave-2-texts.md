# Elf Detective School wave 2: texts through Amazon from the task role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The website can send a text message from "NBCC" to a UK mobile using the app task's own Amazon role, with no key for anyone to type in, a pretend sender in tests and on this computer, and the infra and config in place early enough for the Infra apply and Amazon's sandbox lift to happen while Plan 2a is built.

**Architecture:** A small client, `src/clients/sms.ts`, signs an SNS `Publish` call with `src/clients/aws-sigv4.ts` exactly as `src/clients/ses.ts` signs SES, with the payload mapping pure in `src/clients/sms-request.ts`. Three config values go through the schema, `.env.example`, SSM and the task definition. One IAM policy lets the task role text a number and never post to a topic. Nothing sends a text yet: Plan 2b's alerts are the first caller.

**Tech Stack:** TypeScript, the hand signed AWS calls already in the repo, Vitest, Terraform.

**Spec:** `docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md`, call C2 and "For the builder: Texts" (Amazon End User Messaging SMS or SNS, sent with the task role, a config value to turn texts on and name the sender, a pretend sender in tests). Claude's choice is SNS `Publish` with an alphanumeric sender name, which UK carriers accept without registration today. **Ships straight after Plan 1 (`2026-11-10-elf-wave-2-doors.md`), before Plan 2a.**

## Global Constraints

- The repository is public. `07700 900 123` (Ofcom's reserved mobile range) for every test mobile; no real number, no real person.
- Config golden rule 3: `src/config/schema.ts`, `.env.example`, an SSM parameter in `infra/modules/app/main.tf`, and the task definition in `infra/modules/app/ecs.tf` (plus the `exec_secrets` list for anything injected with `valueFrom`). Texts need no secret.
- Never `terraform apply` by hand; the Infra workflow plans on the pull request and applies on dispatch. The README says what NBCC must do in the console: leave the SNS text sandbox and set a monthly text spend limit, by Friday 20 November.
- Outside production, `SMS_PROVIDER=stub` sends nothing and touches no network; production never stubs, as email never does. A log line never carries more than the last three digits of a number.
- Plain English in every sentence a person reads. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; commit only the files the task names, never `.mcp.json`. Locally `perf-budget` and `footer-master` fail on Windows line endings; those two are not real failures.
- README.md is updated in the same task.

## Review Focus

1. A number typed with spaces or a leading 0 never reaches Amazon: `sendText` refuses anything but `+447` and nine digits (Task 1's "refuses" test).
2. A 4xx or 5xx from Amazon surfaces as a thrown error with the status in it, so Plan 2b can count a failed text and carry on (Task 1's "throws with the status" test).
3. The stub never calls `fetch`, even with every other value set (Task 1's stub test).

---

### Task 1: The SMS client, its config, its grant, and the README

**Files:**
- Create: `src/clients/sms.ts`, `src/clients/sms-request.ts`
- Modify: `src/config/schema.ts`, `.env.example`, `infra/modules/app/main.tf`, `infra/modules/app/ecs.tf`, `infra/modules/app/variables.tf`, `infra/envs/production/main.tf`, `README.md`
- Test: `test/unit/sms-request.test.ts`, `test/unit/sms-client.test.ts`

**Interfaces:**
- Consumes: `createCredentialProvider`, `signRequest` (`src/clients/aws-sigv4.ts`), as `src/clients/ses.ts` uses them; `config`.
- Produces, in config:
  - `SMS_PROVIDER: z.enum(["stub", "sns"]).default("stub")`: a plain task definition `environment` value, `local.create_zone ? "sns" : "stub"`, mirroring `EMAIL_PROVIDER`.
  - `SMS_SENDER_ID: z.string().regex(/^[A-Za-z0-9]{3,11}$/).default("NBCC")`: an SSM String `/${var.project}/${var.environment}/SMS_SENDER_ID` from a new variable `sms_sender_id` (default `"NBCC"`), in the task definition `secrets` with `valueFrom` and in the `exec_secrets` resource list, like `newsletter_from_email`.
  - `SMS_REGION: z.string().min(1).default("eu-west-2")`: a plain `environment` value, `var.region`.
  - The schema comment says the sender name is alphanumeric because UK carriers accept one without registration today, and that the account must leave the SNS text sandbox and carry a spend limit before December.
- Produces, in infra: `data "aws_iam_policy_document" "task_sms"` with two statements: `Allow` `sns:Publish` on `"*"` (a text to a number has no topic ARN, so nothing narrower works) and `Deny` `sns:Publish` on `arn:aws:sns:*:*:*` (every topic), so the role can text a number and never post to a topic; `aws_iam_role_policy "task_sms"` attaches it to `aws_iam_role.task`, gated on `local.create_zone` like `task_ses`.
- Produces, in `sms-request.ts` (pure): `interface SmsMessage { to: string; text: string; senderId: string }`; `function snsEndpoint(region: string): string` (`https://sns.${region}.amazonaws.com/`); `function isE164UkMobile(to: string): boolean` (`/^\+447\d{9}$/`); `function buildSnsPublishBody(msg: SmsMessage): string`: the form encoded `Action=Publish`, `Version=2010-03-31`, `PhoneNumber`, `Message`, `MessageAttributes.entry.1.Name=AWS.SNS.SMS.SenderID` with `.Value.DataType=String` and `.Value.StringValue=${senderId}`, and `MessageAttributes.entry.2.Name=AWS.SNS.SMS.SMSType` with `StringValue=Transactional`.
- Produces, in `sms.ts`: `export const smsConfigured = config.SMS_PROVIDER === "sns"`; `export async function sendText(msg: SmsMessage, deps: { fetchImpl?: typeof fetch } = {}): Promise<"sent" | "stubbed">`: throws `Error("not a UK mobile")` unless `isE164UkMobile(msg.to)`; with the stub outside production answers "stubbed" without `fetch`; otherwise signs a POST to `snsEndpoint(config.SMS_REGION)` with `content-type: application/x-www-form-urlencoded`, service `"sns"`, and throws `SNS publish responded ${status}: ${detail.slice(0, 300)}` on a non 2xx; logs `text sent to …${last three digits}` on success.

- [ ] **Step 1: Write the failing tests.** `buildSnsPublishBody({ to: "+447700900123", text: "hello", senderId: "NBCC" })` contains `Action=Publish`, `PhoneNumber=%2B447700900123`, `Message=hello`, `StringValue=NBCC` and `StringValue=Transactional`; `isE164UkMobile("+447700900123")` is true and `"07700 900 123"`, `"+4477009001234"` false; `sendText({ to: "07700 900 123", … })` rejects with "not a UK mobile" before any fetch; with `SMS_PROVIDER: "stub"` and `NODE_ENV: "development"` it answers "stubbed" and `fetch` is never called; with `"sns"` it POSTs once to `https://sns.eu-west-2.amazonaws.com/` with an `authorization` header starting `AWS4-HMAC-SHA256` and a form body, and rejects with a message containing "400" on a 400; the schema parses `SMS_SENDER_ID: "NBCC"` and refuses `"NBCC Elf!"` and `"NB"`.
- [ ] **Step 2: Run them.** `npx vitest run test/unit/sms-request.test.ts test/unit/sms-client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two modules, the config in all four places, the variable and its production value, and the IAM grant. Run `terraform fmt -check` under `infra/` if terraform is installed; otherwise match the files' style by eye.
- [ ] **Step 4: Run them again.** Expected: PASS. Then `npm run lint` and `npx tsc --noEmit`.
- [ ] **Step 5: Update README.md**: the config section (`SMS_PROVIDER`, `SMS_SENDER_ID`, `SMS_REGION`, what stub means), the infra section (the `task_sms` grant and the SSM parameter, applied through the Infra workflow), and the console steps NBCC must take by 20 November (leave the SNS text sandbox, set a monthly spend limit), with the note that nothing sends a text until Plan 2b's alerts.
- [ ] **Step 6: Commit** `feat(elf): texts through Amazon SNS from the task role`.
