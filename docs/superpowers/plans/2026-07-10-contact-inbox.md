# Contact Form Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist public contact-form submissions to a dedicated, isolated Postgres database and surface them in a new "Contact form" tab inside the existing `/admin` panel, with a Gmail reply action that marks an enquiry Replied.

**Architecture:** A second isolated Postgres database (`contact`, own `contact_app` login) on the shared RDS server — a faithful clone of the live My Story separate-DB pattern. Reached through its own pool, provisioned imperatively (bootstrap → migrate → deploy), exposed only via authenticated `/api/admin/contact*` routes. The public `POST /api/contact` stops forwarding to an external service and instead stores each enquiry.

**Tech Stack:** Express + TypeScript, node-pg-migrate, pg, Zod, Vitest, Cucumber. Plain ES-module browser JS for the admin front-end (`assets/js/app.js`) and the public form (`assets/js/main.js`).

## Global Constraints

- **Separate DB, isolated login.** Contact code uses `contactPool` (`src/db/contact-pool.ts`) exclusively — never `src/db/pool.ts` or `stories-pool.ts`. Copied verbatim from the spec: "a dedicated DB+login makes it provably impossible for contact code to touch donor, Gift-Aid, or story data."
- **Config via the schema only (golden rule 3).** `CONTACT_DATABASE_URL` must be added in `src/config/schema.ts` AND `.env.example` AND the SSM param (`infra/modules/app/main.tf`) AND the task-def secret + `exec_secrets` IAM (`infra/modules/app/ecs.tf`) AND the `pr.yml` job env. Never read `process.env` outside the config module.
- **Expand-contract migrations (golden rule 2).** The migration is additive-only: a fresh table in a fresh database.
- **Provisioning order is load-bearing:** `bootstrap:contact` (creates DB + role) MUST run before `migrate:contact` (creates the table), which MUST run before/at deploy. Same ordering proven for stories.
- **Dockerfile must COPY every deploy-invoked script/dir** or the ECS one-off task dies with MODULE_NOT_FOUND (this is exactly how stories broke staging). `test/unit/dockerfile-scripts-shipped.test.ts` enforces this.
- **Statuses:** `new` | `replied` only. DB CHECK constraint plus app-layer validation.
- **Honest-save:** the public form shows success ONLY on a 200 response; a 4xx/5xx shows an error and preserves the entered message.
- **Field names are fixed:** `firstName`, `lastName`, `email`, `message` (plus honeypot `company`).
- **Reply marks Replied:** clicking "Reply in Gmail" opens Gmail compose AND PATCHes status→replied in the same action.
- **Every change is a green PR with tests; README.md updated in the same PR (golden rule 7).**

## File Structure

**Create:**
- `src/db/contact-pool.ts` — the isolated pool (mirror `src/db/stories-pool.ts`).
- `src/contact/schema.ts` — Zod submission schema + `ContactEnquiry` type.
- `src/db/contact.ts` — `insertEnquiry` / `listEnquiries` / `getEnquiry` / `markReplied` / `deleteEnquiry`.
- `migrations-contact/<ts>_create-contact-enquiries.js` — the additive table.
- `scripts/bootstrap-contact-db.mjs` — DB + role provisioning (mirror `bootstrap-stories-db.mjs`).
- `assets/js/gmail-reply.js` — pure `buildGmailReplyUrl(enquiry)`.
- `test/unit/contact-schema.test.ts`, `test/unit/gmail-reply.test.ts`, `test/unit/bootstrap-contact-url.test.ts`.

**Modify:**
- `src/config/schema.ts`, `.env.example` — add `CONTACT_DATABASE_URL`.
- `package.json` — `migrate:contact`, `bootstrap:contact` scripts.
- `Dockerfile` — COPY `migrations-contact` + `scripts/bootstrap-contact-db.mjs`.
- `docker-compose.yml` — contact DB env + create-db init + `migrate-contact` service.
- `.github/workflows/pr.yml` — `CONTACT_DATABASE_URL` env, create DB, `migrate:contact`.
- `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-prod.yml` — bootstrap + migrate steps.
- `infra/modules/app/main.tf`, `infra/modules/app/ecs.tf` — SSM param + secret + IAM.
- `src/routes/api.ts` — rewrite `postContact` to store.
- `src/routes/admin.ts` — `/api/admin/contact*` routes.
- `admin.html`, `assets/js/app.js` — the Contact form tab.
- `assets/js/main.js` — `initContactForm` honest-save.
- `contact.html` — honeypot field.
- `features/contact.feature`, `test/unit/contact-endpoint.test.ts`, `test/unit/contact.test.ts` — updated for store behaviour.
- `test/unit/dockerfile-scripts-shipped.test.ts` — expect contact scripts.
- `README.md`.

---

### Task 1: Contact DB config + isolated pool

**Files:**
- Modify: `src/config/schema.ts:17` (after `STORIES_DATABASE_URL`)
- Modify: `.env.example`
- Create: `src/db/contact-pool.ts`
- Test: `test/unit/config-contact-url.test.ts`

**Interfaces:**
- Produces: `config.CONTACT_DATABASE_URL: string` (URL); `contactPool: Pool` (from `src/db/contact-pool.ts`).

- [ ] **Step 1: Write the failing test**

Create `test/unit/config-contact-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema";

const base = {
  DATABASE_URL: "postgres://app:app@localhost:5432/charity",
  STORIES_DATABASE_URL: "postgres://stories_app:stories@localhost:5432/stories",
  CONTACT_DATABASE_URL: "postgres://contact_app:contact@localhost:5432/contact",
  EXTERNAL_API_ONE_BASE_URL: "https://api.example/one",
  EXTERNAL_API_ONE_KEY: "k1",
  EXTERNAL_API_TWO_KEY: "k2",
  STRIPE_SECRET_KEY: "sk",
  STRIPE_SUCCESS_URL: "https://x.example/s",
  STRIPE_CANCEL_URL: "https://x.example/c",
  STRIPE_PRICE_BRONZE: "p",
  STRIPE_PRICE_SILVER: "p",
  STRIPE_PRICE_GOLD: "p",
  STRIPE_PRICE_PLATINUM: "p",
  STRIPE_WEBHOOK_SECRET: "whsec",
  CONTACT_FORWARD_URL: "https://forms.example/x",
  EMAIL_SEND_URL: "https://email.example/send",
  DECLARATION_FORM_BASE_URL: "https://x.example/d",
  ADMIN_NOTIFICATION_EMAIL: "ops@nbcc.scot",
  PORTAL_BASE_URL: "https://x.example",
  ADMIN_SESSION_SECRET: "s",
};

describe("CONTACT_DATABASE_URL config", () => {
  it("parses when present and a valid URL", () => {
    const parsed = configSchema.parse(base);
    expect(parsed.CONTACT_DATABASE_URL).toBe(base.CONTACT_DATABASE_URL);
  });

  it("fails to boot when missing", () => {
    const { CONTACT_DATABASE_URL, ...withoutContact } = base;
    expect(() => configSchema.parse(withoutContact)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/config-contact-url.test.ts`
