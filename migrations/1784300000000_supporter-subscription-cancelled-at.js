/* eslint-disable */
// TASK-240 (supporters-wall accuracy): record when a monthly subscription is VOLUNTARILY cancelled,
// distinct from a payment lapse (lapsed_at). The webhook (customer.subscription.deleted on a still-
// active subscription) stamps this so listPublicSupporters can drop the donor from the opt-in wall
// after the grace window (SUPPORTER_GRACE_DAYS). Additive / expand-contract: ONE new NULLABLE column
// on subscription_dunning, no existing data rewritten and no default backfill, so a code-level
// rollback stays safe (golden rule 2). Independent of the other additive migrations (order between
// them does not matter); the old code simply never reads or writes the column.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("subscription_dunning", {
    // Set when the subscription is voluntarily cancelled (customer.subscription.deleted while not yet
    // lapsed); NULL otherwise. Distinct from lapsed_at (retries exhausted). Either column being set
    // means the subscription has ENDED, which the supporters wall reads to drop an opt-in donor after
    // the grace window. A cancel and a lapse are mutually exclusive terminal ends of one subscription.
    cancelled_at: { type: "timestamptz" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("subscription_dunning", "cancelled_at");
};
