/* eslint-disable camelcase */

// TASK-485: paying for the Festive Ball by bank transfer, stage 2 (deadlines; see
// docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md).
//
// Additive only (golden rule 2), both nullable:
//   ball_bookings.transfer_reminder_sent_at  when the "please pay by" reminder went, so the daily job
//                                            sends it once.
//   ball_settings.transfer_last_day          the last day transfers may arrive (UK date). Every
//                                            deadline shortens to fit it, and after it the page
//                                            offers card only. Null means no last day.
//
// Numbered 1791000000002: after the site analytics migrations (1791000000000/1), which reached main
// while this was in review. A migration must never sort before one production has already run, and
// those run on production first.

exports.up = (pgm) => {
  pgm.addColumns("ball_bookings", {
    transfer_reminder_sent_at: { type: "timestamptz" },
  });
  pgm.addColumns("ball_settings", {
    transfer_last_day: { type: "date" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_settings", ["transfer_last_day"]);
  pgm.dropColumns("ball_bookings", ["transfer_reminder_sent_at"]);
};
