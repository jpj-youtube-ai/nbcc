/* eslint-disable */
// TASK-206 (business-supporter fulfilment — webhook wiring): the per-business secure thank-you
// link token on the fulfilment record. Additive / expand-contract: ONE brand-new NULLABLE column
// on the brand-new business_supporter_fulfilment table (TASK-205, migration 1783961442118), with a
// UNIQUE constraint. No existing column is dropped, renamed or made NOT NULL on populated data, so
// a code-level rollback stays safe (golden rule 2). Independent of the earlier additive migrations
// (order between them does not matter).
//
// token is the unguessable per-business token for the secure thank-you link. The app sets it via
// randomUUID() when it first creates a fulfilment record for a business monthly gift
// (src/db/fulfilment.ts). NULLABLE (the app fills it in on insert, and the table is brand-new so
// there are no existing rows to backfill) and UNIQUE (Postgres allows many NULLs under a unique
// constraint, so any token-less row does not collide) — a set token addresses exactly one supporter.
// Mirrors the nullable-unique donations.declaration_token column (migration 1783010739790).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("business_supporter_fulfilment", {
    token: { type: "text", unique: true },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_supporter_fulfilment", "token");
};
