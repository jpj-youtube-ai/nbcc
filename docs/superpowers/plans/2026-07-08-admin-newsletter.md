# Admin Newsletter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give NBCC staff an admin "Newsletter" tab to author an HTML newsletter, save drafts (Editor+), and (Admin only) send it as an individual email to every donor who opted into marketing at donation time, with a working reply-to inbox and a per-recipient unsubscribe link.

**Architecture:** A new `newsletters` table (history model, seeded starter draft). Role-gated `/api/admin/newsletters` CRUD + send endpoints in the existing `src/routes/admin.ts`. Send loops over consented donors (`donors.email_consent = true`), builds a stateless HMAC unsubscribe token per recipient (reusing `ADMIN_SESSION_SECRET`), and sends one email each via a new `sendNewsletter` on the existing stub-seam email client. A public `GET /unsubscribe/:token` route flips `email_consent` off. UI is a new tab in `admin.html` + wiring in `assets/js/admin/app.js`.

**Tech Stack:** Express + TypeScript, node-pg-migrate (CommonJS migrations), Vitest (unit), Cucumber (BDD), Zod config schema, Terraform (SSM/ECS), vanilla ES5-style admin JS.

## Global Constraints

- **Golden rule 1:** every change ships with tests; PR must pass lint, build, unit, BDD before merge.
- **Golden rule 2:** migrations are additive-only (expand-contract). The `newsletters` migration creates one new table + seeds a row — no existing table altered.
- **Golden rule 3:** new config value goes through `src/config/schema.ts` AND `.env.example` AND the SSM param (`infra/modules/app/main.tf`) AND the task-def block (`infra/modules/app/ecs.tf`) AND — required extra — `.github/workflows/pr.yml`'s env block (CI app-boot needs every required key).
- **Golden rule 4:** no secrets in code. No new secret is introduced (HMAC key reuses `ADMIN_SESSION_SECRET`, an existing SSM SecureString).
- **Golden rule 5:** logic gets a Vitest unit test (DB-free); user-visible/HTTP behaviour gets a Cucumber `.feature`.
- **Golden rule 7:** update `README.md` in the same PR.
- **Naming/workflow:** branch `task-161-admin-newsletter`; PR title starts `[TASK-161]`; requirement label **REQ-069** (REQ-066 is the existing admin dashboard; SPEC.md is machine-generated and never hand-edited).
- **Never read `process.env` outside the config module.**
- **Style:** admin JS is ES5-style inside one IIFE (`var`, `function`), no build step — match it.

---

### Task 1: Config value `NEWSLETTER_FROM_EMAIL`

Wire a new **non-secret** config value: the `From`/`Reply-To` of every newsletter email. Uses the `/add-config` recipe. Non-secret String param, so it goes through the SSM `secrets` list + `exec_secrets` ARN like `PORTAL_BASE_URL`/`ADMIN_NOTIFICATION_EMAIL` already do (those are Strings injected the same way), but needs **no** literal-secret handling.

**Files:**
- Modify: `src/config/schema.ts` (add the key)
- Modify: `.env.example`
- Modify: `infra/modules/app/main.tf` (SSM parameter)
- Modify: `infra/modules/app/ecs.tf` (task-def `secrets` entry + `exec_secrets` ARN)
- Modify: `.github/workflows/pr.yml` (env block)

**Interfaces:**
- Produces: `config.NEWSLETTER_FROM_EMAIL: string` (a validated email address).

- [ ] **Step 1: Add the key to the Zod schema**

In `src/config/schema.ts`, inside the `configSchema` object (after `ADMIN_SESSION_SECRET`), add:

```ts
  // The From/Reply-To address for the admin newsletter (TASK-161/REQ-069). Every newsletter
  // email is sent From and Reply-To this address so donors can reply to a real inbox (not a
  // noreply). NOT a secret (it ships in the email headers), but AWS-injected like
  // ADMIN_NOTIFICATION_EMAIL (SSM String → task-def). Validated as an email address. Defaulted
  // to the production address so local dev / CI boot without extra setup.
  NEWSLETTER_FROM_EMAIL: z.string().email().default("newsletter@nbcc.scot"),
```

- [ ] **Step 2: Add to `.env.example`**

Append to `.env.example` (after the `ADMIN_SESSION_SECRET` block):

```bash
# From/Reply-To for the admin newsletter (TASK-161): the address every newsletter
# email is sent from and replies go to (a real inbox, not noreply). Not a secret
# (it ships in the email headers). Defaults to the production address.
NEWSLETTER_FROM_EMAIL=newsletter@nbcc.scot
```

- [ ] **Step 3: Add the SSM parameter (Terraform)**

In `infra/modules/app/main.tf`, mirroring the `admin_notification_email` String parameter, add:

```hcl
resource "aws_ssm_parameter" "newsletter_from_email" {
  name  = "/${var.project}/${var.environment}/NEWSLETTER_FROM_EMAIL"
  type  = "String"
  value = var.newsletter_from_email
  tags  = local.tags
}
```

Add the variable to `infra/modules/app/variables.tf`:

```hcl
variable "newsletter_from_email" {
  description = "From/Reply-To address for the admin newsletter"
  type        = string
  default     = "newsletter@nbcc.scot"
}
```

- [ ] **Step 4: Wire the task definition (Terraform)**

In `infra/modules/app/ecs.tf`, add to the container `secrets` list (mirroring `PORTAL_BASE_URL`):

```hcl
      { name = "NEWSLETTER_FROM_EMAIL", valueFrom = aws_ssm_parameter.newsletter_from_email.arn },
```

And add its ARN to the `exec_secrets` policy document `resources` list (mirroring the existing String params):

```hcl
      aws_ssm_parameter.newsletter_from_email.arn,
```

- [ ] **Step 5: Add to CI env**

In `.github/workflows/pr.yml`, in the env block that already sets `PORTAL_BASE_URL` (around line 45-51), add:

```yaml
      NEWSLETTER_FROM_EMAIL: newsletter@nbcc.scot
```

