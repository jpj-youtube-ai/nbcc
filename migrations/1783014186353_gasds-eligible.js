/* eslint-disable */
// TASK-077 (REQ-058): Gift Aid Small Donations Scheme (GASDS) eligibility flag. Additive /
// expand-contract: one brand-new NOT-NULL column on donations WITH a default(false), so every
// existing row back-fills to false without touching any existing column (safe on populated
// data). No column is dropped, renamed or made NOT NULL on existing data, so a code-level
// rollback stays safe (golden rule 2). Independent of the earlier additive migrations (order
// between them does not matter). Mirrors 1783003547726 (benefit_cap_breached) and
// 1783010739790 (declaration_status).
//
// gasds_eligible marks a small cash/contactless-style gift that can be claimed under GASDS
// rather than Gift Aid — a one-off, un-declared, non-Gift-Aided gift of £30 or less (the pure
// rule lives in src/gasds/caps.ts). The code that SETS the flag on ingestion and the claim
// pipeline that reads it are later tasks; this only lays the column.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("donations", {
    gasds_eligible: { type: "boolean", notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("donations", "gasds_eligible");
};
