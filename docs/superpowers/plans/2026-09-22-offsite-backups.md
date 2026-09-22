# Off-site backups (TASK-423) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A nightly, encrypted, verified copy of every piece of data NBCC holds, in two places: a write-once store inside AWS for fast restores and the seven-year HMRC requirement, and Google Drive so it survives losing the AWS account.

**Architecture:** A one-off Fargate task on an EventBridge schedule, reusing the pattern already proven by the nightly reminders job (`infra/modules/app/scheduler.tf`). The task dumps all three databases, writes per-table CSVs, bundles the repo, builds a manifest, encrypts the lot with 7-Zip AES-256, puts it in S3 with Object Lock, and uploads it to Drive. Orchestration is pure and unit-tested; the script only wires real seams.

**Tech Stack:** Node 20, TypeScript, Postgres 16, `pg_dump` 16 from PGDG, p7zip, AWS S3 Object Lock, EventBridge Scheduler, Google Drive REST API via a service-account JWT (no new npm dependency).

---

## Non-negotiable facts discovered during design

These are the things that silently break this feature. Every one was found by checking, not assuming.

1. **There are THREE databases, not one.** `DATABASE_URL` (42 tables), `STORIES_DATABASE_URL` (`stories`), `CONTACT_DATABASE_URL` (`contact_enquiries`). A `pg_dump` of `DATABASE_URL` alone silently omits every public "My Story" submission and every contact enquiry — two of the datasets the owner explicitly named. **44 tables total.**
2. **`pg_dump` must be >= the server major version.** RDS is Postgres 16. `node:20-slim` is Debian bookworm, whose `postgresql-client` is 15 and which *refuses* to dump a 16 server. Install `postgresql-client-16` from the PGDG apt repo.
3. **The runtime image has no devDependencies and no `tsx`.** It is `npm ci --omit=dev` and copies only `dist/`. Scripts live in `src/scripts/` so `tsc` emits them, and run as `node dist/scripts/x.js`. Any library used at runtime must be a real dependency.
4. **Uploaded files are already inside Postgres.** `newsletter_images.bytes` and `newsletter_attachments.bytes` are `bytea`. No separate object store to back up.
5. **A service account has no Drive storage quota of its own.** Uploading into a shared My Drive folder fails. Either target a Shared Drive (Business Standard+) or impersonate a real user via domain-wide delegation. Support both; a config value picks.

---

## File structure

| File | Responsibility |
|---|---|
| `src/backup/manifest.ts` | Pure. Builds and validates the manifest; decides pass/fail on shrinkage. No I/O. |
| `src/backup/plan.ts` | Pure. Declares the three databases and what a complete backup must contain. The single source of truth for "everything". |
| `src/clients/google-drive.ts` | Service-account JWT, access token, resumable upload, old-file pruning. |
| `src/scripts/run-backup.ts` | Wiring only: real pools, real `pg_dump`, real S3, real Drive. |
| `src/config/schema.ts` | Modify: new config keys. |
| `test/unit/backup-manifest.test.ts` | Manifest and shrinkage rules. DB-free. |
| `test/unit/backup-plan.test.ts` | **Guards fact 1**: asserts the plan covers all three databases and every migration directory. |
| `test/unit/google-drive-jwt.test.ts` | JWT assembly and signing. DB-free. |
| `infra/modules/app/backups.tf` | S3 bucket, Object Lock, lifecycle, SSM params, IAM, schedule. |
| `Dockerfile` | Modify: `postgresql-client-16`, `p7zip-full`. |

---

### Task 1: Lock down "everything" so it cannot silently shrink

The defect this prevents is the whole reason the feature exists: a backup that looks fine and omits a database. The test reads the migration directories from disk, so adding a fourth database without adding it to the backup fails the build.

