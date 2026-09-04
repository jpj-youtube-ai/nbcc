/* eslint-disable camelcase */

// TASK-414: the one follow-up, and the record that it has been used.
//
// A business that has not replied gets ONE more email and then is left alone. The cap is the
// column: once nudge_sent_at is set the business drops off the chase list for good, so nobody can
// keep nudging by accident and nobody has to remember how many have already gone.
//
// It is prepared rather than sent automatically. Everything else on this screen is "always by a
// person", and a follow-up that went out on a timer would be the one thing that was not - which
// is also the thing a business would notice, because a second unanswered email from a machine
// reads very differently from a second one from somebody who meant it.
//
// Additive and nullable (expand-contract).

exports.up = (pgm) => {
  pgm.addColumn("business_outreach", {
    nudge_sent_at: {
      type: "timestamptz",
      comment:
        "When the single follow-up went. Set once; its presence is what stops the business ever " +
        "appearing on the chase list again.",
    },
    nudge_sent_by: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_outreach", ["nudge_sent_at", "nudge_sent_by"]);
};
