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