- [ ] **Step 6: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS (no type/lint errors; config still loads with the new defaulted key).

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts .env.example infra/modules/app/main.tf infra/modules/app/variables.tf infra/modules/app/ecs.tf .github/workflows/pr.yml
git commit -m "[TASK-161] Add NEWSLETTER_FROM_EMAIL config (schema, env, SSM, task def, CI)"
```

---

### Task 2: `newsletters` migration (table + seed starter draft)

**Files:**
- Create: `migrations/<timestamp>_newsletters.js` (generate the name with the tool below)

**Interfaces:**
- Produces: table `newsletters(id, subject, body_html, status, created_at, updated_at, sent_at, sent_by, recipient_count)` and one seeded draft row.

- [ ] **Step 1: Generate the migration file**

Run: `npx node-pg-migrate create newsletters`
Expected: prints a path like `migrations/1783xxxxxxxxx_newsletters.js`. Edit that file.

- [ ] **Step 2: Write the migration**

Replace the generated file contents with:

```js
/* eslint-disable */
// TASK-161 (REQ-069): the admin newsletter store. Staff author an HTML newsletter, save it as a
// draft, and (Admin only) send it to every consenting donor. Additive / expand-contract: one brand
// new table, no existing table touched, so a code-level rollback stays safe (golden rule 2).
// Independent of the earlier additive migrations (order between them does not matter).
//
// Each newsletter is its own row (history model): new drafts never overwrite older ones, and a sent
// newsletter stays as an immutable record (subject/body + sent_at/sent_by/recipient_count). status is
// 'draft' until sent, then 'sent'. sent_by FK → users is ON DELETE RESTRICT (protect the audit trail
// of who sent it), nullable until sent. The migration also seeds ONE starter draft so the admin tab
// is never empty on first load.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "newsletters",
    {
      id: "id",
      subject: { type: "text", notNull: true },
      body_html: { type: "text", notNull: true },
      status: {
        type: "text",
        notNull: true,
        default: "draft",
        check: "status IN ('draft', 'sent')",
      },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      sent_at: { type: "timestamptz" }, // NULL until sent
      sent_by: { type: "integer", references: "users", onDelete: "RESTRICT" }, // NULL until sent
      recipient_count: { type: "integer" }, // NULL until sent
    },
    { comment: "Admin-authored newsletters emailed to consenting donors (REQ-069)." },
  );

  // Seed one starter draft so the Newsletter tab shows something by default.
  pgm.sql(`
    INSERT INTO newsletters (subject, body_html, status)
    VALUES (
      'North Berwick Christmas Committee — Newsletter',
      '<h1>Season''s greetings from the North Berwick Christmas Committee</h1><p>Write your update here.</p>',
      'draft'
    );
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("newsletters");
};
```

- [ ] **Step 3: Run the migration against the local DB**

Run: `npm run migrate`
Expected: applies `newsletters`; no error. (Local DB on `localhost:5435` — see `.env`; use `--env-file` if the app doesn't auto-load it.)

- [ ] **Step 4: Verify the table + seed row**

Run: `psql "$DATABASE_URL" -c "SELECT id, subject, status FROM newsletters;"` (or the postgres MCP query)
Expected: one row, `status = draft`.

- [ ] **Step 5: Commit**

```bash
git add migrations/
git commit -m "[TASK-161] Add newsletters table + seed starter draft (REQ-069)"
```

---

### Task 3: Pure unsubscribe token (sign/verify) + unit tests

**Files:**
- Create: `src/donors/unsubscribe-token.ts`
- Test: `test/unit/unsubscribe-token.test.ts`

**Interfaces:**
- Produces:
  - `signUnsubscribeToken(donorId: number, secret: string): string`
  - `verifyUnsubscribeToken(token: string, secret: string): number` (throws `UnsubscribeTokenError` on malformed/bad signature)
  - `class UnsubscribeTokenError extends Error { reason: "malformed" | "bad_signature" }`

- [ ] **Step 1: Write the failing test**

`test/unit/unsubscribe-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  UnsubscribeTokenError,
} from "../../src/donors/unsubscribe-token";

const SECRET = "test-secret";

describe("unsubscribe token", () => {
  it("round-trips a donor id", () => {
    const token = signUnsubscribeToken(42, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe(42);
  });

  it("rejects a tampered payload", () => {
    const token = signUnsubscribeToken(42, SECRET);
    const tampered = token.replace(/^\d+/, "99");
    expect(() => verifyUnsubscribeToken(tampered, SECRET)).toThrow(UnsubscribeTokenError);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signUnsubscribeToken(42, SECRET);
    expect(() => verifyUnsubscribeToken(token, "other-secret")).toThrow(UnsubscribeTokenError);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyUnsubscribeToken("not-a-token", SECRET)).toThrow(UnsubscribeTokenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- unsubscribe-token`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`src/donors/unsubscribe-token.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

// The stateless newsletter unsubscribe token (TASK-161/REQ-069). A donor's newsletter email carries
// `${PORTAL_BASE_URL}/unsubscribe/<token>`; the token is `donorId.hmacSha256(donorId)` — self-
// describing, no DB row — signed with the caller-supplied secret (config.ADMIN_SESSION_SECRET is
// reused; the key never appears in code). Pure and DB-free, mirroring src/admin/session.ts, so it is
// unit-tested without a database.

export class UnsubscribeTokenError extends Error {
  constructor(public readonly reason: "malformed" | "bad_signature") {
    super(`unsubscribe token invalid: ${reason}`);
    this.name = "UnsubscribeTokenError";
  }
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signUnsubscribeToken(donorId: number, secret: string): string {
  const body = String(donorId);
  return `${body}.${sign(body, secret)}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): number {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new UnsubscribeTokenError("malformed");
  const [body, sig] = parts;

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnsubscribeTokenError("bad_signature");

  const donorId = Number(body);
  if (!Number.isInteger(donorId) || donorId <= 0) throw new UnsubscribeTokenError("malformed");
  return donorId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- unsubscribe-token`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/donors/unsubscribe-token.ts test/unit/unsubscribe-token.test.ts
git commit -m "[TASK-161] Add pure unsubscribe token sign/verify + unit tests"
```

---

### Task 4: Pure newsletter HTML assembly + unit tests

**Files:**
- Create: `src/donors/newsletter.ts`
- Test: `test/unit/newsletter-html.test.ts`

**Interfaces:**
- Produces: `buildNewsletterHtml(bodyHtml: string, unsubscribeUrl: string): string`

- [ ] **Step 1: Write the failing test**

`test/unit/newsletter-html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildNewsletterHtml } from "../../src/donors/newsletter";

describe("buildNewsletterHtml", () => {
  it("appends an unsubscribe footer with the link", () => {
    const html = buildNewsletterHtml("<p>Hello</p>", "https://nbcc.scot/unsubscribe/tok123");
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain('href="https://nbcc.scot/unsubscribe/tok123"');
    expect(html.toLowerCase()).toContain("unsubscribe");
  });

  it("preserves the author's body html ahead of the footer", () => {
    const html = buildNewsletterHtml("<h1>Update</h1>", "https://x/unsubscribe/t");
    expect(html.indexOf("<h1>Update</h1>")).toBeLessThan(html.indexOf("unsubscribe"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- newsletter-html`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`src/donors/newsletter.ts`:

```ts
// Pure newsletter HTML assembly (TASK-161/REQ-069). Takes the staff-authored body HTML and the
// recipient's unsubscribe URL and returns the full email HTML with a required unsubscribe footer
// (PECR/UK GDPR: every marketing email must offer an unsubscribe). No I/O — unit-tested directly.
export function buildNewsletterHtml(bodyHtml: string, unsubscribeUrl: string): string {
  const footer =
    `<hr>\n<p style="font-size:12px;color:#666">` +
    `You're receiving this because you opted in to updates when you donated to the ` +
    `North Berwick Christmas Committee. <a href="${unsubscribeUrl}">Unsubscribe</a>.</p>`;
  return `${bodyHtml}\n${footer}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- newsletter-html`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/donors/newsletter.ts test/unit/newsletter-html.test.ts
git commit -m "[TASK-161] Add pure newsletter HTML assembly + unit tests"
```

---

### Task 5: DB model `src/db/newsletters.ts`

Read/write helpers over the `newsletters` table + the consented-donor recipient query + the unsubscribe write. DB-touching, so it is exercised by the BDD in Tasks 7 & 8 (golden rule 5 keeps unit tests DB-free).

**Files:**
- Create: `src/db/newsletters.ts`

**Interfaces:**
- Consumes: `pool` from `src/db/pool.ts`.
- Produces:
  - `interface NewsletterSummary { id: number; subject: string; status: "draft" | "sent"; sentAt: string | null; recipientCount: number | null }`
  - `interface Newsletter extends NewsletterSummary { bodyHtml: string }`
  - `interface NewsletterRecipient { email: string; donorId: number }`
  - `listNewsletters(): Promise<NewsletterSummary[]>`
  - `getNewsletter(id: number): Promise<Newsletter | null>`
  - `createNewsletter(subject: string, bodyHtml: string): Promise<Newsletter>`
  - `updateNewsletterDraft(id: number, subject: string, bodyHtml: string): Promise<Newsletter | null>` (returns null if the row doesn't exist OR is not a draft)
  - `listNewsletterRecipients(): Promise<NewsletterRecipient[]>`
  - `markNewsletterSent(id: number, sentBy: number, recipientCount: number): Promise<boolean>` (false if the row wasn't a draft — idempotency guard)
  - `unsubscribeDonor(donorId: number): Promise<void>`

- [ ] **Step 1: Write the model**

`src/db/newsletters.ts`:

```ts
import { pool } from "./pool";

// DB access for the admin newsletter (TASK-161/REQ-069). Read/write over the newsletters table plus
// the consented-donor recipient query and the unsubscribe write. Mirrors the pool-query style of
// src/db/portal.ts (no transaction needed — single-statement writes).

export interface NewsletterSummary {
  id: number;
  subject: string;
  status: "draft" | "sent";
  sentAt: string | null;
  recipientCount: number | null;
}

export interface Newsletter extends NewsletterSummary {
  bodyHtml: string;
}

export interface NewsletterRecipient {
  email: string;
  donorId: number;
}

interface Row {
  id: number;
  subject: string;
  body_html: string;
  status: "draft" | "sent";
  sent_at: string | null;
  recipient_count: number | null;
}

function toNewsletter(r: Row): Newsletter {
  return {
    id: r.id,
    subject: r.subject,
    bodyHtml: r.body_html,
    status: r.status,
    sentAt: r.sent_at,
    recipientCount: r.recipient_count,
  };
}

export async function listNewsletters(): Promise<NewsletterSummary[]> {
  const rows = (
    await pool.query<Row>(
      `SELECT id, subject, body_html, status, sent_at, recipient_count
         FROM newsletters ORDER BY id DESC`,
    )
  ).rows;
  return rows.map(({ body_html: _b, ...rest }) => toNewsletter({ ...rest, body_html: "" }));
}

export async function getNewsletter(id: number): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `SELECT id, subject, body_html, status, sent_at, recipient_count
         FROM newsletters WHERE id = $1`,
      [id],
    )
  ).rows[0];
  return row ? toNewsletter(row) : null;
}

