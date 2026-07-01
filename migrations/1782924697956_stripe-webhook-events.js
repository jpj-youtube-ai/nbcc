/* eslint-disable */
// TASK-046 (REQ-036): idempotency ledger for the single Stripe webhook handler.
// Additive / expand-contract — one brand-new table, no existing table touched.
// Every processed Stripe event id is recorded here inside the same transaction as
// its state write, so a redelivered event (Stripe retries aggressively) is a
// no-op: the INSERT hits the primary-key conflict and the handler skips it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "stripe_webhook_events",
    {
      id: { type: "text", primaryKey: true }, // the Stripe event id (evt_…)
      type: { type: "text", notNull: true }, // the event type (e.g. charge.refunded)
      received_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Processed Stripe webhook event ids — the idempotency ledger (REQ-036)." },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("stripe_webhook_events");
};
