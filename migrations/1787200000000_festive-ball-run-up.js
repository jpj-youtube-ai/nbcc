/* eslint-disable camelcase */

// TASK-338: the run-up to the night.
//
// Guest names, dietary requirements and access needs come back from BUYERS, and most of a table
// of ten is filled in because one person chased nine others. Until now nothing drove that: staff
// had one manual button that sent one email once, and no deadline to point at.
//
// Four additive, nullable columns. Nullable is not laziness — every existing booking genuinely
// has no value for these, and a default would claim we had emailed people we had not.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("ball_settings", {
    // The date the venue needs final numbers by. NULL means "not decided yet", which is the
    // honest state until NBCC agrees it with The Park Hotel — and the run-up deliberately sends
    // NOTHING while it is NULL rather than inventing a deadline to chase people towards.
    guest_details_lock_at: {
      type: "timestamptz",
      comment:
        "When guest details close, agreed with the venue. NULL until set; no chase emails are " +
        "sent while it is NULL, because a chase with no date to give is just nagging.",
    },
  });

  pgm.addColumns("ball_bookings", {
    // Sent every time a buyer saves the guest form: their own read-back of what we now hold.
    // Not a one-shot flag, a LAST-SENT stamp, because they can come back and change it.
    guest_summary_sent_at: {
      type: "timestamptz",
      comment: "When the buyer was last emailed a read-back of the guest details they saved.",
    },
    // Stage one of the chase: sent once, a fortnight before the lock date.
    guest_chase_sent_at: {
      type: "timestamptz",
      comment: "When this booking was sent the first 'we still need your guests' email.",
    },
    // Stage two: the last call, at the lock date itself.
    guest_final_call_sent_at: {
      type: "timestamptz",
      comment: "When this booking was sent the final call before guest details closed.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_settings", ["guest_details_lock_at"]);
  pgm.dropColumns("ball_bookings", [
    "guest_summary_sent_at",
    "guest_chase_sent_at",
    "guest_final_call_sent_at",
  ]);
};
