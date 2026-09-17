/* eslint-disable camelcase */

// TASK-418: when each booking was told the menu exists.
//
// Nobody who had already booked was ever told a menu had appeared. The guest link sits in a
// confirmation email from weeks earlier, and the menu turns up behind it silently, so somebody
// who had already filled in their guests had no reason to go back. The kitchen would have got a
// table of names with no dinners against them.
//
// The column IS the idempotency, exactly as reminder_sent_at is for the week-to-go email: the
// send query is "paid AND menu_email_sent_at IS NULL", so pressing the button twice finds nobody
// the second time. Stamped per booking AS EACH SEND SUCCEEDS rather than in one batch at the
// end, so a provider failing halfway through four hundred never re-emails the ones already done.
//
// Its own column rather than reusing reminder_sent_at: the two emails are sent weeks apart, for
// different reasons, and sharing a stamp would mean sending one silently disabled the other.
//
// EXPAND ONLY: one nullable column, nothing dropped.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("ball_bookings", {
    menu_email_sent_at: {
      type: "timestamptz",
      comment:
        "TASK-418: when the 'the menu is here' email was sent for this booking. NULL means it " +
        "has not been, and is what the send query selects on.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_bookings", ["menu_email_sent_at"]);
};
