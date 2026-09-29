/* eslint-disable camelcase */

// TASK-444: record who a thank-you letter was copied to.
//
// cc_email was accepted by the send route and then thrown away — used to address the email and
// never stored. So "was anybody copied in on that?" had no answer, and the admin history could only
// show who SENT it. For a letter that goes to a donor about their own money, who else saw it is a
// reasonable thing to be able to look up.
//
// Additive and nullable (expand-contract, golden rule 2): existing rows stay NULL, which reads
// correctly as "we do not know" rather than as "nobody was copied in" — because for letters sent
// before this column existed, we genuinely do not know. Nothing is backfilled for that reason.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("thank_you_sent", {
    cc_email: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("thank_you_sent", ["cc_email"]);
};