Expected: FAIL — `CONTACT_DATABASE_URL` is not in the schema, so `parsed.CONTACT_DATABASE_URL` is undefined.

- [ ] **Step 3: Add the config key**

In `src/config/schema.ts`, immediately after the `STORIES_DATABASE_URL` block (line 17), add:

```ts
  // Contact form inbox (2026-07-10 contact-inbox spec). Lives in a SEPARATE Postgres
  // database (own name + credentials, same RDS server) so the contact feature can never
  // read/write the main `charity` DB or the `stories` DB — accessed only via
  // src/db/contact-pool.ts. Required, never defaulted (mirrors DATABASE_URL /
  // STORIES_DATABASE_URL): a missing value must fail boot, not silently fall back.
  CONTACT_DATABASE_URL: z.string().url(),
```

- [ ] **Step 4: Create the pool**

Create `src/db/contact-pool.ts`:

```ts
import { Pool } from "pg";
import { config } from "../config";

// A SEPARATE pool from src/db/pool.ts and src/db/stories-pool.ts, pointed at the dedicated
// `contact` database (own name + credentials, same RDS server). This is the ONLY pool the
// contact-inbox feature may use — it must never import or reach the main `charity` DB or the
// `stories` DB.
export const contactPool = new Pool({
  connectionString: config.CONTACT_DATABASE_URL,
  max: 5, // small pool: Fargate tasks are few; keep RDS connections modest
});
```

- [ ] **Step 5: Add the local example value**

In `.env.example`, next to the `STORIES_DATABASE_URL` line, add:

```
CONTACT_DATABASE_URL=postgres://contact_app:contact@localhost:5435/contact
```

(Match the local port used by the existing `STORIES_DATABASE_URL` line in that file — copy its host:port exactly, changing only the user/db to `contact_app`/`contact`.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/unit/config-contact-url.test.ts`
Expected: PASS (both cases).

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts src/db/contact-pool.ts .env.example test/unit/config-contact-url.test.ts
git commit -m "[TASK-NNN] contact inbox: config key + isolated pool"
```

---

### Task 2: Contact submission schema (Zod)

**Files:**
- Create: `src/contact/schema.ts`
- Test: `test/unit/contact-schema.test.ts`

**Interfaces:**
- Produces:
  - `contactEnquirySchema` — Zod schema.
  - `type ContactEnquiry = { firstName: string; lastName: string; email: string; message: string }`.
  - `CONTACT_MESSAGE_MAX = 5000`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/contact-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contactEnquirySchema, CONTACT_MESSAGE_MAX } from "../../src/contact/schema";

const valid = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", message: "Hello" };

