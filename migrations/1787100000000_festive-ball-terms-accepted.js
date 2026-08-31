/* eslint-disable camelcase */

// TASK-331: record WHEN a buyer agreed to the ticket terms.
//
// A link saying "see the ticket terms" makes them available. It does not show that anyone read
// them, and these terms carry an onerous one: tickets are NON-REFUNDABLE, on purchases up to
// £1,000 a table. Under the Consumer Rights Act an unusual or onerous term has to be brought
// to the consumer's attention, not merely made findable, so the page now asks for a positive
// act — an unticked, required box — and this column records that it happened and when.
//
// The point of the column is the moment it becomes useful: a dispute months later, where the
// question is not "were the terms on the site" but "did this buyer agree to them". A row
// carrying a timestamp answers that; a link in a footer does not.
//
// NULLABLE on purpose. Bookings taken before today have no such record and must not be given
// a fabricated one, and a NULL is the honest way to say "we cannot show this for this
// booking".

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("ball_bookings", {
    terms_accepted_at: {
      type: "timestamptz",
      comment:
        "When the buyer ticked the terms box. NULL for bookings taken before TASK-331, and " +
        "for any booking created without one.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_bookings", ["terms_accepted_at"]);
};
