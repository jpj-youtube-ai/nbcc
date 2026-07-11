import type { PoolClient } from "pg";
import { pool } from "./pool";
import { writeWithAudit } from "./donations";
import { effectivePermissions, can, type PermissionMap } from "../admin/permissions";

// Admin user CRUD + the last-admin anti-lockout guard (Admin management Phase 1, Task 3). Every
// mutating function is audited via writeWithAudit (one audit_log row per write, in the same
// transaction as the state change — mirrors submitClaimBatch/createClaimBatch/markGasdsClaimed in
// src/db/admin.ts). ManagedUser NEVER carries password_hash: every SELECT here lists the safe
// columns explicitly (id, email, full_name, role, status, invited_at, last_login_at, permissions)
// rather than SELECT * or reusing AdminUserRow (src/db/admin.ts), which does carry the hash for
// login-time verification only.

export type ManagedUser = {
  id: number;
  email: string;
  full_name: string;
  role: string; // viewer | editor | admin
  status: string; // invited | active | disabled
  invited_at: Date | null;
  last_login_at: Date | null;
  permissions: PermissionMap; // per-section view/edit overrides (Admin Phase 2); {} = fall back to role
};

const MANAGED_USER_COLUMNS = `id, email, full_name, role, status, invited_at, last_login_at, permissions`;

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

// Security review FIX #4: thrown by setUserRole/setUserStatus/deleteUser/setUserPermissions's
// transactional anti-lockout guard (assertAdminsRemain) when the mutation just performed would
// leave zero enabled "admins" — see the ADMIN_HOLDER_SQL comment below for what "admin" means
// post-Phase-2. Distinct from wouldOrphanAdmins/isLastEnabledAdmin (the route's fast, but
// non-atomic, PRE-check) — this is the AUTHORITATIVE guard, run inside the same transaction as
// the write, so a concurrent request can no longer race past the pre-check and commit anyway.
// The route layer (src/routes/admin-users.ts) catches this and maps it to the same 409
// { error: "last_admin" } the pre-check produces.
export class LastAdminError extends Error {
  constructor() {
    super("this change would leave zero enabled admins");
    this.name = "LastAdminError";
  }
}

// Admin Phase 2 (TASK-186): the anti-lockout guard is re-expressed from "role = 'admin'" to "a
// non-disabled user whose EFFECTIVE permissions grant team:edit" — matching
// effectivePermissions/can (src/admin/permissions.ts) exactly: a non-empty stored `permissions`
// map is authoritative (checked via the `team` key), and only an EMPTY stored map falls back to
// the role default (where only 'admin' grants team:edit). Expressed directly in SQL (rather than
// pulled into JS + filtered) so the same predicate is reused, verbatim, by both the fast
// pre-check's count (countEnabledAdmins) and the authoritative in-transaction guard
// (assertAdminsRemain) below.
const ADMIN_HOLDER_SQL = `status <> 'disabled' AND (
  (permissions ? 'team' AND permissions->>'team' = 'edit')
  OR (permissions = '{}'::jsonb AND role = 'admin')
)`;

