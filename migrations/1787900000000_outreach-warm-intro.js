/* eslint-disable camelcase */

// TASK-404: who knows them.
//
// In small-charity fundraising this is the single field that most changes the odds. "Sarah's
// husband plays golf with the owner" turns a cold email into a warm one, and it is knowledge that
// currently lives in one volunteer's head and leaves when they do.
//
// Deliberately separate from `note`. The note is why this business is worth approaching; this is
// the person who can open the door, and it needs to be findable on its own so the call list can
// say "ask Sarah first" rather than burying it in free text nobody re-reads.
//
// Additive and nullable (expand-contract).

exports.up = (pgm) => {
  pgm.addColumn("business_outreach", {
    warm_intro: {
      type: "text",
      comment:
        "Who we know that knows them, in the volunteer's own words. The highest-value field " +
        "on the record and the one most likely to walk out of the door in somebody's head.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_outreach", "warm_intro");
};
