import { pool } from "./pool";
import { writeWithAudit } from "./donations";

// Admin user CRUD + the last-admin anti-lockout guard (Admin management Phase 1, Task 3). Every
// mutating function is audited via writeWithAudit (one audit_log row per write, in the same
// transaction as the state change — mirrors submitClaimBatch/createClaimBatch/markGasdsClaimed in
// src/db/admin.ts). ManagedUser NEVER carries password_hash: every SELECT here lists the safe
// columns explicitly (id, email, full_name, role, status, invited_at, last_login_at) rather than
// SELECT * or reusing AdminUserRow (src/db/admin.ts), which does carry the hash for login-time
// verification only.

export type ManagedUser = {
  id: number;
  email: string;
  full_name: string;
  role: string; // viewer | editor | admin
  status: string; // invited | active | disabled
  invited_at: Date | null;
  last_login_at: Date | null;
};

const MANAGED_USER_COLUMNS = `id, email, full_name, role, status, invited_at, last_login_at`;

// Thrown by inviteUser when the email already has a users row (pg unique-violation on
// users.email, err.code === "23505"). The route layer (Task 5) maps this to 409.
export class DuplicateEmailError extends Error {
  constructor(public readonly email: string) {
    super(`a user with email ${email} already exists`);
    this.name = "DuplicateEmailError";
  }
}

// A pg client/driver error carries a `code` (SQLSTATE); type it narrowly rather than importing a
// pg-specific error class, since node-postgres throws a plain Error with `code` attached.
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

// All users, newest first — backs the admin Team table (Task 8). Read-only (pool.query, no
// transaction — mirrors listClaimBatches / listDunning in src/db/admin.ts).
export async function listUsers(): Promise<ManagedUser[]> {
  const res = await pool.query<ManagedUser>(
    `SELECT ${MANAGED_USER_COLUMNS} FROM users ORDER BY id DESC`,
  );
  return res.rows;
}

// A single managed user by id, or null when it doesn't exist. Read-only.
export async function getManagedUser(id: number): Promise<ManagedUser | null> {
  const row = (
    await pool.query<ManagedUser>(`SELECT ${MANAGED_USER_COLUMNS} FROM users WHERE id = $1`, [id])
  ).rows[0];
  return row ?? null;
}

// A single managed user by email, or null — backs the public /api/admin/forgot lookup (Task 5),
// which needs the live `status` (to decide whether to send a reset email) without ever touching
// password_hash. Mirrors getManagedUser; never selects the hash.
export async function getManagedUserByEmail(email: string): Promise<ManagedUser | null> {
  const row = (
    await pool.query<ManagedUser>(`SELECT ${MANAGED_USER_COLUMNS} FROM users WHERE email = $1`, [email])
  ).rows[0];
  return row ?? null;
}

// The user's current password_hash, for computing/verifying an invite or reset token's `bind`
// (Task 2/5) — NEVER returned from an API response, only compared server-side. Returns null both
// when the user doesn't exist and when they have no password set yet (an invited user); either way
// the caller treats it as the empty-string bind, matching how inviteUser seeds bind="".
export async function getPasswordHash(id: number): Promise<string | null> {
  const row = (
    await pool.query<{ password_hash: string | null }>(`SELECT password_hash FROM users WHERE id = $1`, [id])
  ).rows[0];
  return row?.password_hash ?? null;
}

// Invite a new admin/staff user (Task 5's POST /api/admin/users). Inserts status='invited',
// password_hash=NULL (no password until the invite is accepted via set-password), invited_at=now().
// Audited admin_user.invited in the same transaction (writeWithAudit). A duplicate email hits the
// users.email UNIQUE constraint (migrations/1782987698792_claim-batches-and-users.js) — caught here
// and re-thrown as the typed DuplicateEmailError so the route can 409 instead of 500.
export async function inviteUser(
  input: { email: string; full_name: string; role: string },
  actor: string,
): Promise<{ id: number }> {
  try {
    return await writeWithAudit(
      async (client) => {
        const row = (
          await client.query<{ id: number }>(
            `INSERT INTO users (email, full_name, role, status, password_hash, invited_at)
             VALUES ($1, $2, $3, 'invited', NULL, now())
             RETURNING id`,
            [input.email, input.full_name, input.role],
          )
        ).rows[0];
        return { id: row.id };
      },
      (r) => ({
        actor,
        action: "admin_user.invited",
        entity: "user",
        entityId: r.id,
        data: { email: input.email, role: input.role },
      }),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateEmailError(input.email);
    throw err;
  }
}

// Change a user's role (Task 5's PATCH /api/admin/users/:id). The caller (route layer) is
// responsible for running wouldOrphanAdmins first when this is a demotion away from 'admin' — this
// function performs the write unconditionally. Audited admin_user.role_changed. Returns the updated
// ManagedUser, or null when the id doesn't exist (RETURNING is empty — no audit row is written, since
// writeWithAudit's toAudit only runs after a successful write; a no-op PATCH stays silent).
export async function setUserRole(id: number, role: string, actor: string): Promise<ManagedUser | null> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<ManagedUser>(
          `UPDATE users SET role = $1 WHERE id = $2 RETURNING ${MANAGED_USER_COLUMNS}`,
          [role, id],
        )
      ).rows[0];
      return row ?? null;
    },
    () => ({
      actor,
      action: "admin_user.role_changed",
      entity: "user",
      entityId: id,
      data: { role },
    }),
  );
}

