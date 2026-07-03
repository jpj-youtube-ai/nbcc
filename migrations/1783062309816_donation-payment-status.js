/* eslint-disable */
// TASK-090 (REQ-036/REQ-065): a BACS Direct Debit gift is not settled at checkout — the mandate
// is confirmed asynchronously, so the donation is PENDING until Stripe reports success/failure.
// Additive / expand-contract: one brand-new NOT-NULL column on donations WITH a default('paid'),
// so every existing (card-only) row back-fills to 'paid' without touching any existing column —
// safe on populated data. No column is dropped, renamed or made NOT NULL on existing data, so a
// code-level rollback stays safe (golden rule 2). Independent of the earlier additive migrations
// (order between them does not matter). Mirrors 1783010739790 (declaration_status).
//
// payment_status gates claimability: a donation is only ever claim_status='eligible' when
// payment_status='paid' (the pure rule lives in src/db/donations-model.ts). A BACS gift lands
// 'pending' (Stripe's payment_status='unpaid'), flips to 'paid' on
// checkout.session.async_payment_succeeded, or to 'failed' (permanently non-claimable) on
// checkout.session.async_payment_failed. A card gift is 'paid' at checkout.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("donations", {
    payment_status: {
      type: "text",
      notNull: true,
      default: "paid",
      check: "payment_status IN ('pending','paid','failed')",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("donations", "payment_status");
};
