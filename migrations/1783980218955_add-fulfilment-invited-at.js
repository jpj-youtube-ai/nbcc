/* eslint-disable */
// TASK-214 (business-supporter invite backfill): the "invited" tracking that makes the one-time,
// admin-triggered catch-up backfill safe to run without double-emailing anyone. Additive /
// expand-contract: ONE brand-new NULLABLE column on the existing business_supporter_fulfilment
// table (TASK-205, migration 1783961442118), with NO default and NO data backfill — existing rows
// stay NULL. No column is dropped, renamed or made NOT NULL on populated data, so a code-level
// rollback stays safe (golden rule 2). Independent of the earlier additive migrations (order between
// them does not matter).
//
// invited_at is stamped now() the moment a fulfilment record's thank-you INVITE has been sent: by
// the going-forward Stripe webhook auto-invite after a successful send (TASK-213 wiring), and by the
// admin catch-up backfill after it sends to a previously un-invited supporter. NULL means "never
// invited" — the backfill's un-invited query selects exactly those (invited_at IS NULL), so a failed
// send leaves the row NULL and catchable on a later run, and a second backfill run sends 0. Mirrors
// the nullable-timestamptz captured_at column already on this table.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("business_supporter_fulfilment", {
    invited_at: { type: "timestamptz" }, // NULL = the thank-you invite has not been sent yet
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_supporter_fulfilment", "invited_at");
};
