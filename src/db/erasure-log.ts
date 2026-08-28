import { pool } from "./pool";

// TASK-311: the record that something was erased, kept after the thing itself is gone.
//
// Three stories were permanently deleted from production and nothing could say what had gone, when,
// or why - the table was simply empty. Archiving makes the everyday action reversible, but permanent
// erasure has to stay possible: a charity must be able to honour a GDPR erasure request, and the
// Stories page exists partly to withdraw a story if consent is revoked. So erasure leaves a
// tombstone instead of a silence.
//
// WHAT THIS MUST NEVER CARRY: the erased content, or the person's name, email, phone or town. An
// erasure that quietly kept a copy of the personal data somewhere else would not be an erasure - it
// would be a compliance failure wearing an audit trail's clothes. Kind, id, when, who, why. Nothing
// else, and no function here accepts anything else.
//
// It lives in the MAIN database deliberately: stories and contact enquiries each have their own, and
// a log kept beside them would be destroyed by the very thing it exists to outlive.

export type ErasedRecordKind = "story" | "contact_enquiry";

export interface ErasureLogRow {
  id: number;
  recordKind: ErasedRecordKind;
  recordId: number;
  erasedAt: string;
  erasedBy: string;
  reason: string;
}

/**
 * Write the tombstone. Called immediately BEFORE the erasure itself, so a crash between the two
 * leaves a record of an erasure that did not happen - which is noticed and corrected - rather than
 * an erasure with no record, which is the failure this table exists to prevent.
 */
export async function recordErasure(entry: {
  recordKind: ErasedRecordKind;
  recordId: number;
  erasedBy: string;
  reason: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO erasure_log (record_kind, record_id, erased_by, reason)
     VALUES ($1, $2, $3, $4)`,
    [entry.recordKind, entry.recordId, entry.erasedBy, entry.reason.trim().slice(0, 2000)],
  );
}

/** Newest first, which is the only way anybody reads it. */
export async function listErasures(limit = 500): Promise<ErasureLogRow[]> {
  const { rows } = await pool.query(
    `SELECT id, record_kind, record_id, erased_at, erased_by, reason
       FROM erasure_log
      ORDER BY erased_at DESC, id DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    recordKind: r.record_kind as ErasedRecordKind,
    recordId: Number(r.record_id),
    erasedAt: r.erased_at,
    erasedBy: r.erased_by,
    reason: r.reason,
  }));
}
