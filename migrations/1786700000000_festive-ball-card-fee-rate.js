/* eslint-disable @typescript-eslint/no-var-requires */

// TASK-317: the card fee rate becomes data instead of a constant.
//
// The page offers buyers the chance to cover Stripe's fee, so the number it quotes has to be
// the rate NBCC is ACTUALLY charged. It was hardcoded at Stripe's UK standard 1.5% + 20p;
// NBCC is on the charity rate of 1.2% + 20p, so every order was over-collecting ~30p a
// ticket from people who ticked the box. Hardcoding it also means the next rate change is a
// code change and a deploy.
//
// Stored as integer BASIS POINTS, not a float: this file's sibling columns are all integer
// pence and the golden rule for this feature is that no float reaches the database. 120 bp
// = 1.20%.
//
// Additive and defaulted (expand-contract): existing rows get the correct charity rate
// immediately, and code that has not yet been deployed simply ignores the columns.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("ball_settings", {
    card_fee_percent_bp: {
      type: "integer",
      notNull: true,
      default: 120,
      comment: "Stripe percentage fee in basis points. 120 = 1.20% (UK charity rate).",
    },
    card_fee_fixed_pence: {
      type: "integer",
      notNull: true,
      default: 20,
      comment: "Stripe per-transaction fixed fee in pence. Charged ONCE per order, not per ticket.",
    },
  });

  // Bounds rather than blind trust: this number is multiplied by every order total, and a
  // fat-fingered 1200 (12%) would quietly triple what buyers are asked to cover.
  pgm.addConstraint("ball_settings", "ball_settings_card_fee_percent_bp_sane", {
    check: "card_fee_percent_bp >= 0 AND card_fee_percent_bp <= 1000",
  });
  pgm.addConstraint("ball_settings", "ball_settings_card_fee_fixed_pence_sane", {
    check: "card_fee_fixed_pence >= 0 AND card_fee_fixed_pence <= 500",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("ball_settings", "ball_settings_card_fee_fixed_pence_sane");
  pgm.dropConstraint("ball_settings", "ball_settings_card_fee_percent_bp_sane");
  pgm.dropColumns("ball_settings", ["card_fee_percent_bp", "card_fee_fixed_pence"]);
};
