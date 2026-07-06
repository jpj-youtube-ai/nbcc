// One-off admin password setter (ops utility, not an HTTP route).
//
// The admin/staff login (src/routes/admin.ts, REQ-062/TASK-105) verifies email + scrypt password. A
// user row can exist with role='admin' but password_hash=NULL (e.g. seeded by a migration), in which
// case login always 401s ("no credential set"). This sets that credential for an EXISTING user — it
// does NOT create users or grant roles (RBAC/account creation stays in migrations).
//
// It lives under src/ so `tsc` compiles it into dist/ (shipped in the runtime image), letting it run
// with plain `node dist/ops/set-admin-password.js` — no tsx/devDeps needed. In production the DB is
// only reachable from inside the VPC, so it runs as a one-off ECS task (same pattern as migrations),
// with ADMIN_PASSWORD injected as a task-def secret sourced from the ADMIN_BOOTSTRAP_PASSWORD SSM
// SecureString. The plaintext is read from the env, never argv, and never logged (golden rule 4).
import { hashPassword } from "../admin/password";
import { pool } from "../db/pool";
import { resolveInputs } from "./admin-password-input";

// Set password_hash for an existing user. Returns the number of rows updated (0 = no such user).
export async function setAdminPassword(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const { email, password } = resolveInputs(argv, env);
  const hash = await hashPassword(password);
  const { rowCount } = await pool.query(
    `UPDATE users SET password_hash = $1 WHERE email = $2`,
    [hash, email],
  );
  if (rowCount === 0) {
    throw new Error(`no user with email ${email} (create the account first, e.g. via a migration)`);
  }
  return rowCount ?? 0;
}

// Only run when invoked directly (node dist/ops/set-admin-password.js), not when imported by a test.
if (require.main === module) {
  setAdminPassword(process.argv, process.env)
    .then(async (rows) => {
      // The email is safe to log; the password/hash are never logged.
      const email = process.argv[process.argv.indexOf("--email") + 1];
      console.error(`password set for ${email} (${rows} row updated)`);
      await pool.end();
    })
    .catch(async (err: unknown) => {
      console.error("set-admin-password failed:", err instanceof Error ? err.message : err);
      await pool.end();
      process.exit(1);
    });
}
