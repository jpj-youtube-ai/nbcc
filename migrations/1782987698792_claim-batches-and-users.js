/* eslint-disable */
// TASK-056 (REQ-037/REQ-052/REQ-062): the claim_batches + users tables and the
// one-batch-per-donation invariant — the follow-up the unified-donation-model
// migration (1782923222001) deliberately named but did not build. Additive /
// expand-contract: two brand-new tables plus a single NULLABLE FK column on
// donations. No existing donors/declarations/donations/audit_log column is
// dropped, renamed or made NOT NULL, so a code-level rollback stays safe
// (golden rule 2). Independent of the earlier additive migrations (order between
// them does not matter).
//
// The pipeline that assembles/submits batches (REQ-052 Charities Online export)
// and the admin RBAC that gates it (REQ-062) are NOT built here — this only lays
// the shared model rows they will write through.

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ---- claim_batches: a batch of eligible donations submitted to HMRC together ----
  // Carries the Charities Online export identity (REQ-052): the regulator (OSCR),
  // NBCC's charity number (SC047995) and its HMRC reference. regulator/charity_number
  // are known constants so they default in; hmrc_reference is nullable (configured
  // when a batch is prepared). status walks open → submitted, with adjustment_due for
  // the REQ-063 adjustment queue. A batch begins open (default).
  pgm.createTable(
    "claim_batches",
    {
      id: "id",
      status: {
        type: "text",
        notNull: true,
        default: "open",
        check: "status IN ('open', 'submitted', 'adjustment_due')", // REQ-052/REQ-063
      },
      submitted_at: { type: "timestamptz" }, // set when the batch is uploaded to Charities Online
      regulator: { type: "text", notNull: true, default: "OSCR" }, // the charity regulator (REQ-052)
      charity_number: { type: "text", notNull: true, default: "SC047995" }, // NBCC's OSCR number (REQ-052)
      hmrc_reference: { type: "text" }, // NBCC's HMRC reference, set when the claim is prepared (REQ-052)
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "A Charities Online claim batch of eligible donations (REQ-052)." },
  );

  // ---- users: the minimal core-model row for an admin/staff account ----
  // role is captured with a check constraint only; REQ-062 owns the actual RBAC
  // enforcement (Viewer read-only / Editor edit+queues / Admin + claims + user mgmt)
  // and the admin back-end — none of that is built here. A new user defaults to the
  // least-privilege viewer role.
  pgm.createTable(
    "users",
    {
      id: "id",
      email: { type: "text", notNull: true, unique: true },
      full_name: { type: "text", notNull: true },
      role: {
        type: "text",
        notNull: true,
        default: "viewer",
        check: "role IN ('viewer', 'editor', 'admin')", // REQ-062 owns role behaviour/enforcement
      },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Admin/staff accounts; RBAC enforcement is owned by REQ-062, not this table." },
  );

  // ---- donations.claim_batch_id: the one-batch-per-donation link (REQ-037) ----
  // A single NULLABLE FK is the whole invariant "a donation enters at most one claim
  // batch": one column can hold at most one batch reference. NULL until the donation
  // is batched; RESTRICT so a batch cannot be deleted while donations point at it.
  // claim_status already carries the 'batched'/'claimed' lifecycle values (no enum
  // change needed). Additive: nullable column, no existing shape touched.
  pgm.addColumn("donations", {
    claim_batch_id: { type: "integer", references: "claim_batches", onDelete: "RESTRICT" },
  });
  pgm.createIndex("donations", "claim_batch_id");
};

exports.down = (pgm) => {
  // Reverse order: drop the donations FK column (removes its index too) before the
  // table it references, then the independent users table.
  pgm.dropColumn("donations", "claim_batch_id");
  pgm.dropTable("users");
  pgm.dropTable("claim_batches");
};
