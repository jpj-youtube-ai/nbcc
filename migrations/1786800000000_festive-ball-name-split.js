/* eslint-disable camelcase */

// TASK-318: first name and surname, kept separately.
//
// Both forms asked for "Your name" in one box, matching nothing else on the site — the donate
// and contact forms have taken a first name and surname separately since TASK-226. One box
// costs us two things:
//
//   1. There is no reliable way back out. Splitting on the last space turns "Jo van der Berg"
//      into the surname "Berg" and "Dr Jo Smith" into the first name "Dr", so any list sorted
//      by surname is quietly wrong for exactly the people it is most awkward to get wrong.
//   2. Emails cannot greet someone properly. "Hello Jo Smith" is what a system writes; "Hello
//      Jo" is what a person writes, and this is a party invitation.
//
// EXPAND ONLY. The new columns are NULLABLE and the existing buyer_name / name columns are
// left in place and still written, holding "First Surname". Every existing reader — the
// confirmation email, the door list, the guest page, the CSV exports — keeps working
// untouched, and rows written before this migration keep their single name with NULLs
// beside it. Dropping the old column is a later, separate release, if ever.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("ball_bookings", {
    buyer_first_name: {
      type: "text",
      comment: "Given name, as typed. NULL for bookings taken before TASK-318.",
    },
    buyer_surname: {
      type: "text",
      comment: "Family name, as typed. NULL for bookings taken before TASK-318.",
    },
  });

  pgm.addColumns("ball_waiting_list", {
    first_name: { type: "text", comment: "Given name. NULL for entries before TASK-318." },
    surname: { type: "text", comment: "Family name. NULL for entries before TASK-318." },
  });

  // Sorting a door list or a bookings export by surname is the whole point of storing it
  // apart, and both are read far more often than they are written.
  pgm.createIndex("ball_bookings", "buyer_surname");
};

exports.down = (pgm) => {
  pgm.dropIndex("ball_bookings", "buyer_surname");
  pgm.dropColumns("ball_waiting_list", ["first_name", "surname"]);
  pgm.dropColumns("ball_bookings", ["buyer_first_name", "buyer_surname"]);
};
