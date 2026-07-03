import { pool } from "./pool";
import { writeWithAudit } from "./donations";
import { findActiveDeclarationIdForDonor, DeclarationCancellationError } from "./declarations";
import { buildDeclarationCancellation } from "../declarations/cancellation";

// Read access to admin/staff `users` (TASK-105/REQ-062). Read-only (pool.query, no transaction —
// mirrors getDonorPortalSnapshot in src/db/portal.ts). The login endpoint looks a user up by email
// and verifies the password against password_hash (src/admin/password.ts); the RBAC-gated admin
// writes below (TASK-106) let an Editor/Admin act on a donor's behalf, each appending its audit_log
// row in the SAME transaction as the state change (writeWithAudit — the truth model).

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

// Revoke a donor's active Gift Aid declaration on an admin's behalf (REQ-062 · TASK-106). Mirrors
// cancelDeclaration but is issued by an admin: it finds the donor's active declaration and, in ONE
// audited transaction (writeWithAudit), locks the row (FOR UPDATE), rejects an already-revoked one
// (DeclarationCancellationError), sets revoked_at and appends the `declaration.revoked` audit row
// (built by the pure buildDeclarationCancellation, with the admin as actor). NO new declaration row
// is inserted — a cancellation has no replacement. Returns { cancelled: false } when the donor has
// no active declaration, so the route can 404.
export async function adminCancelGiftAid(
  donorId: number,
  actor: string,
): Promise<{ cancelled: boolean; declarationId?: number }> {
  const declarationId = await findActiveDeclarationIdForDonor(donorId);
  if (declarationId == null) return { cancelled: false };

  await writeWithAudit(
    async (client) => {
      const row = (
        await client.query<{ id: number; donor_id: number; revoked_at: Date | null }>(
          `SELECT id, donor_id, revoked_at FROM declarations WHERE id = $1 FOR UPDATE`,
          [declarationId],
        )
      ).rows[0];
      if (!row) throw new DeclarationCancellationError("not_found", declarationId);
      if (row.revoked_at != null) throw new DeclarationCancellationError("already_revoked", declarationId);

      const cancellation = buildDeclarationCancellation({
        current: { id: row.id, donor_id: row.donor_id },
        now: new Date(),
        actor,
      });
      await client.query(`UPDATE declarations SET revoked_at = $1 WHERE id = $2`, [
        cancellation.revokedDeclaration.revoked_at,
        declarationId,
      ]);
      return cancellation;
    },
    (cancellation) => cancellation.audit,
  );
  return { cancelled: true, declarationId };
}

// Record that an admin cancelled a donor's monthly subscription (REQ-062 · TASK-106). The
// subscription state itself lives in Stripe (cancelSubscription); this appends the admin-action
// audit_log row via writeWithAudit so who-did-what is durably recorded in the same truth model as
// every other write.
export async function recordAdminSubscriptionCancellation(
  donorId: number,
  subscriptionId: string,
  actor: string,
): Promise<void> {
  await writeWithAudit(
    async () => ({ donorId, subscriptionId }),
    (r) => ({
      actor,
      action: "admin.subscription_cancelled",
      entity: "donor",
      entityId: r.donorId,
      data: { subscriptionId: r.subscriptionId },
    }),
  );
}
