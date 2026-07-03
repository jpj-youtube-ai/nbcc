import { pool } from "./pool";
import { insertAudit, insertDeclaration } from "./donations";
import type { DeclarationFields } from "../declarations/fields";
import type { Scope, Mode } from "../declarations/wording";
import {
  buildDeclarationRevision,
  type CurrentDeclaration,
} from "../declarations/revision";

// The transactional, audited declaration-revision write (REQ-059). A donor editing their Gift Aid
// declaration never mutates the immutable saved row (REQ-046): this REVOKES the old row and inserts
// a new one that SUPERSEDES it, in ONE transaction with its two audit_log rows — mirroring the
// writeWithAudit / assignDonationToBatch shape in src/db/donations.ts (a manual BEGIN…COMMIT here
// because two audit rows are appended, which writeWithAudit's single-audit shape does not cover).
// The pure revision decision lives in src/declarations/revision.ts; this owns only the transaction.

// A revision that cannot proceed: the declaration id is unknown, or it is already revoked (a row is
// revoked exactly once). A typed error like BatchAssignmentError so a caller/route can branch on it.
export class DeclarationRevisionError extends Error {
  constructor(
    public readonly reason: "not_found" | "already_revoked",
    public readonly declarationId: number,
  ) {
    super(`declaration ${declarationId} cannot be revised: ${reason}`);
    this.name = "DeclarationRevisionError";
  }
}

interface DeclarationRow extends CurrentDeclaration {
  revoked_at: Date | null;
}

export interface ReviseDeclarationResult {
  revised: boolean; // false when nothing meaningful changed (a no-op — no writes)
  revokedDeclarationId: number;
  newDeclarationId?: number; // present only when revised
}

// Revise the declaration `declarationId` with the newly captured fields. In ONE transaction it:
// locks the row (FOR UPDATE, so a concurrent revise races safely), rejects an unknown id
// (not_found) or an already-revoked row (already_revoked) with DeclarationRevisionError, computes
// the revision (buildDeclarationRevision) and — when something changed — inserts the new immutable
// declarations row, sets the old row's revoked_at + superseded_by_declaration_id, and appends a
// `declaration.revoked` + a `declaration.created` audit row. Any throw rolls back ALL of it. It
// NEVER touches donations — an existing donation.declaration_id still points at the (now revoked)
// old row; re-linking is a separate concern. A no-op (no field change) commits without writing.
export async function reviseDeclaration(
  declarationId: number,
  updated: DeclarationFields,
  context: { scope: Scope; confirmedTaxpayer: boolean; mode: Mode; actor?: string },
): Promise<ReviseDeclarationResult> {
  const actor = context.actor ?? "system";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (
      await client.query<DeclarationRow>(
        `SELECT id, donor_id, title, first_name, last_name, house_name_number, address, postcode,
                non_uk, scope, confirmed_taxpayer, revoked_at
           FROM declarations
          WHERE id = $1 FOR UPDATE`,
        [declarationId],
      )
    ).rows[0];
    if (!row) throw new DeclarationRevisionError("not_found", declarationId);
    if (row.revoked_at != null) throw new DeclarationRevisionError("already_revoked", declarationId);

    const revision = buildDeclarationRevision({
      current: {
        id: row.id,
        donor_id: row.donor_id,
        title: row.title,
        first_name: row.first_name,
        last_name: row.last_name,
        house_name_number: row.house_name_number,
        address: row.address,
        postcode: row.postcode,
        non_uk: row.non_uk,
        scope: row.scope,
        confirmed_taxpayer: row.confirmed_taxpayer,
      },
      updated,
      scope: context.scope,
      confirmedTaxpayer: context.confirmedTaxpayer,
      mode: context.mode,
      now: new Date(),
    });

    // No meaningful change → nothing to revise; commit the (read-only) transaction and return.
    if (!revision) {
      await client.query("COMMIT");
      return { revised: false, revokedDeclarationId: declarationId };
    }

    // Insert the new immutable row FIRST so its id can be wired onto the old row's superseded_by.
    const newDeclarationId = await insertDeclaration(client, revision.newDeclaration);
    await client.query(
      `UPDATE declarations SET revoked_at = $1, superseded_by_declaration_id = $2 WHERE id = $3`,
      [revision.revokedDeclaration.revoked_at, newDeclarationId, declarationId],
    );
    await insertAudit(client, {
      actor,
      action: "declaration.revoked",
      entity: "declaration",
      entityId: declarationId,
      data: { supersededBy: newDeclarationId, donorId: row.donor_id },
    });
    await insertAudit(client, {
      actor,
      action: "declaration.created",
      entity: "declaration",
      entityId: newDeclarationId,
      data: { supersedes: declarationId, donorId: row.donor_id },
    });

    await client.query("COMMIT");
    return { revised: true, revokedDeclarationId: declarationId, newDeclarationId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
