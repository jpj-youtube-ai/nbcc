import type { AuditInput } from "../db/donations";

// The pure, DB-free declaration CANCELLATION builder (REQ-061). A donor cancelling Gift Aid REVOKES
// their active declaration with NO superseding replacement — unlike an EDIT (REQ-059), which revokes
// the old row AND inserts a corrected one that supersedes it (buildDeclarationRevision). This module
// owns ONLY the pure decision + mapping: given the declaration to cancel and the injected clock, it
// returns the revocation record + the single `declaration.revoked` audit row. NO pool/config — and no
// ambient clock (the timestamp is INJECTED, `now`), so it stays deterministic and unit-tested DB-free
// like src/declarations/revision.ts. The audited transactional write that persists this
// (cancelDeclaration in src/db/declarations.ts) calls it. The AuditInput import is type-only, so this
// module carries no runtime dependency on the DB layer.

export interface DeclarationCancellationInput {
  current: { id: number; donor_id: number };
  now: Date; // injected clock — the revocation timestamp
  actor: string; // who performed the cancellation (e.g. "donor")
}

export interface DeclarationCancellation {
  // The row to revoke: its id + the revocation timestamp. No superseded_by — a cancellation has no
  // replacement (that field stays NULL), which is what distinguishes it from an edit's supersession.
  revokedDeclaration: { id: number; revoked_at: Date };
  // The single audit row appended alongside the revoke. Carries the donor + revocation time and no
  // `supersededBy`, so it reads as a plain cancellation rather than an edit's revoke-and-supersede.
  audit: AuditInput;
}

// Build the cancellation. Pure — it always revokes (the "is this cancellable?" guard is the DB
// writer's job, since it depends on the live revoked_at). Returns the revocation record + the
// `declaration.revoked` audit input, so the writer only has to run the UPDATE + insertAudit.
export function buildDeclarationCancellation(
  input: DeclarationCancellationInput,
): DeclarationCancellation {
  const { current, now, actor } = input;
  return {
    revokedDeclaration: { id: current.id, revoked_at: now },
    audit: {
      actor,
      action: "declaration.revoked",
      entity: "declaration",
      entityId: current.id,
      data: { donorId: current.donor_id, revokedAt: now.toISOString(), reason: "gift_aid_cancelled" },
    },
  };
}