// Count remaining enabled admins USING THE CALLER'S TRANSACTION CLIENT (not the pool), so the
// count reflects the mutation just performed in the same BEGIN…COMMIT, and throw LastAdminError
// if it is zero. writeWithAudit's catch rolls the whole transaction back on any throw, so the
// mutation, its audit row, and this check either all commit or all roll back together — closing
// the TOCTOU gap between the route's pre-check and the write.
async function assertAdminsRemain(client: PoolClient): Promise<void> {
  const row = (
    await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE ${ADMIN_HOLDER_SQL}`)
  ).rows[0];
  if (row.n === 0) throw new LastAdminError();
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

// The auth-relevant fields only (id, email, status, role, permissions) — NEVER password_hash.
// Backs authorizeSection (Admin Phase 2, Task 3), which re-loads this fresh on EVERY admin
// request so a disable or a permissions edit takes effect immediately, without waiting for the
// session to expire. Deliberately a separate, minimal SELECT rather than reusing getManagedUser,
// so the hot per-request path only ever touches the columns it needs.
export async function getUserAuthRow(
  id: number,
): Promise<{ id: number; email: string; status: string; role: string; permissions: PermissionMap } | null> {
  const row = (
    await pool.query<{ id: number; email: string; status: string; role: string; permissions: PermissionMap }>(
      `SELECT id, email, status, role, permissions FROM users WHERE id = $1`,
      [id],
    )
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

// Change a user's role (Task 5's PATCH /api/admin/users/:id). The caller (route layer) runs the
// fast wouldOrphanAdmins pre-check first (good UX, but not atomic with this write); this function
// then re-checks INSIDE ITS OWN TRANSACTION after the mutation (assertAdminsRemain) — the
// authoritative anti-lockout guard, closing the TOCTOU gap the pre-check alone leaves open.
// Throws LastAdminError (rolling the write back) if the change just made leaves zero enabled
// admins. Audited admin_user.role_changed. Returns the updated ManagedUser, or null when the id
// doesn't exist (RETURNING is empty — no audit row is written, since writeWithAudit's toAudit only
// runs after a successful write; a no-op PATCH stays silent, and the admin-count check is skipped).
export async function setUserRole(id: number, role: string, actor: string): Promise<ManagedUser | null> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<ManagedUser>(
          `UPDATE users SET role = $1 WHERE id = $2 RETURNING ${MANAGED_USER_COLUMNS}`,
          [role, id],
        )
      ).rows[0];
      if (!row) return null;
      await assertAdminsRemain(client);
      return row;
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

// Enable/disable a user (Task 5's PATCH /api/admin/users/:id). The caller runs the fast
// wouldOrphanAdmins pre-check first when status is moving to 'disabled'; this function then
// re-checks INSIDE ITS OWN TRANSACTION after the mutation (assertAdminsRemain) — see setUserRole's
// comment for why the pre-check alone is not sufficient. Audited admin_user.status_changed.
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
      if (!row) return null;
      await assertAdminsRemain(client);
      return row;
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

// Set a user's per-section permission matrix (Admin Phase 2, Task 5's PATCH
// /api/admin/users/:id/permissions). The route layer runs a fast, non-atomic pre-check first
// (isLastEnabledAdmin, mirroring setUserRole/setUserStatus's pattern); this function then
// re-checks INSIDE ITS OWN TRANSACTION after the mutation (assertAdminsRemain) — the
// AUTHORITATIVE guard, closing the same TOCTOU gap a concurrent request could otherwise race
// past (see setUserRole's comment). Audited admin_user.permissions_changed. Returns the updated
// ManagedUser, or null when the id doesn't exist (assertAdminsRemain is skipped on a no-op write).
export async function setUserPermissions(
  id: number,
  permissions: PermissionMap,
  actor: string,
): Promise<ManagedUser | null> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<ManagedUser>(
          `UPDATE users SET permissions = $1 WHERE id = $2 RETURNING ${MANAGED_USER_COLUMNS}`,
          [permissions, id],
        )
      ).rows[0];
      if (!row) return null;
      await assertAdminsRemain(client);
      return row;
    },
    () => ({
      actor,
      action: "admin_user.permissions_changed",
      entity: "user",
      entityId: id,
      data: { permissions },
    }),
  );
}

// Remove a user (Task 5's DELETE /api/admin/users/:id). The caller runs the fast
// wouldOrphanAdmins pre-check first; this function then re-checks INSIDE ITS OWN TRANSACTION
// after the delete (assertAdminsRemain) — see setUserRole's comment for why the pre-check alone
// is not sufficient. Audited admin_user.removed — the audit row carries a snapshot of the deleted
// row's email/role since the user itself no longer exists to look up later.
export async function deleteUser(id: number, actor: string): Promise<boolean> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<{ id: number; email: string; role: string }>(
          `DELETE FROM users WHERE id = $1 RETURNING id, email, role`,
          [id],
        )
      ).rows[0];
      if (!row) return null;
      await assertAdminsRemain(client);
      return row;
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
// endpoint) — sets password_hash and, ONLY when the user is currently 'invited', flips status to
// 'active' (first password set = invite acceptance). Security review FIX #5: a 'disabled' or
// already-'active' user's status is left UNCHANGED — status is never unconditionally forced to
// 'active' here. The route layer independently rejects a disabled target before ever calling this
// (postAdminSetPassword), but this CASE guard is defense in depth: even if that route-level check
// were bypassed, this UPDATE can never promote a disabled account back to active.
export async function setUserPassword(
  id: number,
  passwordHash: string,
  actor: string,
  action: "admin_user.activated" | "admin_user.password_reset",
): Promise<void> {
  await writeWithAudit(
    async (client) => {
      await client.query(
        `UPDATE users
         SET password_hash = $1, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END
         WHERE id = $2`,
        [passwordHash, id],
      );
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

// Count remaining "admin holders" (see ADMIN_HOLDER_SQL above) — the input to the anti-lockout
// guard. 'invited' holders count as enabled (they are not disabled), matching wouldOrphanAdmins's
// target check below, which only cares about status/permissions/role as currently persisted.
export async function countEnabledAdmins(): Promise<number> {
  const row = (
    await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM users WHERE ${ADMIN_HOLDER_SQL}`)
  ).rows[0];
  return row.count;
}

// The pure anti-lockout decision (unit-tested DB-free — test/unit/admin-users-guard.test.ts): would
// applying `change` to `target` drop the count of "admin holders" to zero? True only when the
// target itself CURRENTLY holds effective team:edit (a non-disabled user whose stored permissions
// grant team:edit, or — when they have no stored overrides — whose role is 'admin'; see
// effectivePermissions/can in src/admin/permissions.ts) AND it is the only one (enabledAdminCount
// <= 1). `permissions` is optional here (defaults to the role fallback) so existing callers that
// only ever dealt with role/status (e.g. the guard's own unit tests) keep working unchanged.
export function wouldOrphanAdmins(
  target: { role: string; status: string; permissions?: PermissionMap | null },
  change: "demote" | "disable" | "delete",
  enabledAdminCount: number,
): boolean {
  const perms = effectivePermissions({ role: target.role, permissions: target.permissions ?? null });
  const targetHasTeamEdit = target.status !== "disabled" && can(perms, "team", "edit");
  if (!targetHasTeamEdit) return false;
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
