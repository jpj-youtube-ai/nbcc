/* eslint-disable camelcase */

// Where a gift was started on the website, so gifts from the Fill a Red Bag page (/fill) can be told
// apart from gifts on the ordinary Donate page and the two compared later.
//
//   donations.source   'red_bag' for a gift started on Fill a Red Bag. Null for every other gift, and
//                      for every gift recorded before this: null means "not recorded", which today
//                      is the ordinary routes. The allowed values live in one list in the code
//                      (DONATION_SOURCES, src/db/stripe-webhook-model.ts).
//
// Nothing fills it in here. The Stripe webhook writes it with one separate statement AFTER the
// donation has been saved and committed (tagDonationSource, src/db/stripe-webhook.ts), so the
// donation's own INSERT does not name this column and is exactly what it was. Earlier Fill a Red Bag
// gifts can only be found from Stripe (README, "Recording where a gift came from").
//
// No check constraint, on purpose: a value the database refused could only ever fail that one
// best-effort statement, and a list that grows should not need a migration each time.
//
// The index is small: it only holds the rows that have a source.
//
// Additive only: one nullable column with no default (a change to the table's description only, no
// rewrite of the rows) and one index, so a code rollback is safe: old code neither reads nor writes
// the column (golden rule 2). Numbered 1791200000250: after the 240 on main.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("donations", {
    source: {
      type: "text",
      comment:
        "Where the gift was started on the website, e.g. 'red_bag' (Fill a Red Bag). NULL = not recorded / the ordinary routes.",
    },
  });
  pgm.createIndex("donations", "source", { where: "source IS NOT NULL" });
};

exports.down = (pgm) => {
  pgm.dropIndex("donations", "source", { ifExists: true });
  pgm.dropColumns("donations", ["source"], { ifExists: true });
};
