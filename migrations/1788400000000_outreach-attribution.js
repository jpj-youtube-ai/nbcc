/* eslint-disable camelcase */

// TASK-413: the two facts the reports need and nothing was recording.
//
// donor_id — WHICH donor a business became. Without it, "how much did outreach raise?" can only be
// answered by matching names, and a fuzzy match is not a figure anybody should put in front of
// trustees: it misses a firm trading under a different name and wrongly joins two similar ones.
// Set at the moment a volunteer records "Signed up" and picks the donor, which is not a guess -
// it is a person stating something they know, and it is then permanent.
//
// The alternative was a referral code on the donate link, carried through Stripe checkout into the
// donation. It buys automation rather than accuracy, and it costs a change to the payment path -
// the highest-risk change available here - for a reporting figure. This is exact without touching
// the money.
//
// sent_with_personal_message — whether the volunteer wrote a line of their own. The personal
// message itself is deliberately NOT stored: it is one line to one business, we have no reason to
// keep it, and the assessment promises we hold only what we need. But whether there WAS one is the
// difference between a letter and a mailshot, and it is the only way to ever answer "does taking
// the extra minute actually help?".
//
// Additive and nullable (expand-contract).

exports.up = (pgm) => {
  pgm.addColumn("business_outreach", {
    donor_id: {
      type: "integer",
      references: "donors",
      onDelete: "SET NULL",
      comment:
        "Which donor this business became, linked by a volunteer when they recorded the sign-up. " +
        "SET NULL on donor deletion: losing the link is right, losing the outreach history is not.",
    },
    sent_with_personal_message: { type: "boolean" },
  });
  // Every report groups or joins on it, and it is null for most rows.
  pgm.createIndex("business_outreach", "donor_id", { where: "donor_id IS NOT NULL" });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_outreach", ["donor_id", "sent_with_personal_message"]);
};
