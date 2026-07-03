/* eslint-disable */
// TASK-094 (REQ-063): a refund/dispute on an ALREADY-CLAIMED donation owes HMRC an adjustment
// (the pure recalculation lives in src/claims/refund.ts, TASK-093, which returns
// claim_status='adjustment_due' + an adjustment amount). This migration lays the persistence for
// that: it WIDENS the donations.claim_status CHECK to allow the new 'adjustment_due' value, and
// adds a claim_adjustments table recording each owed adjustment against its donation + claim batch.
//
// Additive / expand-contract, safe on populated data (golden rule 2):
//   • Widening a text CHECK only ENLARGES the accepted set — it can never reject an existing row
//     (every current claim_status value is still allowed), so no existing row/column is touched.
//   • claim_adjustments is a brand-new table; no existing table is altered.
// Independent of the earlier additive migrations (order between them does not matter). Mirrors the
// FK style of 1782987698792 (claim_batches / donations) and the CHECK-column style of
// 1783062309816 (payment_status).
//
// The audited write that INSERTs into claim_adjustments and flips claim_status='adjustment_due'
// (extending writeWithAudit / assignDonationToBatch in src/db/donations.ts) is the NEXT task; this
// only lays the column set + constraint.

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Widen the claim_status CHECK to include 'adjustment_due' (the auto-named inline constraint
  // from migration 1782923222001). DROP + ADD the constraint — the new set is a SUPERSET of the
  // old, so no existing row can violate it.
  pgm.dropConstraint("donations", "donations_claim_status_check");
  pgm.addConstraint(
    "donations",
    "donations_claim_status_check",
    "CHECK (claim_status IN ('not_eligible','eligible','batched','claimed','adjustment_due'))",
  );

  // ---- claim_adjustments: an adjustment owed to HMRC for a refunded/disputed claimed donation ----
  // donation_id + claim_batch_id both RESTRICT (a donation / batch cannot be deleted while an
  // adjustment references it) and are indexed. adjustment_pence is the owed amount (the refunded
  // portion of the already-claimed gift, per src/claims/refund.ts); reason records why.
  pgm.createTable(
    "claim_adjustments",
    {
      id: "id",
      donation_id: { type: "integer", notNull: true, references: "donations", onDelete: "RESTRICT" },
      claim_batch_id: {
        type: "integer",
        notNull: true,
        references: "claim_batches",
        onDelete: "RESTRICT",
      },
      adjustment_pence: { type: "integer", notNull: true, check: "adjustment_pence >= 0" },
      reason: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "An HMRC claim adjustment owed for a refunded/disputed already-claimed donation (REQ-063)." },
  );
  pgm.createIndex("claim_adjustments", "donation_id");
  pgm.createIndex("claim_adjustments", "claim_batch_id");
};

exports.down = (pgm) => {
  pgm.dropTable("claim_adjustments");
  // Restore the original (narrower) CHECK. Safe in dev (down is not run on populated prod data);
  // any 'adjustment_due' row would have to be reverted first.
  pgm.dropConstraint("donations", "donations_claim_status_check");
  pgm.addConstraint(
    "donations",
    "donations_claim_status_check",
    "CHECK (claim_status IN ('not_eligible','eligible','batched','claimed'))",
  );
};
