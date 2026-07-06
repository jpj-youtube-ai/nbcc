// One-off admin password setter (ops utility, not an HTTP route).
//
// The admin/staff login (src/routes/admin.ts, REQ-062/TASK-105) verifies email + scrypt password.
// A user row can exist with role='admin' but password_hash=NULL (e.g. seeded by a migration), in
// which case login always 401s ("no credential set"). This script sets that credential for an
// EXISTING user — it does NOT create users or grant roles (RBAC/account creation stays in migrations).
//
// The plaintext password is read from the ADMIN_PASSWORD env var — never from argv (which shows up in
// process listings / shell history) and never logged (golden rule 4). It is hashed with the exact same
// scrypt scheme the app verifies against (src/admin/password.ts).
//
// Run (needs DATABASE_URL + the app config, same env the service boots with — writes go via
// src/db/pool.ts). In production the DB is only reachable from inside the VPC, so run it as a one-off
// ECS task (same pattern as `npm run migrate`), passing ADMIN_PASSWORD from an SSM SecureString:
//
//   ADMIN_PASSWORD='…' npm run admin:set-password -- --email you@example.com
//
// Exit 0 = password set; exit 1 = bad input / no matching user / DB error.
import { hashPassword } from "../src/admin/password.ts";
import { pool } from "../src/db/pool.ts";
import { resolveInputs } from "./lib/admin-password-input.mjs";

async function main() {
  const { email, password } = resolveInputs(process.argv, process.env);
  const hash = await hashPassword(password);
  // Update an EXISTING user only. rowCount 0 => no such user; we do not create one here.
  const { rowCount } = await pool.query(
    `UPDATE users SET password_hash = $1 WHERE email = $2`,
    [hash, email],
  );
  if (rowCount === 0) {
    throw new Error(`no user with email ${email} (create the account first, e.g. via a migration)`);
  }
  console.error(`password set for ${email} (${rowCount} row updated)`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("set-admin-password failed:", err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