export async function createNewsletter(subject: string, bodyHtml: string): Promise<Newsletter> {
  const row = (
    await pool.query<Row>(
      `INSERT INTO newsletters (subject, body_html, status)
       VALUES ($1, $2, 'draft')
       RETURNING id, subject, body_html, status, sent_at, recipient_count`,
      [subject, bodyHtml],
    )
  ).rows[0];
  return toNewsletter(row);
}

export async function updateNewsletterDraft(
  id: number,
  subject: string,
  bodyHtml: string,
): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `UPDATE newsletters SET subject = $2, body_html = $3, updated_at = now()
        WHERE id = $1 AND status = 'draft'
       RETURNING id, subject, body_html, status, sent_at, recipient_count`,
      [id, subject, bodyHtml],
    )
  ).rows[0];
  return row ? toNewsletter(row) : null;
}

// Recipients: every consenting donor with an email, deduped case-insensitively by address.
export async function listNewsletterRecipients(): Promise<NewsletterRecipient[]> {
  const rows = (
    await pool.query<{ email: string; donor_id: number }>(
      `SELECT lower(email) AS email, min(id) AS donor_id
         FROM donors
        WHERE email_consent = true AND email IS NOT NULL
        GROUP BY lower(email)
        ORDER BY email`,
    )
  ).rows;
  return rows.map((r) => ({ email: r.email, donorId: r.donor_id }));
}

