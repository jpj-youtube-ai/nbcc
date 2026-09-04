/* eslint-disable camelcase */

// TASK-412: the record that somebody checked a number against the TPS register before ringing it.
//
// Calling a business registered with the Corporate TPS is an offence, and the register is the
// charity's responsibility to check rather than the volunteer's to remember. Screening in bulk
// needs a paid licence we are not going to buy at this volume, so the control is the honest one:
// the number is not shown until a volunteer confirms they have checked it on the free lookup, and
// that confirmation is kept with their name and the date.
//
// It is a record, not a permission. Nothing here stops a determined person ringing a number they
// found elsewhere; what it does is make the check a deliberate act and leave evidence that it
// happened, which is what we would be asked for.
//
// The legitimate-interests assessment promises exactly this
// (docs/legitimate-interests-assessment-business-outreach.md, section 5).
//
// Additive and nullable (expand-contract).

exports.up = (pgm) => {
  pgm.addColumn("business_outreach", {
    ctps_checked_at: { type: "timestamptz" },
    ctps_checked_by: {
      type: "text",
      comment: "Which volunteer confirmed the TPS check, so it can be asked about later.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_outreach", ["ctps_checked_at", "ctps_checked_by"]);
};