// Enable/disable a user (Task 5's PATCH /api/admin/users/:id). The caller is responsible for running
// wouldOrphanAdmins first when status is moving to 'disabled'. Audited admin_user.status_changed.
export async function setUserStatus(
  id: number,
  status: "active" | "disabled",
  actor: string,
): Promise<ManagedUser | null> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<ManagedUser>(
          `UPDATE users SET status = $1 WHERE id = $2 RETURNING ${MANAGED_USER_COLUMNS}`,
          [status, id],
        )
      ).rows[0];
      return row ?? null;
    },
    () => ({
      actor,
      action: "admin_user.status_changed",
      entity: "user",
      entityId: id,
      data: { status },
    }),
  );
}

// Remove a user (Task 5's DELETE /api/admin/users/:id). The caller is responsible for running
// wouldOrphanAdmins first. Audited admin_user.removed — the audit row carries a snapshot of the
// deleted row's email/role since the user itself no longer exists to look up later.
export async function deleteUser(id: number, actor: string): Promise<boolean> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<{ id: number; email: string; role: string }>(
          `DELETE FROM users WHERE id = $1 RETURNING id, email, role`,
          [id],
        )
      ).rows[0];
      return row ?? null;
    },
    (deleted) => ({
      actor,
      action: "admin_user.removed",
      entity: "user",
      entityId: id,
      data: deleted ? { email: deleted.email, role: deleted.role } : {},
    }),
  ).then((deleted) => deleted != null);
}

// Set a user's password (invite acceptance or admin/self-service reset, Task 5's set-password
// endpoint) — sets password_hash and flips status to 'active' (an invited user becomes active on
// first password set; a disabled user cannot reach this path since its reset link check is against
// the live row). The specific audit action distinguishes the two flows for the audit trail.
export async function setUserPassword(
  id: number,
  passwordHash: string,
  actor: string,
  action: "admin_user.activated" | "admin_user.password_reset",
): Promise<void> {
  await writeWithAudit(
    async (client) => {
      await client.query(`UPDATE users SET password_hash = $1, status = 'active' WHERE id = $2`, [
        passwordHash,
        id,
      ]);
      return { id };
    },
    (r) => ({
      actor,
      action,
      entity: "user",
      entityId: r.id,
      data: {},
    }),
  );
}

// Stamp last_login_at on a successful login (Task 6's postLogin). Not audited — a login is not a
// user-management write, it's routine access; the audit trail here is scoped to admin_user.* changes.
export async function touchLastLogin(id: number): Promise<void> {
  await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [id]);
}

// Count enabled admins (role='admin' AND status != 'disabled') — the input to the anti-lockout guard.
// 'invited' admins count as enabled (they are not disabled), matching wouldOrphanAdmins's target
// check below, which only cares about role/status as currently persisted.
export async function countEnabledAdmins(): Promise<number> {
  const row = (
    await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND status != 'disabled'`,
    )
  ).rows[0];
  return row.count;
}

// The pure anti-lockout decision (unit-tested DB-free — test/unit/admin-users-guard.test.ts): would
// applying `change` to `target` drop the enabled-admin count to zero? True only when the target is
// itself currently an enabled admin (role='admin' and status!=='disabled') AND it is the only one
// (enabledAdminCount <= 1). A non-admin target, or an admin when others remain, is always false.
export function wouldOrphanAdmins(
  target: Pick<ManagedUser, "role" | "status">,
  change: "demote" | "disable" | "delete",
  enabledAdminCount: number,
): boolean {
  const targetIsEnabledAdmin = target.role === "admin" && target.status !== "disabled";
  if (!targetIsEnabledAdmin) return false;
  return enabledAdminCount <= 1;
}

// DB-bound wrapper around wouldOrphanAdmins (Task 5's route layer calls this directly): looks up the
// live enabled-admin count and applies the pure guard to `target`. `change` here is named to match
// the plan's Interfaces block ("demote" | "disable" | "delete") though the caller decides which one
// applies (e.g. a role PATCH away from 'admin' is a "demote").
export async function isLastEnabledAdmin(
  target: ManagedUser,
  change: "demote" | "disable" | "delete",
): Promise<boolean> {
  const enabledAdminCount = await countEnabledAdmins();
  return wouldOrphanAdmins(target, change, enabledAdminCount);
}
