/* eslint-disable */
// TASK-096 (REQ-059): a Gift Aid declaration can be revoked, or superseded by a corrected one
// (editing a declaration never mutates the immutable row — REQ-046 — it supersedes it). This
// migration lays the two columns that record that, on the existing declarations table
// (1782923222001). Additive / expand-contract, safe on populated data (golden rule 2): two brand-
// new NULLABLE columns, so every existing declaration back-fills to NULL and no existing column is
// dropped, renamed or made NOT NULL. Independent of the earlier additive migrations (order between
// them does not matter). Mirrors the additive nullable-column style of 1783054395270
// (donor-billing-address) and the nullable-token-with-FK style of 1783010739790.
//
// The pure revocation/supersession state logic and the audited write that sets these (through
// writeWithAudit in src/db/donations.ts) are LATER tasks — this only lays the columns.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("declarations", {
    // When the declaration was revoked; NULL while it is still active (REQ-059).
    revoked_at: { type: "timestamptz" },
    // The declaration that REPLACES this one when a donor corrects/re-makes it (editing creates a
    // NEW immutable row and points the old one here). NULLABLE self-FK to declarations(id),
    // onDelete RESTRICT so a superseding declaration cannot be deleted while an old row references it.
    superseded_by_declaration_id: {
      type: "integer",
      references: "declarations",
      onDelete: "RESTRICT",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("declarations", ["revoked_at", "superseded_by_declaration_id"]);
};
