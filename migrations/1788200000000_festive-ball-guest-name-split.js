/* eslint-disable camelcase */

// TASK-409: a guest's first name and surname, kept separately.
//
// The "tell us about your table" form was the last single-name box on the site. TASK-318 split
// the BUYER's name for two reasons that apply just as much to their guests:
//
//   1. There is no reliable way back out of one box. Splitting on the last space turns
//      "Ali van der Berg" into the surname "Berg" and "Dr Jo Smith" into the first name "Dr",
//      so a door list sorted by surname is quietly wrong for exactly the people it is most
//      awkward to get wrong in front of a queue.
//   2. The door list on the night is read by a volunteer looking for a surname, and the venue's
//      table plan is sorted the same way.
//
// EXPAND ONLY, exactly as TASK-318 did it. Both columns are NULLABLE and `full_name` stays in
// place and is still written, holding "First Surname". Every existing reader keeps working
// untouched: the door list, the CSV exports, the reminder email's read-back and the admin
// table all continue to read full_name and see no change. Rows written before this keep their
// single name with NULLs beside it, and the form shows them a best-effort split of it for the
// booker to correct. Dropping full_name would be a later, separate release, if ever.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("ball_guests", {
    first_name: {
      type: "text",
      comment: "Given name, as typed. NULL for guest rows saved before TASK-409.",
    },
    surname: {
      type: "text",
      comment: "Family name, as typed. NULL for guest rows saved before TASK-409.",
    },
  });
};

// No index on surname, deliberately, though TASK-318 added one on buyer_surname. The door list
// is sorted in JavaScript after the rows are read (src/ball/exports.ts), not by the database,
// and the whole guest table for one event is a few hundred rows. An index nothing queries on is
// weight on every write for no read.

exports.down = (pgm) => {
  pgm.dropColumns("ball_guests", ["first_name", "surname"]);
};