// Mark a draft sent. Returns false when the row is not a draft (already sent / missing) so the route
// can treat a re-send as a no-op 409 — a double-click cannot re-blast.
export async function markNewsletterSent(
  id: number,
  sentBy: number,
  recipientCount: number,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE newsletters
        SET status = 'sent', sent_at = now(), sent_by = $2, recipient_count = $3
      WHERE id = $1 AND status = 'draft'`,
    [id, sentBy, recipientCount],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function unsubscribeDonor(donorId: number): Promise<void> {
  await pool.query(`UPDATE donors SET email_consent = false WHERE id = $1`, [donorId]);
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/db/newsletters.ts
git commit -m "[TASK-161] Add newsletters DB model (CRUD, recipients, unsubscribe)"
```

---

### Task 6: Email client `sendNewsletter`

**Files:**
- Modify: `src/clients/email.ts` (append a new interface + function, mirroring the existing sends)

**Interfaces:**
- Consumes: `config.EMAIL_SEND_URL`, the module's existing `useStub` seam.
- Produces:
  - `interface NewsletterEmail { to: string; from: string; replyTo: string; subject: string; html: string }`
  - `sendNewsletter(message: NewsletterEmail): Promise<void>`

- [ ] **Step 1: Append the interface + function**

At the end of `src/clients/email.ts`, add:

```ts
// The admin newsletter send (TASK-161/REQ-069). Sends ONE individual message per consenting donor,
// with From + Reply-To set to config.NEWSLETTER_FROM_EMAIL so replies reach a real inbox (not
// noreply). Each message's html already carries the recipient's unsubscribe link (built by the route
// from buildNewsletterHtml). Same stub-seam + best-effort contract as the other sends: a placeholder
// EMAIL_SEND_URL means no network outside production.
export interface NewsletterEmail {
  to: string;
  from: string; // config.NEWSLETTER_FROM_EMAIL
  replyTo: string; // same as from
  subject: string;
  html: string;
}

export async function sendNewsletter(message: NewsletterEmail): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`Newsletter email send responded ${res.status}`);
  }
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/clients/email.ts
git commit -m "[TASK-161] Add sendNewsletter email client function"
```

---

### Task 7: Admin newsletter API endpoints + BDD

Five endpoints in the existing admin router. Editor+ for list/read/create/edit; **Admin only** for send. Send is idempotent (409 on already-sent).

**Files:**
- Modify: `src/routes/admin.ts` (imports, handlers, router registrations)
- Create: `features/newsletter.feature`
- Create: `features/steps/newsletter.steps.js`

**Interfaces:**
- Consumes: `authorizeAdmin`, `config`, model fns from Task 5, `signUnsubscribeToken` (Task 3), `buildNewsletterHtml` (Task 4), `sendNewsletter` (Task 6).
- Produces (HTTP):
  - `GET /api/admin/newsletters` (Editor+) → `NewsletterSummary[]`
  - `GET /api/admin/newsletters/:id` (Editor+) → `Newsletter` | 404
  - `POST /api/admin/newsletters` (Editor+) `{subject, bodyHtml}` → 201 `Newsletter`
  - `PUT /api/admin/newsletters/:id` (Editor+) `{subject, bodyHtml}` → `Newsletter` | 404 | 409(sent)
  - `POST /api/admin/newsletters/:id/send` (Admin) → `{status:"sent", recipientCount}` | 404 | 409(sent)

- [ ] **Step 1: Add imports**

In `src/routes/admin.ts`, add to the imports:

```ts
import {
  listNewsletters,
  getNewsletter,
  createNewsletter,
  updateNewsletterDraft,
  listNewsletterRecipients,
  markNewsletterSent,
} from "../db/newsletters";
import { signUnsubscribeToken } from "../donors/unsubscribe-token";
import { buildNewsletterHtml } from "../donors/newsletter";
import { sendNewsletter } from "../clients/email";
```

- [ ] **Step 2: Add a positive-integer id helper (reuse the pattern) and the handlers**

Add near the other handlers in `src/routes/admin.ts` (the file already has a `donorId(req,res)` helper; add a generic `newsletterId` mirroring it, then the handlers):

```ts
function newsletterId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid newsletter id" });
    return null;
  }
  return id;
}

const newsletterBodySchema = z.object({
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
});

// GET /api/admin/newsletters — list summaries (Editor+; read-only but the tab is a staff tool).
export async function getAdminNewsletters(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  return res.json(await listNewsletters());
}

// GET /api/admin/newsletters/:id — one newsletter incl. body_html (Editor+).
export async function getAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const row = await getNewsletter(id);
  if (!row) return res.status(404).json({ error: "Newsletter not found" });
  return res.json(row);
}

// POST /api/admin/newsletters — create a new draft (Editor+).
export async function postAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  const parsed = newsletterBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid newsletter", details: parsed.error.flatten() });
  }
  const created = await createNewsletter(parsed.data.subject, parsed.data.bodyHtml);
  return res.status(201).json(created);
}

// PUT /api/admin/newsletters/:id — edit a draft (Editor+). A sent newsletter is immutable → 409.
export async function putAdminNewsletter(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const parsed = newsletterBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid newsletter", details: parsed.error.flatten() });
  }
  const existing = await getNewsletter(id);
  if (!existing) return res.status(404).json({ error: "Newsletter not found" });
  if (existing.status === "sent") {
    return res.status(409).json({ error: "A sent newsletter cannot be edited" });
  }
  const updated = await updateNewsletterDraft(id, parsed.data.subject, parsed.data.bodyHtml);
  if (!updated) return res.status(409).json({ error: "A sent newsletter cannot be edited" });
  return res.json(updated);
}

// POST /api/admin/newsletters/:id/send — Admin only. Sends one email per consenting donor, each with
// an unsubscribe link, then marks the newsletter sent. Idempotent: an already-sent newsletter → 409.
export async function postAdminSendNewsletter(req: Request, res: Response): Promise<Response | void> {
  const claims = authorizeAdmin(req, res, "admin");
  if (!claims) return;
  const id = newsletterId(req, res);
  if (id === null) return;
  const row = await getNewsletter(id);
  if (!row) return res.status(404).json({ error: "Newsletter not found" });
  if (row.status === "sent") {
    return res.status(409).json({ error: "This newsletter has already been sent" });
  }

  const recipients = await listNewsletterRecipients();
  for (const r of recipients) {
    const token = signUnsubscribeToken(r.donorId, config.ADMIN_SESSION_SECRET);
    const unsubscribeUrl = `${config.PORTAL_BASE_URL}/unsubscribe/${token}`;
    const html = buildNewsletterHtml(row.bodyHtml, unsubscribeUrl);
    try {
      await sendNewsletter({
        to: r.email,
        from: config.NEWSLETTER_FROM_EMAIL,
        replyTo: config.NEWSLETTER_FROM_EMAIL,
        subject: row.subject,
        html,
      });
    } catch (err) {
      // Best-effort: a single failed send is logged, not fatal to the batch.
      console.error(`newsletter send to ${r.email} failed`, err);
    }
  }

  const marked = await markNewsletterSent(id, claims.sub, recipients.length);
  if (!marked) return res.status(409).json({ error: "This newsletter has already been sent" });
  return res.json({ status: "sent", recipientCount: recipients.length });
}
```

- [ ] **Step 3: Register the routes**

At the bottom of `src/routes/admin.ts` (with the other `adminRouter.<verb>` lines), add:

```ts
adminRouter.get("/api/admin/newsletters", getAdminNewsletters);
adminRouter.get("/api/admin/newsletters/:id", getAdminNewsletter);
adminRouter.post("/api/admin/newsletters", postAdminNewsletter);
adminRouter.put("/api/admin/newsletters/:id", putAdminNewsletter);
adminRouter.post("/api/admin/newsletters/:id/send", postAdminSendNewsletter);
```

- [ ] **Step 4: Write the BDD feature**

`features/newsletter.feature`:

```gherkin
@newsletter @db
Feature: Admin newsletter (REQ-069)
  Staff author an HTML newsletter and save it as a draft (Editor and up). An Admin sends it to
  every consenting donor as an individual email; sending is idempotent. A Viewer cannot edit and
  an Editor cannot send.

  Scenario: an Editor creates and edits a draft
    Given a newsletter admin "editor.newsletter.bdd@example.com" with role "editor" and password "pw-editor"
    When I create a newsletter with subject "Winter update" and body "<p>Hello</p>"
    Then the newsletter response status should be 201
    When I edit that newsletter with subject "Winter update v2" and body "<p>Hello again</p>"
    Then the newsletter response status should be 200
    And the newsletter response field "subject" should be "Winter update v2"

  Scenario: an Admin sends a draft to consenting donors, and cannot re-send it
    Given a newsletter admin "admin.newsletter.bdd@example.com" with role "admin" and password "pw-admin"
    And a consenting donor with email "sub1.newsletter.bdd@example.com"
    And a consenting donor with email "sub2.newsletter.bdd@example.com"
    And a non-consenting donor with email "nope.newsletter.bdd@example.com"
    When I create a newsletter with subject "Send me" and body "<p>Go</p>"
    And I send that newsletter
    Then the newsletter response status should be 200
    And the newsletter response field "status" should be "sent"
    And the newsletter recipient count should be at least 2
    When I send that newsletter
    Then the newsletter response status should be 409

  Scenario: an Editor cannot send
    Given a newsletter admin "editor2.newsletter.bdd@example.com" with role "editor" and password "pw-e2"
    When I create a newsletter with subject "Nope" and body "<p>x</p>"
    And I send that newsletter
    Then the newsletter response status should be 403
```

- [ ] **Step 5: Write the step definitions**

`features/steps/newsletter.steps.js` (mirrors `features/steps/admin-api.steps.js` — seed users/donors, log in, call endpoints):

```js
const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes, scryptSync } = require("node:crypto");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return body.token;
}

Before({ tags: "@newsletter" }, async function () {
  await pool.query("DELETE FROM users WHERE email LIKE '%newsletter.bdd@example.com'");
  await pool.query("DELETE FROM donors WHERE email LIKE '%newsletter.bdd@example.com'");
  // Remove any newsletters a prior run created (subjects are test-specific).
  await pool.query(
    "DELETE FROM newsletters WHERE subject IN ('Winter update','Winter update v2','Send me','Nope')",
  );
});

After({ tags: "@newsletter" }, async function () {
  await pool.query(
    "DELETE FROM newsletters WHERE subject IN ('Winter update','Winter update v2','Send me','Nope')",
  );
});

// Unique phrasing: `an admin user {string} with role {string} and password {string}` is ALREADY
// defined in admin-api.steps.js (it only seeds; it does not log in). Cucumber loads all step files
// globally, so redefining that text is an ambiguous-step error. This step seeds AND logs in, storing
// the token for the newsletter calls.
Given(
  "a newsletter admin {string} with role {string} and password {string}",
  async function (email, role, password) {
    await pool.query(
      "INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4)",
      [email, "Newsletter Tester", role, hashPassword(password)],
    );
    this.token = await login(email, password);
    assert.ok(this.token, "expected a session token");
  },
);

Given("a consenting donor with email {string}", async function (email) {
  await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', 'Sub', $1, true)",
    [email],
  );
});

Given("a non-consenting donor with email {string}", async function (email) {
  await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', 'NoSub', $1, false)",
    [email],
  );
});

async function authFetch(path, method, body, token) {
  const opts = { method, headers: { Authorization: "Bearer " + token } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

When(
  "I create a newsletter with subject {string} and body {string}",
  async function (subject, body) {
    const r = await authFetch("/api/admin/newsletters", "POST", { subject, bodyHtml: body }, this.token);
    this.nlStatus = r.status;
    this.nlBody = r.json;
    if (r.json && r.json.id) this.newsletterId = r.json.id;
  },
);

When(
  "I edit that newsletter with subject {string} and body {string}",
  async function (subject, body) {
    const r = await authFetch(
      `/api/admin/newsletters/${this.newsletterId}`,
      "PUT",
      { subject, bodyHtml: body },
      this.token,
    );
    this.nlStatus = r.status;
    this.nlBody = r.json;
  },
);

When("I send that newsletter", async function () {
  const r = await authFetch(`/api/admin/newsletters/${this.newsletterId}/send`, "POST", undefined, this.token);
  this.nlStatus = r.status;
  this.nlBody = r.json;
});

Then("the newsletter response status should be {int}", function (expected) {
  assert.equal(this.nlStatus, expected);
});

Then("the newsletter response field {string} should be {string}", function (field, value) {
  assert.equal(String(this.nlBody[field]), value);
});

Then("the newsletter recipient count should be at least {int}", function (min) {
  assert.ok(this.nlBody.recipientCount >= min, `recipientCount ${this.nlBody.recipientCount} < ${min}`);
});
```

- [ ] **Step 6: Run the BDD locally**

Start the app against the local DB, then run BDD. (See memory: kill any zombie server on :3002 first; clear leftover test rows if the DB is dirty.)

Run: `npm run build && npm run test:bdd -- --tags @newsletter`
Expected: PASS (3 scenarios). Emails are stubbed (placeholder `EMAIL_SEND_URL`), so no network.

- [ ] **Step 7: Commit**

```bash
git add src/routes/admin.ts features/newsletter.feature features/steps/newsletter.steps.js
git commit -m "[TASK-161] Add admin newsletter API (CRUD + role-gated send) + BDD"
```

---

### Task 8: Public unsubscribe route + BDD

**Files:**
- Create: `src/routes/unsubscribe.ts`
- Modify: `src/app.ts` (import + mount before the site catch-all router)
- Modify: `features/newsletter.feature` (add an unsubscribe scenario)
- Modify: `features/steps/newsletter.steps.js` (add unsubscribe steps + token helper)

**Interfaces:**
- Consumes: `verifyUnsubscribeToken`/`UnsubscribeTokenError` (Task 3), `unsubscribeDonor` (Task 5), `config.ADMIN_SESSION_SECRET`.
- Produces (HTTP): `GET /unsubscribe/:token` → 200 HTML (unsubscribed) | 400 HTML (invalid token).

- [ ] **Step 1: Write the route**

`src/routes/unsubscribe.ts`:

```ts
import { Router, type Request, type Response } from "express";
import { verifyUnsubscribeToken, UnsubscribeTokenError } from "../donors/unsubscribe-token";
import { unsubscribeDonor } from "../db/newsletters";
import { config } from "../config";

// Public newsletter unsubscribe (TASK-161/REQ-069). A newsletter email carries
// `${PORTAL_BASE_URL}/unsubscribe/<token>`. The token is a stateless HMAC of the donor id (signed
// with ADMIN_SESSION_SECRET). A valid token flips that donor's email_consent to false (idempotent)
// and returns a small confirmation page — rendered inline, so no new static .html file is needed
// (avoids Dockerfile-COPY / page-list guard drift). An invalid token → 400.
export const unsubscribeRouter = Router();

function page(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Newsletter — North Berwick Christmas Committee</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Newsletter</h1><p>${message}</p></body></html>`;
}

