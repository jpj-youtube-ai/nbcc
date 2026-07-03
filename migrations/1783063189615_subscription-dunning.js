/* eslint-disable */
// TASK-091 (REQ-065): dunning state for a monthly (subscription) donor whose card renewal fails.
// Stripe Smart Retries re-attempts a failed subscription payment ~3 times over ~2 weeks; this
// small table tracks where a subscription is in that lifecycle (active → past_due → lapsed) so
// the platform can reason about at-risk / lapsed monthly gifts. Additive / expand-contract: one
// brand-new table, no existing table touched, so a code-level rollback stays safe (golden rule 2).
// Independent of the earlier additive migrations (order between them does not matter). Mirrors the
// CHECK-constrained lifecycle-status shape of 1783010739790 (declaration_status), but as its own
// table (one row per subscription) rather than columns on donations.
//
// NOTE: the retry cadence itself (~3 attempts over ~2 weeks) is a Stripe Dashboard "Smart Retries"
// setting, NOT an API/config value this service sets — this table only records the outcome Stripe
// reports via webhooks. The pure state machine lives in src/subscriptions/dunning.ts.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "subscription_dunning",
    {
      id: "id",
      donor_id: { type: "integer", notNull: true, references: "donors", onDelete: "RESTRICT" },
      // The Stripe subscription this dunning row tracks — unique (one row per subscription) and
      // indexed (webhooks look it up by subscription id).
      stripe_subscription_id: { type: "text", notNull: true, unique: true },
      status: {
        type: "text",
        notNull: true,
        default: "active",
        check: "status IN ('active','past_due','lapsed')",
      },
      // How many consecutive failed attempts Stripe has reported in the current dunning cycle;
      // reset to 0 when a payment succeeds.
      failed_attempts: { type: "integer", notNull: true, default: 0 },
      // Set when the subscription lapses (retries exhausted); NULL while active/past_due.
      lapsed_at: { type: "timestamptz" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Dunning lifecycle for a monthly subscription's failed renewals (REQ-065)." },
  );
  // stripe_subscription_id is already indexed by its UNIQUE constraint; index donor_id too.
  pgm.createIndex("subscription_dunning", "donor_id");
};

exports.down = (pgm) => {
  pgm.dropTable("subscription_dunning");
};
