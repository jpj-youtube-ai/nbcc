/* eslint-disable */
// TASK-138 (REQ-058 follow-up): per-donation GASDS claim tracking. Additive / expand-contract: one
// brand-new NULLABLE column on donations, so every existing row back-fills to NULL without touching
// any existing column (safe on populated data). No column is dropped, renamed or made NOT NULL on
// existing data, so a code-level rollback stays safe (golden rule 2). Independent of the earlier
// additive migrations; order between them does not matter. Mirrors 1783014186353 (gasds_eligible).
//
// gasds_claimed_at stamps WHEN a GASDS-eligible small donation was marked as counted toward a GASDS
// top-up claim (top-ups are pooled per tax year; NBCC records which small gifts it has claimed on).
// It lets the GASDS-deadline admin queue (src/db/admin.ts) omit already-claimed gifts. NULL = not
// yet claimed. Set by the admin mark-claimed action; never set on ingestion.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("donations", {
    gasds_claimed_at: { type: "timestamptz", notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("donations", "gasds_claimed_at");
};
