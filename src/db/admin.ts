import { pool } from "./pool";

// Read access to admin/staff `users` (TASK-105/REQ-062). Read-only (pool.query, no transaction —
// mirrors getDonorPortalSnapshot in src/db/portal.ts). The login endpoint looks a user up by email
// and verifies the password against password_hash (src/admin/password.ts); RBAC-gated admin actions
// are TASK-106.

export interface AdminUserRow {
  id: number;
  email: string;
  full_name: string;
  role: string; // viewer | editor | admin
  password_hash: string | null; // scrypt hash; NULL for an account with no password set
}

// Look up a user by email, or null when none matches. Returns the password_hash so the caller can
// verify it — this row never leaves the server unredacted.
export async function findUserByEmail(email: string): Promise<AdminUserRow | null> {
  const row = (
    await pool.query<AdminUserRow>(
      `SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1`,
      [email],
    )
  ).rows[0];
  return row ?? null;
}
