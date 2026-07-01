/* eslint-disable */
// TASK-048 (REQ-036): the idempotency ledger the unified platform de-dups webhook
// deliveries against — "a resent event never double-creates a donation". Additive
// / expand-contract: one brand-new table, no existing table touched, so a
// code-level rollback stays safe (golden rule 2). Independent of the TASK-045
// migration (order between additive migrations does not matter).
//
// The dedup helper (src/webhooks/idempotency.ts) CLAIMS an event id here with
// INSERT … ON CONFLICT (stripe_event_id) DO NOTHING inside the SAME transaction as
// the donation state write (composing with TASK-045's writeWithAudit), so a first
// delivery is claimed and a redelivery is a no-op. processed_at is stamped once the
// event's state write commits, distinguishing claimed-and-done from merely seen.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "webhook_events",
    {
      id: "id",
      stripe_event_id: { type: "text", notNull: true, unique: true }, // the Stripe evt_… id
      type: { type: "text", notNull: true }, // the event type (e.g. charge.refunded)
      received_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      processed_at: { type: "timestamptz" }, // set when the event's state write commits
    },
    { comment: "Webhook idempotency ledger keyed by a UNIQUE stripe_event_id (REQ-036)." },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("webhook_events");
};