describe("contactEnquirySchema", () => {
  it("accepts a valid enquiry", () => {
    expect(contactEnquirySchema.parse(valid)).toEqual(valid);
  });

  it("defaults a missing lastName to empty string", () => {
    const { lastName, ...noLast } = valid;
    expect(contactEnquirySchema.parse(noLast).lastName).toBe("");
  });

  it("rejects an empty firstName", () => {
    expect(contactEnquirySchema.safeParse({ ...valid, firstName: "" }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(contactEnquirySchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(contactEnquirySchema.safeParse({ ...valid, message: "" }).success).toBe(false);
  });

  it("rejects a message longer than the cap", () => {
    const long = "x".repeat(CONTACT_MESSAGE_MAX + 1);
    expect(contactEnquirySchema.safeParse({ ...valid, message: long }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/contact-schema.test.ts`
Expected: FAIL — module `src/contact/schema` does not exist.

- [ ] **Step 3: Write the schema**

Create `src/contact/schema.ts`:

```ts
import { z } from "zod";

// Zod schema for a public contact-form submission (2026-07-10 contact-inbox spec). Length caps
// bound the payload the public endpoint will INSERT into the isolated contact DB — the app-layer
// analogue of the stories submission schema's caps (src/stories/schema.ts).
export const CONTACT_MESSAGE_MAX = 5000;

export const contactEnquirySchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional().default(""),
  email: z.string().email().max(254),
  message: z.string().min(1).max(CONTACT_MESSAGE_MAX),
});

export type ContactEnquiry = z.infer<typeof contactEnquirySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/contact-schema.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Commit**

```bash
git add src/contact/schema.ts test/unit/contact-schema.test.ts
git commit -m "[TASK-NNN] contact inbox: submission schema"
```

---

### Task 3: Migration + DB access layer

**Files:**
- Create: `migrations-contact/<ts>_create-contact-enquiries.js`
- Modify: `package.json:14-15` (scripts block)
- Create: `src/db/contact.ts`
- Test: exercised by the CI `migrate:contact` step (Task 4) and the endpoint/BDD tests (Task 5); no DB-bound unit test (mirrors `src/db/stories.ts`, which is DB-bound and not unit-tested).

**Interfaces:**
- Consumes: `contactPool` (Task 1), `ContactEnquiry` (Task 2).
- Produces (all `async`, all via `contactPool`):
  - `insertEnquiry(e: ContactEnquiry): Promise<{ id: number }>`
  - `type ContactRow = { id: number; first_name: string; last_name: string; email: string; message: string; status: string; created_at: Date; replied_at: Date | null }`
  - `listEnquiries(status?: string): Promise<ContactRow[]>` — newest-first, optional status filter.
  - `getEnquiry(id: number): Promise<ContactRow | null>`
  - `markReplied(id: number, replied: boolean): Promise<ContactRow | null>` — sets `status` + `replied_at` (`now()` when replied, `null` when reverted to `new`).
  - `deleteEnquiry(id: number): Promise<boolean>`

- [ ] **Step 1: Add the npm scripts**

In `package.json`, in the `scripts` block after the `bootstrap:stories` line (line 15), add:

```json
    "migrate:contact": "node-pg-migrate -m migrations-contact -d CONTACT_DATABASE_URL up",
    "bootstrap:contact": "node scripts/bootstrap-contact-db.mjs",
```

- [ ] **Step 2: Generate the migration file**

Run: `npx node-pg-migrate create create-contact-enquiries -m migrations-contact`
Expected: prints a new path `migrations-contact/<timestamp>_create-contact-enquiries.js`.

- [ ] **Step 3: Write the migration**

Replace the generated file's contents with:

```js
/* eslint-disable */
// Contact inbox (2026-07-10 spec). This migration lives in its OWN directory
// (migrations-contact/), run against the SEPARATE `contact` database (never the main
// `charity` DB, never the `stories` DB) via `npm run migrate:contact`, tracked by that
// database's own `pgmigrations` table. `contact_enquiries` is the sole object in that database.
//
// Additive-only by construction (a fresh, dedicated database) — golden rule 2 is trivially
// satisfied. Text lengths are capped in the Zod schema (src/contact/schema.ts), not here.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "contact_enquiries",
    {
      id: "id",
      first_name: { type: "text", notNull: true },
      last_name: { type: "text", notNull: true, default: "" },
      email: { type: "text", notNull: true },
      message: { type: "text", notNull: true },
      status: { type: "text", notNull: true, default: "new" }, // new/replied
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      replied_at: { type: "timestamptz" }, // set when marked replied; null otherwise
    },
    {
      comment:
        "Public contact-form submissions (2026-07-10 spec). Lives in its own dedicated database, never the main charity DB or the stories DB.",
    },
  );
  // Defence in depth: status may only ever be one of the two workflow values.
  pgm.addConstraint("contact_enquiries", "contact_enquiries_status_check", {
    check: "status IN ('new', 'replied')",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("contact_enquiries");
};
```

- [ ] **Step 4: Write the DB access layer**

Create `src/db/contact.ts`:

```ts
import { contactPool } from "./contact-pool";
import type { ContactEnquiry } from "../contact/schema";

// The ONLY read/write path for contact enquiries. Uses contactPool exclusively — never
// src/db/pool.ts or stories-pool.ts — so this feature can never reach the main `charity` DB
// or the `stories` DB. No audit_log row (that table lives in the charity DB; this feature is
// self-contained in its own database).

export interface ContactRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  message: string;
  status: string; // new | replied
  created_at: Date;
  replied_at: Date | null;
}

export async function insertEnquiry(e: ContactEnquiry): Promise<{ id: number }> {
  const result = await contactPool.query<{ id: number }>(
    `INSERT INTO contact_enquiries (first_name, last_name, email, message)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [e.firstName, e.lastName, e.email, e.message],
  );
  return { id: result.rows[0].id };
}

// Newest-first, optionally filtered by status. Returns the full row set (the message body is
// small and there is no cross-submitter PII-minimisation concern as there is for stories).
export async function listEnquiries(status?: string): Promise<ContactRow[]> {
  const params: string[] = [];
  let where = "";
  if (status) {
    params.push(status);
    where = ` WHERE status = $1`;
  }
  const result = await contactPool.query<ContactRow>(
    `SELECT id, first_name, last_name, email, message, status, created_at, replied_at
     FROM contact_enquiries${where}
     ORDER BY created_at DESC`,
    params,
  );
  return result.rows;
}

export async function getEnquiry(id: number): Promise<ContactRow | null> {
  const result = await contactPool.query<ContactRow>(
    `SELECT id, first_name, last_name, email, message, status, created_at, replied_at
     FROM contact_enquiries WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

// Set status to 'replied' (replied_at = now()) or back to 'new' (replied_at = null). Returns the
// updated row, or null when the id does not exist.
export async function markReplied(id: number, replied: boolean): Promise<ContactRow | null> {
  const result = await contactPool.query<ContactRow>(
    `UPDATE contact_enquiries
     SET status = $2, replied_at = ${replied ? "now()" : "NULL"}
     WHERE id = $1
     RETURNING id, first_name, last_name, email, message, status, created_at, replied_at`,
    [id, replied ? "replied" : "new"],
  );
  return result.rows[0] ?? null;
}

export async function deleteEnquiry(id: number): Promise<boolean> {
  const result = await contactPool.query(`DELETE FROM contact_enquiries WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
```

- [ ] **Step 5: Verify build + migration validity locally**

Run: `npm run build`
Expected: PASS (tsc clean).

If a local `contact` DB is available (see `.env.example`), run: `npm run migrate:contact`
Expected: applies `create-contact-enquiries`. (In CI this runs against a fresh DB in Task 4's pr.yml step — that is the authoritative check.)

- [ ] **Step 6: Commit**

```bash
git add package.json migrations-contact src/db/contact.ts
git commit -m "[TASK-NNN] contact inbox: migration + DB access layer"
```

---

### Task 4: Provisioning — bootstrap script, Dockerfile, compose, CI/deploy pipelines

**Files:**
- Create: `scripts/bootstrap-contact-db.mjs`
- Modify: `Dockerfile:18-30` (the stories COPY block)
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/pr.yml:26,75-80`
- Modify: `.github/workflows/deploy-staging.yml:82-109`, `.github/workflows/deploy-prod.yml:87-114`
- Modify: `test/unit/dockerfile-scripts-shipped.test.ts:66`
- Test: `test/unit/bootstrap-contact-url.test.ts`, and the extended `dockerfile-scripts-shipped.test.ts`.

**Interfaces:**
- Consumes: `config.CONTACT_DATABASE_URL` (env `CONTACT_DATABASE_URL`), master `DATABASE_URL`.
- Produces: `parseContactUrl`, `quoteIdent`, `quoteLiteral`, `bootstrapContactDb` (exported from `scripts/bootstrap-contact-db.mjs`).

- [ ] **Step 1: Write the failing bootstrap URL test**

Create `test/unit/bootstrap-contact-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseContactUrl, quoteIdent, quoteLiteral } from "../../scripts/bootstrap-contact-db.mjs";

describe("parseContactUrl", () => {
  it("extracts user/password/database", () => {
    expect(parseContactUrl("postgres://contact_app:pw@host:5432/contact")).toEqual({
      user: "contact_app",
      password: "pw",
      database: "contact",
    });
  });

  it("throws on a non-URL", () => {
    expect(() => parseContactUrl("not-a-url")).toThrow();
  });

  it("throws when user or password is missing", () => {
    expect(() => parseContactUrl("postgres://host:5432/contact")).toThrow();
  });
});

describe("identifier/literal quoting", () => {
  it("doubles embedded quotes", () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(quoteLiteral("a'b")).toBe("'a''b'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/bootstrap-contact-url.test.ts`
Expected: FAIL — `scripts/bootstrap-contact-db.mjs` does not exist.

- [ ] **Step 3: Write the bootstrap script**

Create `scripts/bootstrap-contact-db.mjs` as a copy of `scripts/bootstrap-stories-db.mjs` with every `stories` token renamed to `contact`. Concretely: `parseStoriesUrl`→`parseContactUrl`, `bootstrapStoriesDb`→`bootstrapContactDb`, `STORIES_DATABASE_URL`→`CONTACT_DATABASE_URL`, `storiesUrl`→`contactUrl`, and comment/log text `stories`→`contact`. `quoteIdent` / `quoteLiteral` keep their names. The full file:

```js
// Contact inbox database bootstrap (2026-07-10 spec). Terraform generates the `contact_app`
// credential and publishes it as the CONTACT_DATABASE_URL SSM parameter
// (infra/modules/app/main.tf), but it can't create the database or role itself (no `postgresql`
// Terraform provider; RDS `db_name` is hardcoded to `charity`; RDS is in a private subnet). So
// provisioning happens here, imperatively, run as a one-off `ecs run-task`:
//   1. Connect with the MASTER DATABASE_URL (the `app` user; on RDS has CREATEDB/CREATEROLE).
//   2. Idempotently CREATE ROLE / ALTER ROLE `contact_app` with the password from CONTACT_DATABASE_URL.
//   3. Idempotently CREATE DATABASE `contact` owned by that role.
//   4. GRANT ALL PRIVILEGES.
//
// Safe to re-run. CREATE DATABASE cannot run inside a transaction block, so no BEGIN/COMMIT.
//
// Run: DATABASE_URL=... CONTACT_DATABASE_URL=... node scripts/bootstrap-contact-db.mjs
import pg from "pg";

const { Client } = pg;

export function parseContactUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("CONTACT_DATABASE_URL is not a valid URL");
  }

  const user = parsed.username ? decodeURIComponent(parsed.username) : "";
  const password = parsed.password ? decodeURIComponent(parsed.password) : "";
  const database = parsed.pathname.replace(/^\//, "");

  if (!user || !password) {
    throw new Error("CONTACT_DATABASE_URL is missing a user or password");
  }
  if (!database) {
    throw new Error("CONTACT_DATABASE_URL is missing a database name");
  }

  return { user, password, database };
}

export function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function bootstrapContactDb({ masterUrl, contactUrl, log = console.error } = {}) {
  if (!masterUrl) throw new Error("DATABASE_URL is required (master connection)");
  if (!contactUrl) throw new Error("CONTACT_DATABASE_URL is required");

  const { user, password, database } = parseContactUrl(contactUrl);

  const client = new Client({ connectionString: masterUrl });
  await client.connect();

  try {
    const { rowCount: roleExists } = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [user],
    );
    if (roleExists === 0) {
      log(`creating role ${user}`);
      await client.query(`CREATE ROLE ${quoteIdent(user)} LOGIN PASSWORD ${quoteLiteral(password)}`);
    } else {
      log(`role ${user} already exists; re-syncing password`);
      await client.query(`ALTER ROLE ${quoteIdent(user)} WITH LOGIN PASSWORD ${quoteLiteral(password)}`);
    }

    // On RDS the master user is rds_superuser (not a true superuser) and may only
    // CREATE DATABASE ... OWNER <role> when it is a member of that role. Idempotent.
    await client.query(`GRANT ${quoteIdent(user)} TO CURRENT_USER`);

    const { rowCount: dbExists } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database],
    );
    if (dbExists === 0) {
      log(`creating database ${database}`);
      await client.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(user)}`);
    } else {
      log(`database ${database} already exists`);
    }

    await client.query(`GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent(database)} TO ${quoteIdent(user)}`);

    log("contact database bootstrap complete");
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMain) {
  bootstrapContactDb({
    masterUrl: process.env.DATABASE_URL,
    contactUrl: process.env.CONTACT_DATABASE_URL,
  })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("bootstrap-contact-db failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 4: Run the bootstrap URL test to verify it passes**

Run: `npx vitest run test/unit/bootstrap-contact-url.test.ts`
Expected: PASS.

- [ ] **Step 5: COPY into the Docker image**

In `Dockerfile`, directly below the existing stories COPY lines (after the `COPY scripts/bootstrap-stories-db.mjs ...` line ~30), add:

```dockerfile
# Contact inbox (2026-07-10 spec): a SEPARATE `contact` database on the same RDS instance,
# migrated via `npm run migrate:contact` (-m migrations-contact) and provisioned by
# `npm run bootstrap:contact` (scripts/bootstrap-contact-db.mjs) as one-off ECS tasks. Both must
# ship in the image or the deploy step fails with MODULE_NOT_FOUND (as the stories bootstrap did).
COPY migrations-contact ./migrations-contact
COPY scripts/bootstrap-contact-db.mjs ./scripts/bootstrap-contact-db.mjs
```

- [ ] **Step 6: Extend the Dockerfile guard test**

In `test/unit/dockerfile-scripts-shipped.test.ts`, update the arrayContaining assertion (line 66) to also expect the contact scripts:

```ts
    expect(invoked).toEqual(
      expect.arrayContaining([
        "migrate",
        "bootstrap:stories",
        "migrate:stories",
        "bootstrap:contact",
        "migrate:contact",
      ]),
    );
```

- [ ] **Step 7: docker-compose local wiring**

In `docker-compose.yml`, mirror each stories entry for contact:
1. In the app service `environment:` block, next to `STORIES_DATABASE_URL:`, add:
   `CONTACT_DATABASE_URL: postgres://contact_app:contact@db:5432/contact`
2. Wherever the compose file creates the stories DB on init (the psql/init step near line 27-28), add a sibling `CREATE DATABASE contact` for `contact_app` following the exact same mechanism used for `stories`.
3. Copy the `migrate-stories` one-off service (lines ~52-63) to a `migrate-contact` service: same `depends_on`/image, `CONTACT_DATABASE_URL: postgres://contact_app:contact@db:5432/contact`, `command: npm run migrate:contact`.

- [ ] **Step 8: pr.yml CI wiring**

In `.github/workflows/pr.yml`:
1. In the job `env:` block, next to `STORIES_DATABASE_URL:` (line 26), add:
   `CONTACT_DATABASE_URL: postgres://app:app@localhost:5432/contact`
2. After the "Create stories database" step (lines 78-79), add:
```yaml
      - name: Create contact database
        run: PGPASSWORD=app psql -h localhost -U app -d charity -c 'CREATE DATABASE contact'
      - run: npm run migrate:contact
```

- [ ] **Step 9: deploy-staging.yml + deploy-prod.yml wiring**

In BOTH `.github/workflows/deploy-staging.yml` (after the stories block ~line 109) and `.github/workflows/deploy-prod.yml` (after ~line 114), add contact bootstrap + migrate steps mirroring the stories steps exactly — same `ecs run-task` shape, same "Must run BEFORE migrate" ordering, only swapping the npm script names:

```yaml
      - name: Bootstrap contact database (idempotent)
        # 2026-07-10 contact-inbox spec: one-off provisioning of the SEPARATE `contact` database +
        # `contact_app` role on the same RDS instance. Safe to re-run every deploy; creates/re-syncs
        # only what's missing. Must run BEFORE migrate:contact.
        run: |
          # (copy the stories "Bootstrap" step body verbatim, replacing
          #  "npm","run","bootstrap:stories"  with  "npm","run","bootstrap:contact"
          #  and the echo label text stories->contact)
      - name: Run contact DB migrations
        run: |
          # (copy the stories "Run stories DB migrations" step body verbatim, replacing
          #  "npm","run","migrate:stories"  with  "npm","run","migrate:contact")
```

Implementer: open each workflow, copy the two stories steps in place, and swap only the script names + log text. Keep them AFTER the stories steps and BEFORE the service-update/deploy step.

- [ ] **Step 10: Run the guard test + full unit suite**

Run: `npx vitest run test/unit/dockerfile-scripts-shipped.test.ts test/unit/bootstrap-contact-url.test.ts`
Expected: PASS — the guard now sees `bootstrap:contact`/`migrate:contact` in the deploy workflows and confirms the Dockerfile COPYs `migrations-contact` + `scripts/bootstrap-contact-db.mjs`.

- [ ] **Step 11: Commit**

```bash
git add scripts/bootstrap-contact-db.mjs Dockerfile docker-compose.yml .github/workflows/pr.yml .github/workflows/deploy-staging.yml .github/workflows/deploy-prod.yml test/unit/dockerfile-scripts-shipped.test.ts test/unit/bootstrap-contact-url.test.ts
git commit -m "[TASK-NNN] contact inbox: DB provisioning (bootstrap, Dockerfile, CI, deploy)"
```

---

### Task 5: Public endpoint stores enquiries (retire the forward)

**Files:**
- Modify: `src/routes/api.ts:381-410` (the contact block)
- Modify: `src/app.ts` (ensure `/api/contact` parses form-urlencoded — mirror the My Story wiring)
- Modify: `contact.html:92-117` (honeypot field)
- Modify: `test/unit/contact-endpoint.test.ts`, `test/unit/contact.test.ts` (drop forward expectations)
- Modify: `features/contact.feature`

**Interfaces:**
- Consumes: `contactEnquirySchema` (Task 2), `insertEnquiry` (Task 3), `createRateLimiter` (`src/portal/request-limiter.ts`).
- Produces: `POST /api/contact` → `200 { status: "sent" }` on store; `400` invalid; `429` rate-limited; `500` on DB failure. Honeypot filled → `200 { status: "sent" }`, nothing stored.

- [ ] **Step 1: Read the current contact endpoint and its tests**

Read `src/routes/api.ts:381-410`, `test/unit/contact-endpoint.test.ts`, `test/unit/contact.test.ts`, and `features/contact.feature` to see exactly what asserts the forward behaviour (they reference `forwardEnquiry` / a 502 fallback).

- [ ] **Step 2: Write/adjust the failing endpoint test**

In `test/unit/contact-endpoint.test.ts`, replace forward-based expectations with store-based ones. Mock the DB layer, not the forward client:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertEnquiry = vi.fn();
vi.mock("../../src/db/contact", () => ({ insertEnquiry }));

import { postContact } from "../../src/routes/api";

function res() {
  const r: any = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

beforeEach(() => {
  insertEnquiry.mockReset();
});

const body = { firstName: "Ada", lastName: "L", email: "ada@example.com", message: "Hi" };

describe("postContact", () => {
  it("stores a valid enquiry and returns 200", async () => {
    insertEnquiry.mockResolvedValue({ id: 1 });
    const r = res();
    await postContact({ body, ip: "1.1.1.1" } as any, r);
    expect(insertEnquiry).toHaveBeenCalledWith(expect.objectContaining({ email: "ada@example.com" }));
    expect(r.status).toHaveBeenCalledWith(200);
  });

  it("rejects an invalid enquiry with 400 and does not store", async () => {
    const r = res();
    await postContact({ body: { ...body, email: "nope" }, ip: "1.1.1.1" } as any, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(insertEnquiry).not.toHaveBeenCalled();
  });

  it("silently drops a honeypot hit with 200 and does not store", async () => {
    const r = res();
    await postContact({ body: { ...body, company: "spam" }, ip: "1.1.1.1" } as any, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(insertEnquiry).not.toHaveBeenCalled();
  });

  it("returns 500 when the store fails", async () => {
    insertEnquiry.mockRejectedValue(new Error("db down"));
    const r = res();
    await postContact({ body, ip: "1.1.1.1" } as any, r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/unit/contact-endpoint.test.ts`
Expected: FAIL — `postContact` still forwards and has no honeypot/store branch.

- [ ] **Step 4: Rewrite the endpoint**

In `src/routes/api.ts`, replace the contact block (lines ~381-410). Remove the `forwardEnquiry` import at line 7. New code:

```ts
import { contactEnquirySchema } from "../contact/schema";
import { insertEnquiry } from "../db/contact";
import { createRateLimiter } from "../portal/request-limiter";

// Contact enquiry (2026-07-10 contact-inbox spec). Validates a website enquiry and STORES it in
// the isolated contact DB (no external forward). Honeypot + rate limit guard the public,
// unauthenticated endpoint; a filled honeypot is silently accepted (200) but never stored.
const contactLimiter = createRateLimiter({ max: 5, windowMs: 60_000 });

export async function postContact(req: Request, res: Response): Promise<Response> {
  // Honeypot: a real browser never fills the hidden `company` field. Pretend success, store nothing.
  if (typeof req.body?.company === "string" && req.body.company.trim() !== "") {
    return res.status(200).json({ status: "sent" });
  }

  const key = req.ip ?? "unknown";
  if (!contactLimiter.allow(key, Date.now())) {
    return res.status(429).json({ error: "Too many messages. Please try again shortly." });
  }

  const parsed = contactEnquirySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid contact request", details: parsed.error.flatten() });
  }

  try {
    await insertEnquiry(parsed.data);
    return res.status(200).json({ status: "sent" });
  } catch (err) {
    console.error("contact store failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Could not send your message right now" });
  }
}

apiRouter.post("/api/contact", postContact);
```

Place the `import` lines with the other imports at the top of the file (not inline). Delete the now-unused `import { forwardEnquiry } from "../clients/contact";` (line 7) and the old `contactBodySchema`.

- [ ] **Step 5: Ensure `/api/contact` parses form-urlencoded (no-JS submit)**

In `src/app.ts`, confirm a `express.urlencoded({ extended: false })` body parser applies to `/api/contact` (the form posts urlencoded when JS is off). If the My Story route added one (search `my-story` in `src/app.ts`), mirror that exact wiring for `/api/contact`. If a global `express.urlencoded` already runs before the API router, no change is needed — verify by reading `src/app.ts`.

- [ ] **Step 6: Add the honeypot field to the form**

In `contact.html`, inside the `<form id="contactForm">` (after the opening tag, line ~92), add a visually-hidden honeypot that real users never see or fill:

```html
                <div class="hp-field" aria-hidden="true">
                  <label for="company">Company</label>
                  <input id="company" name="company" type="text" tabindex="-1" autocomplete="off" />
                </div>
```

Confirm `.hp-field { position:absolute; left:-9999px; }` (or the existing off-screen utility used by the My Story honeypot) exists in `assets/css/styles.css`; if My Story added such a rule, reuse that class name instead of `hp-field`.

- [ ] **Step 7: Update the BDD feature**

In `features/contact.feature`, replace any scenario asserting forwarding/502-fallback with one asserting a valid submission returns success (stored). Keep the step wording consistent with the existing step defs in `features/steps/`; a valid POST to `/api/contact` responds 200 with `status: "sent"`, and an invalid one responds 400.

- [ ] **Step 8: Run endpoint + BDD tests**

Run: `npx vitest run test/unit/contact-endpoint.test.ts test/unit/contact.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: PASS (no dangling `forwardEnquiry` reference).

- [ ] **Step 9: Commit**

```bash
git add src/routes/api.ts src/app.ts contact.html features/contact.feature test/unit/contact-endpoint.test.ts test/unit/contact.test.ts
git commit -m "[TASK-NNN] contact inbox: store submissions, retire external forward"
```

---

### Task 6: Gmail reply URL builder (pure, tested)

**Files:**
- Create: `assets/js/gmail-reply.js`
- Test: `test/unit/gmail-reply.test.ts`

**Interfaces:**
- Produces: `buildGmailReplyUrl(enquiry: { email: string; first_name: string; last_name?: string; message: string; created_at: string | Date }): string` and `formatReceived(value): string`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/gmail-reply.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildGmailReplyUrl } from "../../assets/js/gmail-reply.js";

const enquiry = {
  email: "ada@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
  message: "Do you take item donations?",
  created_at: "2026-07-10T14:32:00.000Z",
};

describe("buildGmailReplyUrl", () => {
  const url = buildGmailReplyUrl(enquiry);

  it("targets Gmail web compose", () => {
    expect(url.startsWith("https://mail.google.com/mail/?view=cm&fs=1")).toBe(true);
  });

  it("addresses the sender", () => {
    expect(url).toContain("to=" + encodeURIComponent("ada@example.com"));
  });

  it("uses the fixed subject", () => {
    expect(url).toContain("su=" + encodeURIComponent("Re: your message to NBCC"));
  });

  it("quotes the original message and submission time in the body", () => {
    const body = decodeURIComponent(url.split("body=")[1]);
    expect(body).toContain("Do you take item donations?");
    expect(body).toContain("Ada Lovelace");
    expect(body).toContain("ada@example.com");
    expect(body).toMatch(/Received:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/gmail-reply.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the builder**

Create `assets/js/gmail-reply.js`:

```js
// Pure builder for a Gmail web-compose deep link that pre-fills a reply to a contact enquiry
// (2026-07-10 contact-inbox spec). No DOM, no network — unit-tested in test/unit/gmail-reply.test.js.
// Opening this URL in a new tab lands in whichever Gmail account the staff member is signed into
// (e.g. info@nbcc.scot). We cannot detect the actual send; the caller marks the enquiry Replied.

export function formatReceived(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  // e.g. "10 July 2026, 15:32" — human, unambiguous, local time.
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildGmailReplyUrl(enquiry) {
  const name = [enquiry.first_name, enquiry.last_name].filter(Boolean).join(" ").trim();
  const received = formatReceived(enquiry.created_at);
  const subject = "Re: your message to NBCC";
  const body =
    "\n\n\n----- Original message -----\n" +
    "Received: " + received + "\n" +
    "From: " + name + " <" + enquiry.email + ">\n\n" +
    (enquiry.message || "");
  return (
    "https://mail.google.com/mail/?view=cm&fs=1" +
    "&to=" + encodeURIComponent(enquiry.email) +
    "&su=" + encodeURIComponent(subject) +
    "&body=" + encodeURIComponent(body)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/gmail-reply.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add assets/js/gmail-reply.js test/unit/gmail-reply.test.ts
git commit -m "[TASK-NNN] contact inbox: Gmail reply URL builder"
```

---

### Task 7: Admin API routes

**Files:**
- Modify: `src/routes/admin.ts` (add after the stories routes, ~line 1011)
- Test: `test/unit/admin-contact-routes.test.ts`

**Interfaces:**
- Consumes: `listEnquiries`, `getEnquiry`, `markReplied`, `deleteEnquiry` (Task 3); `authorizeAdmin` (already in `admin.ts`).
- Produces:
  - `GET /api/admin/contact?status=` — Viewer+ → `{ results: ContactRow[] }`.
  - `GET /api/admin/contact/:id` — Viewer+ → `ContactRow` or 404.
  - `PATCH /api/admin/contact/:id` — Editor+ — body `{ status: 'new' | 'replied' }` → updated row or 404.
  - `DELETE /api/admin/contact/:id` — Editor+ → `{ deleted: true, id }` or 404.

- [ ] **Step 1: Write the failing route test**

Create `test/unit/admin-contact-routes.test.ts`. Mock the DB module and the auth helper the same way the existing admin route tests do (read an existing `test/unit/admin-*.test.ts` first to match the `authorizeAdmin` mock shape). Skeleton:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const listEnquiries = vi.fn();
const getEnquiry = vi.fn();
const markReplied = vi.fn();
const deleteEnquiry = vi.fn();
vi.mock("../../src/db/contact", () => ({ listEnquiries, getEnquiry, markReplied, deleteEnquiry }));

// authorizeAdmin is imported by admin.ts; mock it to allow (return true) by default.
// Match the exact module path/spelling used by the existing admin route unit tests.
vi.mock("../../src/routes/admin-auth", () => ({ authorizeAdmin: () => true }));

import { getAdminContact, getAdminContactItem, patchAdminContact, deleteAdminContact } from "../../src/routes/admin";

function res() {
  const r: any = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

beforeEach(() => {
  [listEnquiries, getEnquiry, markReplied, deleteEnquiry].forEach((m) => m.mockReset());
});

describe("admin contact routes", () => {
  it("lists newest-first with optional status", async () => {
    listEnquiries.mockResolvedValue([{ id: 1 }]);
    const r = res();
    await getAdminContact({ query: { status: "new" } } as any, r);
    expect(listEnquiries).toHaveBeenCalledWith("new");
    expect(r.status).toHaveBeenCalledWith(200);
  });

  it("404s a missing item", async () => {
    getEnquiry.mockResolvedValue(null);
    const r = res();
    await getAdminContactItem({ params: { id: "9" } } as any, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });

  it("marks replied via PATCH", async () => {
    markReplied.mockResolvedValue({ id: 1, status: "replied" });
    const r = res();
    await patchAdminContact({ params: { id: "1" }, body: { status: "replied" } } as any, r);
    expect(markReplied).toHaveBeenCalledWith(1, true);
    expect(r.status).toHaveBeenCalledWith(200);
  });

  it("rejects a bad PATCH status with 400", async () => {
    const r = res();
    await patchAdminContact({ params: { id: "1" }, body: { status: "bogus" } } as any, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(markReplied).not.toHaveBeenCalled();
  });

  it("deletes an item", async () => {
    deleteEnquiry.mockResolvedValue(true);
    const r = res();
    await deleteAdminContact({ params: { id: "1" } } as any, r);
    expect(deleteEnquiry).toHaveBeenCalledWith(1);
    expect(r.status).toHaveBeenCalledWith(200);
  });
});
```

Note for implementer: confirm the real `authorizeAdmin` import path/spelling in `admin.ts` and mock that exact module. If `authorizeAdmin` is a local function in `admin.ts` (not a separate module), instead inject an authenticated request shape the way the existing admin route tests do — mirror an existing `test/unit/admin-*.test.ts` precisely rather than guessing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/admin-contact-routes.test.ts`
Expected: FAIL — the handlers don't exist yet.

- [ ] **Step 3: Add the routes**

In `src/routes/admin.ts`, after the stories routes (line ~1011), add — mirroring the stories handlers' structure (`authorizeAdmin` gate, `storyId`-style id parse, try/catch with `console.error`):

```ts
// --- Admin Contact inbox (2026-07-10 spec): list/view/reply-status/delete contact enquiries -------
// Reads/writes go to the SEPARATE contact DB only (src/db/contact, contactPool) — never
// src/db/pool.ts / the charity DB, never the stories DB, never audit_log. Browsing is Viewer+;
// marking replied / deleting is an Editor+ write (mirrors the stories routes).

function contactId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid enquiry id" });
    return null;
  }
  return id;
}

export async function getAdminContact(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "viewer")) return;
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    return res.status(200).json({ results: await listEnquiries(status) });
  } catch (err) {
    console.error("admin contact list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

export async function getAdminContactItem(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "viewer")) return;
  const id = contactId(req, res);
  if (id == null) return;
  try {
    const row = await getEnquiry(id);
    if (!row) return res.status(404).json({ error: "Enquiry not found" });
    return res.status(200).json(row);
  } catch (err) {
    console.error("admin contact read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

const contactPatchSchema = z.object({ status: z.enum(["new", "replied"]) }).strict();

export async function patchAdminContact(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  const id = contactId(req, res);
  if (id == null) return;
  const parsed = contactPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid enquiry update", details: parsed.error.flatten() });
  }
  try {
    const row = await markReplied(id, parsed.data.status === "replied");
    if (!row) return res.status(404).json({ error: "Enquiry not found" });
    return res.status(200).json(row);
  } catch (err) {
    console.error("admin contact update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}

export async function deleteAdminContact(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  const id = contactId(req, res);
  if (id == null) return;
  try {
    const deleted = await deleteEnquiry(id);
    if (!deleted) return res.status(404).json({ error: "Enquiry not found" });
    return res.status(200).json({ deleted: true, id });
  } catch (err) {
    console.error("admin contact delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin delete is temporarily unavailable" });
  }
}

adminRouter.get("/api/admin/contact", getAdminContact);
adminRouter.get("/api/admin/contact/:id", getAdminContactItem);
adminRouter.patch("/api/admin/contact/:id", patchAdminContact);
adminRouter.delete("/api/admin/contact/:id", deleteAdminContact);
```

Add the import at the top of `admin.ts` (next to the stories import ~line 27):

```ts
import { listEnquiries, getEnquiry, markReplied, deleteEnquiry } from "../db/contact";
```

- [ ] **Step 4: Run test + build**

Run: `npx vitest run test/unit/admin-contact-routes.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts test/unit/admin-contact-routes.test.ts
git commit -m "[TASK-NNN] contact inbox: admin API routes"
```

---

### Task 8: Admin tab UI + honest-save form + README

**Files:**
- Modify: `admin.html` (nav link + `#view-contact` + `#view-contact-detail`, mirror the stories markup at lines 61 / 168-189)
- Modify: `assets/js/app.js` (add `loadContact` + detail/reply/delete/filter, mirror the stories view controller)
- Modify: `assets/js/main.js:405-527` (`initContactForm` honest-save)
- Modify: `README.md`
- Test: `test/unit/contact.test.ts` (honest-save behaviour under jsdom, if it exists; otherwise add jsdom coverage mirroring the story-form test)

**Interfaces:**
- Consumes: `GET/PATCH/DELETE /api/admin/contact*` (Task 7); `buildGmailReplyUrl` (Task 6).

**Design note:** this tab REUSES the existing admin components (`.admin-view`, `.admin-table-wrap`, `.admin-segmented`, the detail/back pattern) exactly as the Stories tab does — no new visual system, no new CSS beyond what those classes already provide. Keep it visually identical to the Stories tab so the panel stays consistent.

- [ ] **Step 1: Add the nav link + views to admin.html**

In `admin.html`, add a nav item next to the Stories one (line 61):

```html
              <li><button class="admin-nav-link" type="button" data-view="contact">Contact form</button></li>
```

After the story detail section (line ~189), add:

```html
            <!-- Contact form: public enquiries from the isolated contact database (2026-07-10 spec). -->
            <section class="admin-view" id="view-contact" aria-labelledby="contact-heading" hidden>
              <h2 id="contact-heading">Contact form</h2>
              <p class="admin-view-intro">Messages sent through the public contact form. Open one to read it, reply in Gmail (which marks it Replied), or delete it. These live in their own database, separate from donor and story data.</p>
              <div class="admin-segmented" role="group" aria-label="Filter by status" id="contactStatusFilter">
                <button type="button" class="is-active" data-status="">New &amp; replied</button>
                <button type="button" data-status="new">New</button>
                <button type="button" data-status="replied">Replied</button>
              </div>
              <div class="admin-table-wrap" id="contactTable" aria-live="polite"><p class="admin-loading">Loading…</p></div>
            </section>

            <section class="admin-view" id="view-contact-detail" aria-labelledby="contact-detail-heading" hidden>
              <button class="admin-back" id="contactBack" type="button">&larr; Back</button>
              <h2 id="contact-detail-heading">Enquiry</h2>
              <div id="contactDetail" aria-live="polite"></div>
              <p class="admin-action-status" id="contactActionStatus" role="status" aria-live="polite"></p>
            </section>
```

Match the exact class names / segmented-control markup the Stories view uses (read lines 168-189 first and mirror them; adjust the above if the Stories segmented control differs).

- [ ] **Step 2: Add the view controller to app.js**

Read how `app.js` registers the `stories` view (its `data-view` switch, `loadStories`, the row-click → detail, the status filter, and the action-status helper), then add a parallel `contact` implementation:
- `loadContact(status)` → `GET /api/admin/contact?status=` → render a table into `#contactTable`: columns **Received** (`formatReceived(created_at)`), **Name** (`first_name last_name`), **Email**, **Status** badge (New/Replied), and a message snippet (first ~80 chars). Each row opens the detail view for that id.
- Detail view: `GET /api/admin/contact/:id` → render sender, email, full received timestamp, full message into `#contactDetail`, plus two buttons: **Reply in Gmail** and **Delete**.
- **Reply in Gmail**: `import { buildGmailReplyUrl } from "./gmail-reply.js"` at the top of `app.js`; on click `window.open(buildGmailReplyUrl(row), "_blank", "noopener")` AND `PATCH /api/admin/contact/:id` with `{ status: "replied" }`, then refresh the detail/list and show "Marked as replied" in `#contactActionStatus`. (If `app.js` is a classic script, not a module, expose `buildGmailReplyUrl` the same way other shared helpers are shared there instead of `import`.)
- **Delete**: confirm, then `DELETE /api/admin/contact/:id`, return to the list.
- Status filter `#contactStatusFilter`: clicking a segment reloads `loadContact(status)` and toggles `.is-active`.
- Wire `loadContact("")` into the same view-switch that Stories uses when `data-view="contact"` is selected.

Keep all fetches credentialed exactly as the other admin calls (same auth header/session mechanism `app.js` already uses).

- [ ] **Step 3: Honest-save the public form**

In `assets/js/main.js`, rewrite `initContactForm`'s submit flow (lines 485-526) so success shows ONLY on a 200. Replace the "show success immediately + best-effort deliver + mailFallback" logic with an await-then-report flow, and remove `deliver`/`mailFallback`:

```js
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var firstBad = null;
      var allOk = true;
      fields.forEach(function (f) {
        var ok = validateField(f);
        if (!ok) {
          allOk = false;
          if (!firstBad) firstBad = doc.getElementById(f.id);
        }
      });

      if (!allOk) {
        if (status) { status.textContent = ""; status.className = "form-status"; }
        if (firstBad && firstBad.focus) firstBad.focus();
        return;
      }

      var payload = {
        firstName: value("firstName"),
        lastName: value("lastName"),
        email: value("email"),
        message: value("message"),
      };

      if (typeof win.fetch !== "function") return; // no-JS/preview: native POST handles it

      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      if (status) { status.textContent = "Sending…"; status.className = "form-status"; }

      win
        .fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        .then(function (res) {
          if (res && res.ok) {
            if (status) {
              status.textContent =
                "Thank you " + payload.firstName +
                ", your message has reached the NBCC inbox. We will be in touch soon.";
              status.className = "form-status is-success";
            }
            form.reset();
            clearErrors();
          } else {
            if (status) {
              status.textContent =
                "Sorry, we could not send your message just now. Please try again, or email info@nbcc.scot.";
              status.className = "form-status is-error";
            }
          }
        })
        .catch(function () {
          if (status) {
            status.textContent =
              "Sorry, we could not send your message just now. Please try again, or email info@nbcc.scot.";
            status.className = "form-status is-error";
          }
        })
        .then(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
```

(The message is preserved on error because `form.reset()` only runs on success.) Ensure a `.form-status.is-error` style exists in `assets/css/styles.css`; if not, add a minimal rule mirroring `.is-success`.

- [ ] **Step 4: Update the form-behaviour test**

If `test/unit/contact.test.ts` drives `initContactForm` under jsdom asserting the old immediate-success behaviour, update it: mock `win.fetch` to resolve `{ ok: true }` → success message shown + form reset; resolve `{ ok: false }` → error message shown + message field still populated. Run:

Run: `npx vitest run test/unit/contact.test.ts`
Expected: PASS.

- [ ] **Step 5: Update README**

In `README.md`, reflect: the new `CONTACT_DATABASE_URL` config; the `contact` database + `migrate:contact` / `bootstrap:contact` scripts; that `/api/contact` now stores enquiries (external forward retired); the new `/api/admin/contact*` routes; and the Contact form admin tab. Update the config table, the commands list, the routes/behaviour section, and the admin-panel description — wherever the equivalent My Story / Stories entries live.

- [ ] **Step 6: Full local gate**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add admin.html assets/js/app.js assets/js/main.js README.md test/unit/contact.test.ts
git commit -m "[TASK-NNN] contact inbox: admin tab, Gmail reply, honest-save form, README"
```

---

## Self-Review

**Spec coverage:**
- Dedicated isolated DB + login → Tasks 1, 3, 4. ✅
- `contact_enquiries` table (exact columns + status CHECK) → Task 3. ✅
- Retire external forward → Task 5. ✅
- Honeypot + rate limit + dual content-type + honest-save → Tasks 5, 8. ✅
- Gmail reply (prefilled, date/time) + marks Replied → Tasks 6, 7, 8. ✅
- Admin tab in the existing panel (Viewer read / Editor write) → Tasks 7, 8. ✅
- Config golden-rule-3 touch-points (schema, .env.example, SSM, task-def secret, IAM, pr.yml env) → Task 1 (app) + **infra sub-steps below**. ⚠️ see note.
- Dockerfile COPY guard → Task 4. ✅
- README → Task 8. ✅
- Tests (unit: schema, gmail, bootstrap-url, config, endpoint, admin routes; BDD; guard) → all tasks. ✅

**Gap found & closed — infra (SSM + task-def + IAM).** The plan references `infra/modules/app/main.tf` and `ecs.tf` in the file map and Global Constraints but no task performs those edits. Add them to **Task 4** as steps between the bootstrap script and the CI wiring:

- [ ] **Task 4, Step 6a: SSM parameter (`infra/modules/app/main.tf`).** Copy the `random_password.stories` + `aws_ssm_parameter.stories_db_url` resources to `contact` equivalents (`random_password.contact`, `aws_ssm_parameter.contact_db_url`), assembling the URL with `sslmode=no-verify` exactly as the stories param does (same host/db-name assembly, `contact`/`contact_app`).
- [ ] **Task 4, Step 6b: task-def secret + IAM (`infra/modules/app/ecs.tf`).** Add a `CONTACT_DATABASE_URL` entry to the task-def `secrets` block next to `STORIES_DATABASE_URL`, AND add the new SSM param's ARN to the `exec_secrets` IAM policy resource list (the three-places gotcha from CLAUDE.md — SSM param + task-def secret + IAM, or the task won't start).

These are infra-only edits; they're validated by the `infra.yml` plan on the PR and applied via the Infra workflow at deploy time (`/ship` applies staging infra when the diff touches `infra/`). Group the commit with Task 4 or as its own `[TASK-NNN] contact inbox: infra (SSM param, task-def secret, IAM)` commit.

**Placeholder scan:** No TBD/TODO. The two deploy-workflow steps (Task 4 Step 9) and the compose entries (Step 7) are described as "copy the stories step, swap the script name" rather than pasted verbatim — acceptable because the source is an exact, named, in-repo block the implementer copies mechanically; every other code step shows full code.

**Type consistency:** `ContactRow` (Task 3) is consumed unchanged by Tasks 7/8; `buildGmailReplyUrl` expects `{ email, first_name, last_name?, message, created_at }` — matches `ContactRow`. `markReplied(id, replied: boolean)` is called as `markReplied(id, true)` in Task 7. Endpoint returns `{ status: "sent" }`; the form checks `res.ok`. Consistent. ✅

## Notes for the executor

- **Task order matters for interfaces:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Task 5 needs 2+3; Task 7 needs 3; Task 8 needs 6+7.
- **`authorizeAdmin` shape:** before writing Tasks 7/8 tests, read an existing `test/unit/admin-*.test.ts` to copy the exact auth-mock/request shape — do not guess the module path.
- **`app.js` module vs classic script:** Task 8 assumes ES-module `import`. If `assets/js/app.js` is a classic script, share `buildGmailReplyUrl` via the same mechanism the file already uses for shared helpers, and load `gmail-reply.js` accordingly. Verify before implementing.
- **Out of scope (do not do):** removing `CONTACT_FORWARD_URL` / `src/clients/contact.ts`; tags/notes; attachments; Gmail-API send detection.
```
