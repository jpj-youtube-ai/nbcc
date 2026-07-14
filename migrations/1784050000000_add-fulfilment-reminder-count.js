/* eslint-disable */
// TASK-222 (business-supporter reminders): additive column tracking how many of the two thank-you
// reminders (a 5-day nudge, then a 14-day last note) a fulfilment record has been sent. Additive /
// expand-contract: ONE brand-new column WITH a NOT NULL DEFAULT 0, so every existing row backfills to
// 0 (none sent) at apply time and a code-level rollback stays safe (golden rule 2). No column is
// dropped, renamed, or made NOT NULL on pre-existing NULL data. Independent of the earlier additive
// migrations (order between them does not matter).
//
// reminder_count: 0 = no reminder sent yet, 1 = the 5-day reminder has been sent, 2 = the 14-day
// reminder has been sent (fully reminded). The daily runner (`npm run reminders`) selects records due
// the next stage and, ONLY after a successful send, advances the count by one under an idempotency
// guard (WHERE reminder_count = stage - 1), so a re-run never double-sends the same stage. Distinct
// from the pre-existing reminder_5_at / reminder_14_at timestamp columns (TASK-205 scaffolding), which
// this feature does not use.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("business_supporter_fulfilment", {
    reminder_count: {
      type: "integer",
      notNull: true,
      default: 0, // 0 = none sent; 1 = 5-day sent; 2 = 14-day sent
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_supporter_fulfilment", "reminder_count");
};
