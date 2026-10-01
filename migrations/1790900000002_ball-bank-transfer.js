/* eslint-disable camelcase */

// TASK-484: paying for the Festive Ball by bank transfer (stage 1 of five; see
// docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md).
//
// Additive only (golden rule 2): new columns with defaults or nullable, and nothing else.
//   ball_bookings
//     payment_method  'card' for every existing row and every Stripe booking; 'transfer' for a booking
//                     paid by bank transfer, which stays 'pending' until an admin marks it paid.
//     pay_by          the date a transfer should arrive by (UK date). Null for card bookings.
//     marked_paid_by  who marked a transfer paid. Null for card bookings, which Stripe confirms.
//     cancelled_from  the status a booking had when staff cancelled it. Only a transfer cancelled
//                     while still unpaid may be brought back when its money arrives; one that had been
//                     paid and was cancelled (and refunded by hand) must not be.
//   ball_settings
//     transfer_on and the three bank details. Kept here, not in code: this repository is public.
//
// Numbered one above the highest on main (1790900000001), and deliberately BELOW the analytics
// migrations in the open PR #602 (1791000000000/1). A migration fails on production when it sorts
// before one already run, so whichever merges SECOND must sort higher. This one merges first; the
// analytics work is waiting on the client, and will then sort after this without renumbering. If the
// analytics PR were somehow to merge first, renumber this one above it before merging.

exports.up = (pgm) => {
  pgm.addColumns("ball_bookings", {
    payment_method: { type: "text", notNull: true, default: "card" },
    pay_by: { type: "date" },
    marked_paid_by: { type: "text" },
    cancelled_from: { type: "text" },
  });
  pgm.addConstraint("ball_bookings", "ball_bookings_payment_method_check", {
    check: "payment_method IN ('card', 'transfer')",
  });
  pgm.createIndex("ball_bookings", ["payment_method", "status"]);

  pgm.addColumns("ball_settings", {
    transfer_on: { type: "boolean", notNull: true, default: false },
    transfer_account_name: { type: "text" },
    transfer_sort_code: { type: "text" },
    transfer_account_number: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_settings", [
    "transfer_on",
    "transfer_account_name",
    "transfer_sort_code",
    "transfer_account_number",
  ]);
  pgm.dropIndex("ball_bookings", ["payment_method", "status"]);
  pgm.dropConstraint("ball_bookings", "ball_bookings_payment_method_check");
  pgm.dropColumns("ball_bookings", ["payment_method", "pay_by", "marked_paid_by", "cancelled_from"]);
};
