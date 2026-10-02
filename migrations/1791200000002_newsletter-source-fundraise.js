/* eslint-disable camelcase */

// TASK-493: someone who ticks the newsletter box on the fundraising sign up joins the newsletter
// themselves, exactly as from the footer form, but is recorded as having joined from the fundraising
// form: consent_source 'fundraise'.
//
// Additive: widening a CHECK only ENLARGES the accepted set, so no existing row can fail it. The
// constraint is the one 1784800000000_subscriber-lists.js made inline, auto named.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.dropConstraint("list_subscribers", "list_subscribers_consent_source_check");
  pgm.addConstraint("list_subscribers", "list_subscribers_consent_source_check", {
    check: "consent_source IN ('footer', 'import', 'admin', 'fundraise')",
  });
};

// Back to the narrower set: only safe while no row says 'fundraise' (down is never run on production).
exports.down = (pgm) => {
  pgm.dropConstraint("list_subscribers", "list_subscribers_consent_source_check");
  pgm.addConstraint("list_subscribers", "list_subscribers_consent_source_check", {
    check: "consent_source IN ('footer', 'import', 'admin')",
  });
};
