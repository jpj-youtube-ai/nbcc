/* eslint-disable camelcase */

// TASK-321: donors may offer to cover Stripe's card fee, the way ticket buyers already can.
//
// The money it collects is NOT part of the donation, and this column is the reason it can
// never be mistaken for one. Two things depend on keeping them apart:
//
//  1. **Gift Aid.** The claim sums amount_pence. Folding a fee cover into that would claim
//     tax relief on money we are not treating as a gift — an HMRC matter, not a rounding
//     one. Under-claiming a few pence is safe; over-claiming is not.
//  2. **GASDS.** Eligibility is judged per donation against a £30 ceiling. A £30 gift with
//     56p of fee cover added on top must stay a £30 gift, or it silently drops out of the
//     small-donations scheme.
//
// This matters more than it looks because the webhook records the amount from Stripe's
// `amount_total`, which is the sum of EVERY line item. A fee-cover line would therefore
// inflate the recorded donation by default. The webhook subtracts this figure back out.
//
// EXPAND ONLY: one nullable-by-default column. Existing rows get 0, which is exactly true of
// every donation taken before today, and code that has not been deployed yet ignores it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("donations", {
    fee_cover_pence: {
      type: "integer",
      notNull: true,
      default: 0,
      comment:
        "Voluntary contribution towards Stripe's card fee. NOT part of the gift: excluded from " +
        "amount_pence, from the Gift Aid claim and from the GASDS £30 test.",
    },
  });

  // A negative fee cover would silently inflate the donation when the webhook subtracts it.
  pgm.addConstraint("donations", "donations_fee_cover_pence_nonneg", {
    check: "fee_cover_pence >= 0",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("donations", "donations_fee_cover_pence_nonneg");
  pgm.dropColumns("donations", ["fee_cover_pence"]);
};