**Files:**
- Create: `src/backup/plan.ts`
- Test: `test/unit/backup-plan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKUP_DATABASES, expectedTableCount } from "../../src/backup/plan";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// The failure this guards: someone adds a fourth database (as stories and contact already were)
// and the backup keeps passing while silently omitting it. The list of migration directories on
// disk is the truth; the backup plan must cover all of them.
describe("the backup plan covers every database that exists", () => {
  it("names all three databases", () => {
    expect(BACKUP_DATABASES.map((d) => d.configKey).sort()).toEqual([
      "CONTACT_DATABASE_URL",
      "DATABASE_URL",
      "STORIES_DATABASE_URL",
    ]);
  });

  it("has no migration directory it does not back up", () => {
    const dirs = readdirSync(ROOT)
      .filter((n) => n === "migrations" || n.startsWith("migrations-"))
      .filter((n) => existsSync(resolve(ROOT, n)));
    const covered = BACKUP_DATABASES.map((d) => d.migrationsDir).sort();
    expect(covered).toEqual(dirs.sort());
  });

  // A dump that produced 3 tables when 44 exist should fail loudly, not upload.
  it("knows how many tables to expect, counted from the migrations themselves", () => {
    expect(expectedTableCount()).toBe(44);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/backup-plan.test.ts`
Expected: FAIL, `Cannot find module '../../src/backup/plan'`

- [ ] **Step 3: Write the implementation**

```ts
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// TASK-423. The single source of truth for what "everything" means.
//
// NBCC does not have one database, it has three: the main charity database, and two deliberately
// isolated ones so that the public story form and the contact form can never read or write donor
// data (see STORIES_DATABASE_URL / CONTACT_DATABASE_URL in src/config/schema.ts). A pg_dump of
// DATABASE_URL alone therefore misses every My Story submission and every contact enquiry, which
// are two of the datasets most obviously worth keeping. Adding a database here is what makes it
// get backed up; test/unit/backup-plan.test.ts fails if one exists that this file does not name.
export type BackupDatabase = {
  /** The config key holding its connection string. */
  configKey: "DATABASE_URL" | "STORIES_DATABASE_URL" | "CONTACT_DATABASE_URL";
  /** Directory name inside the archive, and the migrations dir that proves it exists. */
  migrationsDir: string;
  label: string;
};

export const BACKUP_DATABASES: BackupDatabase[] = [
  { configKey: "DATABASE_URL", migrationsDir: "migrations", label: "main" },
  { configKey: "STORIES_DATABASE_URL", migrationsDir: "migrations-stories", label: "stories" },
  { configKey: "CONTACT_DATABASE_URL", migrationsDir: "migrations-contact", label: "contact" },
];

/** Every table name a database's migrations create, read from the migrations themselves. */
export function tablesIn(root: string, migrationsDir: string): string[] {
  const dir = resolve(root, migrationsDir);
  if (!existsSync(dir)) return [];
  const tables = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = readFileSync(resolve(dir, f), "utf8");
    for (const m of src.matchAll(/createTable\(\s*["'`]([a-z_]+)["'`]/g)) tables.add(m[1]);
  }
  return [...tables].sort();
}

export function expectedTableCount(root = resolve(__dirname, "../..")): number {
  return BACKUP_DATABASES.reduce((n, db) => n + tablesIn(root, db.migrationsDir).length, 0);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/unit/backup-plan.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/backup/plan.ts test/unit/backup-plan.test.ts
git commit -m "[TASK-423] Name all three databases, so a backup cannot quietly omit one"
```

---

### Task 2: The manifest, and the shrinkage rule that catches a bad backup

**Files:**
- Create: `src/backup/manifest.ts`
- Test: `test/unit/backup-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildManifest, verifyAgainstPrevious, type Manifest } from "../../src/backup/manifest";

