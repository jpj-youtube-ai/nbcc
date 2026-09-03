/* eslint-disable camelcase */

// TASK-405: which volunteer this business belongs to, in a form the system can match.
//
// `owner` has always been a display name chosen from the SIGNERS list - the people who sign
// thank-you letters. That is the wrong list twice over: a volunteer who does outreach but never
// signs a letter cannot be assigned anything, and a name cannot be compared to the email address
// a session is identified by. So "show me my businesses" was not answerable at all.
//
// This column is the answer. `owner` stays as the human label on screen; `owner_email` is what
// "mine" is matched on. Both, rather than replacing one with the other, because the display name
// is what a volunteer recognises and the address is what the machine can join on.
//
// Additive and nullable (expand-contract): existing rows keep their display name and simply have
// no owner_email until somebody reassigns them, which reads correctly as "nobody's yet".

exports.up = (pgm) => {
  pgm.addColumn("business_outreach", {
    owner_email: {
      type: "text",
      comment:
        "The volunteer's sign-in address. What 'my businesses' matches on; `owner` remains the " +
        "display name shown on screen.",
    },
  });
  // The todo list filters on it every time the screen opens, and a partial index keeps out the
  // unassigned rows, which are the majority early on.
  pgm.createIndex("business_outreach", "owner_email", {
    where: "owner_email IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("business_outreach", "owner_email");
};
