/* eslint-disable camelcase */

// TASK-313 (plan 5): record when a booker was sent the "a week to go" reminder.
//
// The column exists so the send is IDEMPOTENT. A reminder goes to everyone who has paid, and
// the failure mode staff actually fear is pressing the button twice and emailing four hundred
// people the same thing — so the send skips anyone already stamped, and the stamp is written in
// the same transaction as the send decision.
//
// Staff-triggered rather than scheduled, deliberately: this app has no scheduler, and a cron
// that misfires at 3am against a guest list is a worse failure than a button somebody has to
// press.
//
// EXPAND ONLY: one nullable column.

exports.up = (pgm) => {
  pgm.addColumns("ball_bookings", {
    reminder_sent_at: {
      type: "timestamptz",
      comment:
        "TASK-313: when the pre-event reminder was sent. NULL = not yet. Makes the send " +
        "idempotent so pressing the button twice cannot email everyone twice.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_bookings", ["reminder_sent_at"]);
};
