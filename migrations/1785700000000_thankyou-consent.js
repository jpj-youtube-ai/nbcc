/* eslint-disable camelcase */

// TASK-291: split a donor's email consent so the newsletter and thank-you letters can be turned off
// independently. Until now one `email_consent` flag gated both, so a donor who only wanted the
// newsletter to stop had to lose their thank-you letters too.
//
// EXPAND ONLY.
//   - `email_consent` keeps its exact meaning for the NEWSLETTER. Every existing query that reads it
//     (listNewsletterRecipients, the donor audience) is untouched and still correct.
//   - `thankyou_consent` is new and gates thank-you letters only.
//
// The backfill is the part that matters: it copies email_consent rather than defaulting everyone to
// true. Someone who had opted out of everything must NOT start receiving thank-you letters again
// because we split a column — that would be us re-subscribing a person who asked us to stop.

exports.up = (pgm) => {
  pgm.addColumn("donors", {
    thankyou_consent: {
      type: "boolean",
      notNull: true,
      default: true,
      comment:
        "TASK-291: consent for THANK-YOU letters specifically. email_consent continues to gate the " +
        "newsletter. Backfilled from email_consent so an existing opt-out is preserved.",
    },
  });
  // Preserve every existing opt-out. The DEFAULT above only covers rows written from now on.
  pgm.sql("UPDATE donors SET thankyou_consent = email_consent");
};

exports.down = (pgm) => {
  pgm.dropColumn("donors", "thankyou_consent");
};