const base: Manifest = {
  takenAt: "2026-09-22T02:00:00.000Z",
  commit: "abc1234",
  databases: [
    { label: "main", tables: { donors: 120, donations: 340 }, dumpBytes: 900_000 },
    { label: "stories", tables: { stories: 12 }, dumpBytes: 4_000 },
    { label: "contact", tables: { contact_enquiries: 30 }, dumpBytes: 6_000 },
  ],
  archiveBytes: 500_000,
  tableCount: 4,
};

describe("the manifest says what was actually captured", () => {
  it("totals rows across every database, not just the main one", () => {
    const m = buildManifest({ takenAt: base.takenAt, commit: "abc1234", databases: base.databases, archiveBytes: 500_000 });
    expect(m.tableCount).toBe(4);
    expect(m.databases).toHaveLength(3);
  });
});

describe("a backup that suddenly shrank is a failure, not a success", () => {
  it("passes when the archive is stable or growing", () => {
    expect(verifyAgainstPrevious(base, { ...base, archiveBytes: 520_000 }).ok).toBe(true);
  });

  // The real failure mode: a dump that errored halfway still produces a file, just a small one.
  it("fails when the archive loses more than a quarter of its size", () => {
    const r = verifyAgainstPrevious({ ...base, archiveBytes: 300_000 }, base);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/smaller/i);
  });

  it("fails when a whole database has vanished from the manifest", () => {
    const missing = { ...base, databases: base.databases.slice(0, 1) };
    const r = verifyAgainstPrevious(missing, base);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/stories|contact|databases/i);
  });

  it("has nothing to compare against on the very first run, and says so rather than failing", () => {
    expect(verifyAgainstPrevious(base, null).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/backup-manifest.test.ts`
Expected: FAIL, cannot find module

- [ ] **Step 3: Write the implementation**

```ts
// TASK-423. The manifest is what turns "a file appeared" into "a backup happened". It records what
// was captured so a restore can be checked against it, and so the next run can notice a collapse.
export type DatabaseManifest = {
  label: string;
  tables: Record<string, number>;
  dumpBytes: number;
};

export type Manifest = {
  takenAt: string;
  commit: string;
  databases: DatabaseManifest[];
  archiveBytes: number;
  tableCount: number;
};

export function buildManifest(input: Omit<Manifest, "tableCount">): Manifest {
  const tableCount = input.databases.reduce((n, d) => n + Object.keys(d.tables).length, 0);
  return { ...input, tableCount };
}

/**
 * Compare a fresh manifest with the previous one. The failure this exists for is the half-finished
 * dump: pg_dump dies partway, the archive is still written, and a smaller file replaces a good one
 * night after night until the only copies left are broken. Size alone is a crude signal, so a
 * missing database is checked separately and explicitly.
 */
export function verifyAgainstPrevious(
  now: Manifest,
  previous: Manifest | null,
): { ok: true } | { ok: false; reason: string } {
  if (!previous) return { ok: true }; // first ever run: nothing to compare with

  const before = new Set(previous.databases.map((d) => d.label));
  const after = new Set(now.databases.map((d) => d.label));
  const lost = [...before].filter((l) => !after.has(l));
  if (lost.length) {
    return { ok: false, reason: `databases missing from this backup: ${lost.join(", ")}` };
  }

  // A quarter is deliberately loose. Real data does shrink (an erasure request, a purged queue),
  // and an alert that cries wolf gets ignored, which is worse than no alert.
  if (now.archiveBytes < previous.archiveBytes * 0.75) {
    return {
      ok: false,
      reason: `archive is ${now.archiveBytes} bytes, materially smaller than the previous ${previous.archiveBytes}`,
    };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/unit/backup-manifest.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/backup/manifest.ts test/unit/backup-manifest.test.ts
git commit -m "[TASK-423] Manifest, and treat a shrunken archive as a failed backup"
```

---

### Task 3: Google Drive upload with a service-account JWT

No new npm dependency: a service-account token is a signed JWT, and Node's `crypto` signs RS256.

**Files:**
- Create: `src/clients/google-drive.ts`
- Test: `test/unit/google-drive-jwt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createSign, generateKeyPairSync, createVerify } from "node:crypto";
import { buildAssertion } from "../../src/clients/google-drive";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

describe("the Drive access-token assertion", () => {
  const at = Date.parse("2026-09-22T02:00:00.000Z");

  it("is signed so Google can verify it with the public key", () => {
    const jwt = buildAssertion({ clientEmail: "b@x.iam.gserviceaccount.com", privateKeyPem: pem, now: at });
    const [h, p, s] = jwt.split(".");
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    expect(v.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("asks only for the narrow drive.file scope, not full Drive access", () => {
    const jwt = buildAssertion({ clientEmail: "b@x.iam.gserviceaccount.com", privateKeyPem: pem, now: at });
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive.file");
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
  });

  // Fact 5: on a Workspace edition without Shared Drives, the service account must act AS a real
  // user or the upload fails on quota. That is the `sub` claim, and it must only appear when asked.
  it("impersonates a user only when one is configured", () => {
    const withUser = buildAssertion({ clientEmail: "b@x.iam.gserviceaccount.com", privateKeyPem: pem, now: at, impersonate: "backups@nbcc.scot" });
    expect(JSON.parse(Buffer.from(withUser.split(".")[1], "base64url").toString()).sub).toBe("backups@nbcc.scot");

    const without = buildAssertion({ clientEmail: "b@x.iam.gserviceaccount.com", privateKeyPem: pem, now: at });
    expect(JSON.parse(Buffer.from(without.split(".")[1], "base64url").toString()).sub).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/google-drive-jwt.test.ts`
Expected: FAIL, cannot find module

- [ ] **Step 3: Write the implementation**

```ts
import { createSign } from "node:crypto";

// TASK-423. Google Drive upload for the nightly backup, over the REST API with a service-account
// JWT. Deliberately no googleapis dependency: the runtime image is `npm ci --omit=dev`, and a
// signed assertion is thirty lines of node:crypto.
//
// Scope is drive.file, NOT drive: it grants access only to files this service account itself
// created, so a leaked key cannot read the rest of the Drive.
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function buildAssertion(opts: {
  clientEmail: string;
  privateKeyPem: string;
  now: number;
  /**
   * The user to act as. Required when the target is an ordinary Drive folder: a service account
   * has no storage quota of its own, so an upload it owns is rejected. Omitted when the target is
   * a Shared Drive, which owns the files itself.
   */
  impersonate?: string;
}): string {
  const iat = Math.floor(opts.now / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims: Record<string, unknown> = {
    iss: opts.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  if (opts.impersonate) claims.sub = opts.impersonate;

  const signingInput = `${b64(header)}.${b64(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  return `${signingInput}.${signer.sign(opts.privateKeyPem, "base64url")}`;
}
```

Then the token exchange and upload, in the same file:

```ts
export async function getAccessToken(opts: Parameters<typeof buildAssertion>[0]): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(opts),
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token as string;
}

/** Multipart upload of a single file into a folder. Returns the new file id. */
export async function uploadFile(opts: {
  accessToken: string;
  folderId: string;
  name: string;
  body: Buffer;
  /** true when folderId is a Shared Drive or lives in one. */
  sharedDrive: boolean;
}): Promise<string> {
  const boundary = `nbcc${Date.now()}`;
  const metadata = JSON.stringify({ name: opts.name, parents: [opts.folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    opts.body,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  if (opts.sharedDrive) url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id as string;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/unit/google-drive-jwt.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/clients/google-drive.ts test/unit/google-drive-jwt.test.ts
git commit -m "[TASK-423] Drive upload via a service-account JWT, no new dependency"
```

---

### Task 4: Config keys

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add the keys to `src/config/schema.ts`**

```ts
  // --- Nightly off-site backup (TASK-423) -----------------------------------
  // Empty BACKUP_S3_BUCKET disables the whole job, which is what local and CI want: a dev machine
  // must never write to the production backup store.
  BACKUP_S3_BUCKET: z.string().default(""),
  BACKUP_ARCHIVE_PASSPHRASE: z.string().default(""),
  // The Drive destination. GOOGLE_DRIVE_IMPERSONATE is set only when the folder is an ordinary
  // My Drive folder, where a service account has no quota of its own and must act as a real user.
  // Left empty when the folder is a Shared Drive, which owns its files. See docs spec, fact 5.
  GOOGLE_DRIVE_FOLDER_ID: z.string().default(""),
  GOOGLE_DRIVE_SHARED_DRIVE: z.coerce.boolean().default(false),
  GOOGLE_DRIVE_IMPERSONATE: z.string().default(""),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().default(""),
  BACKUP_ALERT_EMAIL: z.string().default("mylittlespartan@googlemail.com"),
```

- [ ] **Step 2: Mirror them in `.env.example`** with the same comments and empty values.

- [ ] **Step 3: Verify nothing broke**

Run: `npm run lint && npm run build && npx vitest run test/unit/config*.test.ts`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/config/schema.ts .env.example
git commit -m "[TASK-423] Config for the backup destination and archive passphrase"
```

---

### Task 5: `pg_dump` 16 and 7-Zip in the runtime image

**Files:**
- Modify: `Dockerfile` (runtime stage only)

- [ ] **Step 1: Add to the runtime stage, after `FROM node:20-slim AS runtime`**

```dockerfile
# TASK-423: the nightly backup needs pg_dump and 7z.
#
# pg_dump MUST be at least the server's major version. RDS runs Postgres 16; Debian bookworm ships
# postgresql-client 15, which REFUSES to dump a 16 server ("server version mismatch"). So this comes
# from the PostgreSQL project's own apt repo, not Debian's. If RDS is ever moved to 17 this breaks,
# and the backup failure alert is what catches it.
#
# p7zip gives AES-256 with encrypted headers (-mhe=on). Chosen over a bespoke encrypted blob so the
# charity can open a backup with 7-Zip and a password, without needing a developer or this codebase.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg p7zip-full \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Prove the versions are right inside the image**

```bash
docker build -t nbcc-backup-check . \
  && docker run --rm nbcc-backup-check sh -c 'pg_dump --version && 7z i | head -3'
```

Expected: `pg_dump (PostgreSQL) 16.x` and 7-Zip output. **If pg_dump reports 15, the PGDG repo line did not take effect — fix before continuing, because this fails only against the real server, never locally.**

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "[TASK-423] pg_dump 16 from PGDG and 7z in the runtime image"
```

---

### Task 6: The backup script

**Files:**
- Create: `src/scripts/run-backup.ts`
- Modify: `package.json` (add `"backup": "node dist/scripts/run-backup.js"`)

- [ ] **Step 1: Write the script.** It must, in order:

1. Refuse to run if `BACKUP_S3_BUCKET` or `BACKUP_ARCHIVE_PASSPHRASE` is empty — a silent no-op backup is the worst outcome.
2. For each of `BACKUP_DATABASES`: `pg_dump -Fc` to `work/<label>.dump`, and a `COPY ... TO STDOUT WITH CSV HEADER` per table to `work/<label>/<table>.csv`.
3. `git bundle create work/website.bundle --all` (or, in the container, archive the deployed commit) so the site itself is recoverable, not only its data.
4. Count rows per table, build the manifest, write `work/manifest.json`.
5. **Assert the table count equals `expectedTableCount()`.** Abort before upload if not.
6. `7z a -p<passphrase> -mhe=on archive.7z work/` .
7. `verifyAgainstPrevious` against the previous manifest from S3. Abort and alert on failure.
8. Put to S3 (Object Lock applies automatically via the bucket default).
9. Upload to Drive; prune beyond 30 daily and 12 monthly.
10. Email the alert address on any failure; email the monthly health summary on the 1st.

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run lint && npm run build && ls dist/scripts/run-backup.js`
Expected: file exists

- [ ] **Step 3: Commit**

```bash
git add src/scripts/run-backup.ts package.json
git commit -m "[TASK-423] The nightly backup run: dump, bundle, manifest, encrypt, ship"
```

---

### Task 7: Infrastructure

**Files:**
- Create: `infra/modules/app/backups.tf`
- Modify: `infra/modules/app/ecs.tf` (task-def `secrets` + `exec_secrets` IAM policy)

- [ ] **Step 1: S3 bucket.** `object_lock_enabled = true` **at creation** — it cannot be added later. Default retention COMPLIANCE, 35 days. Versioning on. `block_public_access` all true. SSE-KMS. Lifecycle: non-current versions expire after 35 days; objects transition to GLACIER_IR at 35 days and expire at 7 years.

- [ ] **Step 2: SSM parameters** for `BACKUP_ARCHIVE_PASSPHRASE`, `GOOGLE_SERVICE_ACCOUNT_JSON`, with `lifecycle { ignore_changes = [value] }` so Terraform never overwrites the real values pasted in by hand.

- [ ] **Step 3: Wire them in three places or the task will not start** (see CLAUDE.md infra gotchas): the SSM parameter, the task-def `secrets` block, and the `exec_secrets` IAM policy resource list.

- [ ] **Step 4: Task role needs `s3:PutObject` and `s3:GetObject` on the bucket only.**

- [ ] **Step 5: EventBridge Scheduler**, `cron(0 2 * * ? *)` Europe/London, mirroring `scheduler.tf` exactly, with `command = ["sh","-c","npm run backup"]`.

- [ ] **Step 6: Validate**

Run: `cd infra/envs/production && terraform init -backend=false && terraform validate`
Expected: `Success!`

- [ ] **Step 7: Commit**

```bash
git add infra/
git commit -m "[TASK-423] Object-locked backup bucket, secrets and the nightly schedule"
```

---

### Task 8: README, then the restore rehearsal

- [ ] **Step 1: README section** covering: the three databases and why; what the archive contains; that secrets are excluded and why; **where the passphrase lives and that a copy outside AWS is mandatory**; how to restore; how to read the health email.

- [ ] **Step 2: Open the PR and drive it green.** `[TASK-423]`, watch `pr.yml`, squash-merge.

- [ ] **Step 3: Human setup** — paste the service-account JSON and a generated passphrase into the two SSM parameters, and give the passphrase to the owner for their password manager.

- [ ] **Step 4: THE REHEARSAL. This is the task, not an afterthought.**

Download last night's archive from Drive. On a local machine: `7z x`, `createdb nbcc_restore_test`, `pg_restore` the main dump, and compare row counts against `manifest.json`. Repeat for stories and contact. **Until this passes, the feature is not done** — an unverified backup is a belief, not a backup.

- [ ] **Step 5: Record the result** in the README with the date it was last rehearsed.

---

## Self-review against the spec

| Spec requirement | Task |
|---|---|
| Locked S3, Object Lock, 7-year lifecycle | 7 |
| Daily encrypted Drive archive | 3, 6, 7 |
| pg_dump + CSV | 6 |
| Website itself in the archive | 6 step 1.3 |
| Manifest with row counts | 2, 6 |
| Secrets excluded | 6 (never reads SSM values into the archive), 8 (documented) |
| Passphrase outside AWS | 8 steps 1 and 3 |
| Health email + failure/shrinkage/48h alerts | 2, 6 |
| Restore rehearsal | 8 step 4 |
| Config via schema | 4 |
| pg_dump version trap | 5 |
| **All three databases** | **1, and its test fails if a fourth appears** |

Deferred to their own PRs, as agreed: cost reductions (`multi_az`, `desired_count`) and the enquiry notification bar.
