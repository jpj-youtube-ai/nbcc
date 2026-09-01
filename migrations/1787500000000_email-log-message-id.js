/* eslint-disable camelcase */

// TASK-346: the SES message id, so a delivery event lands on the row it actually belongs to.
//
// email_log correlates SES delivery/bounce/complaint events to a send by RECIPIENT AND RECENCY:
// newest unmatched row for that address inside a 14-day window. When one person has two recent
// emails that is simply wrong, and it picks the newer one — so a bounce for an older email is
// recorded against a newer one, and the page shows both outcomes inverted.
//
// That stopped being theoretical when TASK-338 started sending a guest-details read-back minutes
// after a ticket confirmation. The page exists to answer "did their confirmation arrive?", which
// is exactly the question it would then answer backwards.
//
// Additive and nullable: rows written before this, and stubbed sends outside production, have no
// id and keep using the old heuristic.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("email_log", {
    ses_message_id: {
      type: "text",
      comment:
        "The id SES returned for this send. NULL for rows written before TASK-346 and for " +
        "stubbed sends; those fall back to matching on recipient and recency.",
    },
  });

  // The webhook looks a row up by this id on every delivery event. Partial, because the column is
  // null for stubbed sends and for everything sent before this shipped, and those rows are never
  // the target of a lookup.
  pgm.createIndex("email_log", ["ses_message_id"], {
    where: "ses_message_id IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("email_log", ["ses_message_id"]);
};