unsubscribeRouter.get("/unsubscribe/:token", async (req: Request, res: Response) => {
  let donorId: number;
  try {
    donorId = verifyUnsubscribeToken(req.params.token, config.ADMIN_SESSION_SECRET);
  } catch (err) {
    if (err instanceof UnsubscribeTokenError) {
      return res.status(400).type("html").send(page("This unsubscribe link is not valid."));
    }
    throw err;
  }
  await unsubscribeDonor(donorId);
  return res
    .status(200)
    .type("html")
    .send(page("You've been unsubscribed. You will no longer receive our newsletter."));
});
```

- [ ] **Step 2: Mount in `src/app.ts`**

Add the import near the other route imports:

```ts
import { unsubscribeRouter } from "./routes/unsubscribe";
```

And mount it after `adminRouter` and **before** the site catch-all router (`createSiteRouter`):

```ts
  app.use(unsubscribeRouter);
```

(Place it just before the `app.use(createSiteRouter(...))` line so the site router's catch-all does not shadow `/unsubscribe`.)

- [ ] **Step 3: Add the unsubscribe scenario to the feature**

Append to `features/newsletter.feature`:

```gherkin
  Scenario: a donor unsubscribes via their token link, and is then excluded
    Given a consenting donor with email "leaver.newsletter.bdd@example.com"
    When I visit the unsubscribe link for "leaver.newsletter.bdd@example.com"
    Then the unsubscribe response status should be 200
    And the donor "leaver.newsletter.bdd@example.com" should have email consent "false"

  Scenario: an invalid unsubscribe token is rejected
    When I visit the unsubscribe link with token "garbage.token"
    Then the unsubscribe response status should be 400
