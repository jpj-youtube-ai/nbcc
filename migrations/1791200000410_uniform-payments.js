/* eslint-disable camelcase */

// Uniform payments (TASK-604). School uniforms the charity supplies are bought through a Stripe payment
// link marked product = uniform. A uniform is a purchase, never a gift, so it gets its own table and is
// in no donation figure, Gift Aid or small donations claim, supporters list or thank you email.
//
//   1. uniform_payments: one row per paid uniform checkout, kept once by its checkout session. Admin >
//      Donations shows them under their own Uniform tile.
//   2. donations_moved_to_uniform: a uniform payment that came in before this was recorded as a
//      donation. The one off script (src/scripts/move-uniform-payments.ts) moves each such donation
//      here, whole, beside the uniform payment made from it, and takes it out of donations, so nothing
//      is lost and the move can be undone.
//
// Both tables are new (additive only, golden rule 2); nothing existing changes shape.

exports.up = (pgm) => {
  pgm.createTable(
    "uniform_payments",
    {
      id: "id",
      stripe_session_id: { type: "text", notNull: true, unique: true, comment: "The checkout session (cs_...) the payment link made." },
      stripe_payment_intent_id: { type: "text", comment: "Stripe's payment (pi_...): its reference, and how a refund finds it." },
      stripe_payment_link_id: { type: "text", comment: "The payment link (plink_...) it was bought through." },
      amount_pence: { type: "integer", notNull: true, check: "amount_pence >= 0" },
      currency: { type: "text", notNull: true, default: "GBP" },
      refunded_amount_pence: {
        type: "integer",
        notNull: true,
        default: 0,
        check: "refunded_amount_pence >= 0",
        comment: "Stripe's total refunded so far.",
      },
      buyer_name: { type: "text" },
      buyer_email: { type: "text" },
      details: {
        type: "jsonb",
        notNull: true,
        default: pgm.func("'[]'::jsonb"),
        comment: "What the buyer filled in on the payment link: [{label, value}], e.g. a child's name or a size.",
      },
      paid_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      moved_from_donation_id: { type: "integer", comment: "The donation it was wrongly recorded as before TASK-604, if any." },
    },
    { comment: "School uniform payments (TASK-604): purchases, never donations." },
  );
  pgm.createIndex("uniform_payments", "stripe_payment_intent_id", { unique: true, where: "stripe_payment_intent_id IS NOT NULL" });
  pgm.createIndex("uniform_payments", "paid_at");

  pgm.createTable(
    "donations_moved_to_uniform",
    {
      donation_id: { type: "integer", primaryKey: true, comment: "The id it had in donations." },
      uniform_payment_id: { type: "integer", notNull: true, references: "uniform_payments", comment: "The uniform payment made from it." },
      donation_row: { type: "jsonb", notNull: true, comment: "Its whole donations row, as it was." },
      moved_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Uniform payments recorded as donations before TASK-604, taken out of donations and kept here." },
  );
};

exports.down = (pgm) => {
  pgm.sql(`INSERT INTO donations SELECT (jsonb_populate_record(NULL::donations, donation_row)).* FROM donations_moved_to_uniform
           ON CONFLICT (id) DO NOTHING`);
  pgm.dropTable("donations_moved_to_uniform");
  pgm.dropTable("uniform_payments");
};
