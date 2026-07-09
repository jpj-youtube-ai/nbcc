// My Story stories-database bootstrap (TASK-B2/REQ intent: "Persist My Story submissions
// to a dedicated stories database..."). Terraform generates the `stories_app` credential
// and publishes it as the STORIES_DATABASE_URL SSM parameter (infra/modules/app/main.tf),
// but it can't create the database or role itself: there's no `postgresql` Terraform
// provider wired into this stack, `db_name` on the RDS instance is hardcoded to `charity`
// (rds.tf), and RDS sits in a private subnet only the ECS task security group can reach.
// So provisioning happens here, imperatively, run as a one-off `ecs run-task` (same shape
// as `npm run migrate`) that reaches RDS from inside the VPC:
//   1. Connect with the MASTER DATABASE_URL (the `app` user, which on RDS has
//      CREATEDB/CREATEROLE).
//   2. Idempotently CREATE ROLE / ALTER ROLE `stories_app` with the password parsed out of
//      STORIES_DATABASE_URL (so the role always matches whatever SSM currently holds, even
//      after a secret rotation).
//   3. Idempotently CREATE DATABASE `stories` owned by that role.
//   4. GRANT ALL PRIVILEGES (harmless if already owner).
//
// Safe to re-run (staging/prod bootstrap runs once per environment, but idempotency means a
// re-run — e.g. after a failed deploy — never errors or duplicates work).
//
// CREATE DATABASE cannot run inside a transaction block, so this script never opens one
// (BEGIN/COMMIT) — every statement runs in Postgres's default autocommit mode.
//
// Run:
//   DATABASE_URL=... STORIES_DATABASE_URL=... node scripts/bootstrap-stories-db.mjs
// (npm run bootstrap:stories reads both from the environment, same as `npm run migrate`.)
import pg from "pg";

const { Client } = pg;

// Pure, DB-free URL parsing — unit-tested in test/unit/bootstrap-stories-url.test.ts without
// needing a database. Never string-concats the password into a log line or error message.
export function parseStoriesUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("STORIES_DATABASE_URL is not a valid URL");
  }

  const user = parsed.username ? decodeURIComponent(parsed.username) : "";
  const password = parsed.password ? decodeURIComponent(parsed.password) : "";
  const database = parsed.pathname.replace(/^\//, "");

  if (!user || !password) {
    throw new Error("STORIES_DATABASE_URL is missing a user or password");
  }
  if (!database) {
    throw new Error("STORIES_DATABASE_URL is missing a database name");
  }

  return { user, password, database };
}

// Quote a Postgres identifier (role/database name) safely — doubles embedded quotes.
// Used instead of a bound parameter because CREATE ROLE/DATABASE don't accept them for
// identifiers; the identifier here is always our own STORIES_DATABASE_URL, not user input.
function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Quote a Postgres string literal (e.g. a password in ALTER/CREATE ROLE ... PASSWORD '...'),
// which also can't be a bound parameter in that DDL position.
function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function bootstrapStoriesDb({ masterUrl, storiesUrl, log = console.error } = {}) {
  if (!masterUrl) throw new Error("DATABASE_URL is required (master connection)");
  if (!storiesUrl) throw new Error("STORIES_DATABASE_URL is required");

  const { user, password, database } = parseStoriesUrl(storiesUrl);

  // Connects to the `charity` DB as the master `app` user — same connection mechanism the
  // app pool uses (src/db/pool.ts), so it carries sslmode=no-verify in AWS and connects
  // plaintext locally with no extra config here.
  const client = new Client({ connectionString: masterUrl });
  await client.connect();

  try {
    // No BEGIN/COMMIT: CREATE DATABASE cannot run inside a transaction block, so every
    // statement below runs in Postgres's default autocommit mode.

    // --- Role: idempotent create-or-resync ---
    const { rowCount: roleExists } = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [user],
    );
    if (roleExists === 0) {
      log(`creating role ${user}`);
      await client.query(
        `CREATE ROLE ${quoteIdent(user)} LOGIN PASSWORD ${quoteLiteral(password)}`,
      );
    } else {
      // Re-sync in case the secret rotated (e.g. a Terraform apply regenerated the password).
      log(`role ${user} already exists; re-syncing password`);
      await client.query(
        `ALTER ROLE ${quoteIdent(user)} WITH LOGIN PASSWORD ${quoteLiteral(password)}`,
      );
    }

    // --- Database: idempotent create ---
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

    // Harmless if already owner; makes the grant explicit either way.
    await client.query(
      `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent(database)} TO ${quoteIdent(user)}`,
    );

    log("stories database bootstrap complete");
  } finally {
    await client.end();
  }
}

// Only run when invoked directly (node scripts/bootstrap-stories-db.mjs), not when imported
// by a test.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMain) {
  bootstrapStoriesDb({
    masterUrl: process.env.DATABASE_URL,
    storiesUrl: process.env.STORIES_DATABASE_URL,
  })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("bootstrap-stories-db failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