```

- [ ] **Step 4: Add the unsubscribe steps + token helper**

Append to `features/steps/newsletter.steps.js`:

```js
const { createHmac } = require("node:crypto");

function signUnsubscribeToken(donorId, secret) {
  const body = String(donorId);
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

When("I visit the unsubscribe link for {string}", async function (email) {
  const row = await pool.query("SELECT id FROM donors WHERE email = $1", [email]);
  const donorId = row.rows[0].id;
  const token = signUnsubscribeToken(donorId, process.env.ADMIN_SESSION_SECRET);
  const res = await fetch(`${BASE_URL}/unsubscribe/${token}`);
  this.unsubStatus = res.status;
});

When("I visit the unsubscribe link with token {string}", async function (token) {
  const res = await fetch(`${BASE_URL}/unsubscribe/${token}`);
  this.unsubStatus = res.status;
});

Then("the unsubscribe response status should be {int}", function (expected) {
  assert.equal(this.unsubStatus, expected);
});

Then(
  "the donor {string} should have email consent {string}",
  async function (email, expected) {
    const row = await pool.query("SELECT email_consent FROM donors WHERE email = $1", [email]);
    assert.equal(String(row.rows[0].email_consent), expected);
  },
);
```

Also extend the `Before`/`After` cleanup filter is already `%newsletter.bdd@example.com`, which covers `leaver.newsletter.bdd@example.com` — no change needed.

- [ ] **Step 5: Run BDD**

Run: `npm run build && npm run test:bdd -- --tags @newsletter`
Expected: PASS (5 scenarios total). The step reads `process.env.ADMIN_SESSION_SECRET` — the BDD harness sets it (same key the app boots with); confirm it's in the BDD env (it is used by admin-auth already).

- [ ] **Step 6: Commit**

```bash
git add src/routes/unsubscribe.ts src/app.ts features/newsletter.feature features/steps/newsletter.steps.js
git commit -m "[TASK-161] Add public unsubscribe route (flips email_consent) + BDD"
```

---

### Task 9: Admin UI — Newsletter tab

**Files:**
- Modify: `admin.html` (nav button + view section)
- Modify: `assets/js/admin/app.js` (dispatch case + load/render/save/send functions)

**Interfaces:**
- Consumes: the `/api/admin/newsletters` endpoints (Task 7). Reuses the existing `authFetch`, `currentRole`, `el`, `selectView` in `app.js`.
- Produces: a `data-view="newsletter"` tab with a list + editor form.

- [ ] **Step 1: Add the nav button**

In `admin.html`, in the `.admin-nav` list (after the Subscriptions `<li>`, around line 57), add:

```html
              <li><button class="admin-nav-link" type="button" data-view="newsletter">Newsletter</button></li>
```

- [ ] **Step 2: Add the view section**

In `admin.html`, after the Subscriptions `<section>` (mirroring its structure, around line 156-159), add:

```html
            <!-- Newsletter: author, save (Editor+) and send (Admin only) to consenting donors. -->
            <section class="admin-view" id="view-newsletter" aria-labelledby="newsletter-heading" hidden>
              <h2 id="newsletter-heading">Newsletter</h2>
              <div class="admin-table-wrap" id="newsletterList" aria-live="polite"><p class="admin-loading">Loading…</p></div>
              <form id="newsletterForm">
                <input type="hidden" id="newsletterId" />
                <p><label>Subject<br /><input type="text" id="newsletterSubject" required style="width:100%" /></label></p>
                <p><label>Body (HTML)<br /><textarea id="newsletterBody" rows="14" required style="width:100%"></textarea></label></p>
                <p>
                  <button type="button" id="newsletterNew">New newsletter</button>
                  <button type="submit" id="newsletterSave">Save</button>
                  <button type="button" id="newsletterSend" hidden>Send to subscribers</button>
                </p>
                <p id="newsletterMsg" aria-live="polite"></p>
              </form>
            </section>
```

- [ ] **Step 3: Wire the dispatch**

In `assets/js/admin/app.js`, in `selectView`, add a branch alongside the others (after the `audit` branch, around line 128):

```js
    else if (name === "newsletter") loadNewsletters();
```

- [ ] **Step 4: Add the load/render/save/send functions**

In `assets/js/admin/app.js`, inside the IIFE (near the other `load*` functions, e.g. after `loadAudit`), add:

```js
  // ---- newsletter ----
  function renderNewsletterList(rows) {
    if (!rows.length) return '<p class="admin-loading">No newsletters yet.</p>';
    var html = '<table class="admin-table"><thead><tr><th>Subject</th><th>Status</th><th>Sent</th><th>Recipients</th><th></th></tr></thead><tbody>';
    rows.forEach(function (n) {
      html +=
        "<tr><td>" + escapeHtml(n.subject) + "</td><td>" + n.status + "</td><td>" +
        (n.sentAt ? new Date(n.sentAt).toLocaleString() : "—") + "</td><td>" +
        (n.recipientCount == null ? "—" : n.recipientCount) +
        '</td><td><button class="admin-link" type="button" data-edit-newsletter="' + n.id + '">Open</button></td></tr>';
    });
    return html + "</tbody></table>";
  }

  function loadNewsletterInto(id) {
    authFetch("/api/admin/newsletters/" + id)
      .then(j)
      .then(function (n) {
        el("newsletterId").value = n.id;
        el("newsletterSubject").value = n.subject;
        el("newsletterBody").value = n.bodyHtml;
        var sent = n.status === "sent";
        // Send is Admin-only and only for an unsent newsletter.
        el("newsletterSend").hidden = !(currentRole === "admin" && !sent);
        el("newsletterSave").disabled = sent;
        el("newsletterMsg").textContent = sent ? "This newsletter has been sent and is read-only." : "";
      })
      .catch(function () {});
  }

  function loadNewsletters() {
    authFetch("/api/admin/newsletters")
      .then(j)
      .then(function (rows) {
        el("newsletterList").innerHTML = renderNewsletterList(rows);
        Array.prototype.forEach.call(doc.querySelectorAll("[data-edit-newsletter]"), function (b) {
          b.addEventListener("click", function () {
            loadNewsletterInto(b.getAttribute("data-edit-newsletter"));
          });
        });
        // Open the first newsletter by default so the editor is never empty.
        if (rows.length) loadNewsletterInto(rows[0].id);
      })
      .catch(function () {});
  }

  var nlForm = el("newsletterForm");
  if (nlForm) {
    el("newsletterNew").addEventListener("click", function () {
      el("newsletterId").value = "";
      el("newsletterSubject").value = "";
      el("newsletterBody").value = "";
      el("newsletterSend").hidden = true; // save first to get an id
      el("newsletterSave").disabled = false;
      el("newsletterMsg").textContent = "";
    });

    nlForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var id = el("newsletterId").value;
      var payload = { subject: el("newsletterSubject").value, bodyHtml: el("newsletterBody").value };
      var req = id
        ? authFetch("/api/admin/newsletters/" + id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : authFetch("/api/admin/newsletters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      req
        .then(j)
        .then(function (n) {
          el("newsletterMsg").textContent = "Saved.";
          loadNewsletters();
          loadNewsletterInto(n.id);
        })
        .catch(function () {
          el("newsletterMsg").textContent = "Save failed.";
        });
    });

    el("newsletterSend").addEventListener("click", function () {
      var id = el("newsletterId").value;
      if (!id) return;
      el("newsletterMsg").textContent = "Sending…";
      authFetch("/api/admin/newsletters/" + id + "/send", { method: "POST" })
        .then(j)
        .then(function (r) {
          el("newsletterMsg").textContent = "Sent to " + r.recipientCount + " subscriber(s).";
          loadNewsletters();
          loadNewsletterInto(id);
        })
        .catch(function () {
          el("newsletterMsg").textContent = "Send failed (already sent, or not permitted).";
        });
    });
  }
```

Note: if `app.js` has no existing `escapeHtml` helper, add a minimal one near the top of the IIFE:

```js
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
```

(Check first: `grep -n "escapeHtml" assets/js/admin/app.js` — only add it if absent.)

- [ ] **Step 5: Manual verification in the browser**

Build + run locally, sign in as an Admin, open the Newsletter tab:
- The seeded starter draft loads into the editor.
- Edit + Save updates the list.
- "New newsletter" clears the form; Save creates a second row.
- "Send to subscribers" shows a recipient count and the row flips to `sent`; the editor becomes read-only and Send hides.
- Sign in as an Editor: the Send button is hidden; Save still works.

Run: `npm run dev` (or the project's run recipe) and drive the flow. Screenshot optional.

- [ ] **Step 6: Verify lint/build**

Run: `npm run build && npm run lint`
Expected: PASS. (`app.js` is not TypeScript; lint still covers it if configured — fix any ESLint findings.)

- [ ] **Step 7: Commit**

```bash
git add admin.html assets/js/admin/app.js
git commit -m "[TASK-161] Add admin Newsletter tab (author/save/send UI)"
```

---

### Task 10: README + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add to the relevant sections of `README.md`:
- **Routes/behaviour:** the admin Newsletter tab (author HTML, save drafts as Editor+, send as Admin) and the public `GET /unsubscribe/:token` route.
- **Config:** `NEWSLETTER_FROM_EMAIL` (From/Reply-To of newsletter emails; default `newsletter@nbcc.scot`).
- **Note** the ops prerequisite: `newsletter@nbcc.scot` must be a verified sender on the email provider behind `EMAIL_SEND_URL` for production sends, and the provider must honour per-message `from`/`replyTo`.

- [ ] **Step 2: Full local verification (evidence before completion)**

Run each and confirm green:

```bash
npm run lint
npm run build
npm run test:unit
npm run test:bdd -- --tags @newsletter
```

Expected: all PASS. (For BDD: app running against local DB; kill any zombie server on the local port first; clear leftover `newsletter.bdd` rows if the DB is dirty — per memory notes.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "[TASK-161] README: document newsletter tab, unsubscribe route, NEWSLETTER_FROM_EMAIL"
```

- [ ] **Step 4: Push + open PR + drive to green**

```bash
git push -u origin task-161-admin-newsletter
gh pr create --title "[TASK-161] Admin newsletter: author, save and send to consenting donors (REQ-069)" --body "<summary + REQ-069 + test evidence>"
gh pr checks <pr> --watch
```

On green → `gh pr merge <pr> --squash --delete-branch`. On red → open the failing job, fix, push, wait again. (PR workflow in CLAUDE.md.)

---

## Self-Review

**Spec coverage:**
- Newsletter tab + editor → Task 9. ✅
- Seeded default newsletter → Task 2 (seed row). ✅
- Save drafts (Editor+) → Task 7 (POST/PUT, editor gate) + Task 9. ✅
- Send (Admin only) → Task 7 (`postAdminSendNewsletter`, admin gate). ✅
- History model (each newsletter its own row) → Task 2 schema + Task 5 list. ✅
- Recipients = consenting donors (`email_consent`) deduped → Task 5 `listNewsletterRecipients`. ✅
- One individual email per recipient → Task 7 send loop. ✅
- From/Reply-To `newsletter@nbcc.scot`, real inbox → Task 1 config + Task 6 client + Task 7 wiring. ✅
- Idempotent send (no double-blast) → Task 5 `markNewsletterSent` guard + Task 7 409. ✅
- Unsubscribe (compliance) → Task 3 token + Task 8 route + footer in Task 4. ✅
- Config golden-rule-3 wiring incl. CI env → Task 1. ✅
- Tests (unit + BDD) → Tasks 3,4,7,8. ✅
- README → Task 10. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. The PR body and README section text are the only prose-fill points (Task 10 step 1, Task 10 step 4) — acceptable, they're documentation authored at the time.

**Type consistency:** `Newsletter`/`NewsletterSummary`/`NewsletterRecipient` defined in Task 5 and consumed identically in Task 7. `signUnsubscribeToken(donorId, secret)` (Task 3) matches the BDD JS helper (Task 8) and the route call (Task 7). `buildNewsletterHtml(bodyHtml, unsubscribeUrl)` (Task 4) matches the Task 7 call. `sendNewsletter({to,from,replyTo,subject,html})` (Task 6) matches the Task 7 call. `config.NEWSLETTER_FROM_EMAIL` (Task 1) consumed in Task 7. Consistent. ✅
