/* eslint-disable camelcase */

// TASK-313 (plan 5): the waiting list.
//
// Worth building rather than pointing people at an inbox: there WILL be drop-outs before
// November, and a seat released in October is only worth something if there is somebody to
// offer it to. An emailed "add me to the list" gets lost; a row does not.
//
// It holds contact details of people who are not customers, so it carries its own retention
// date — 90 days after the event, matching the guest details. Nobody should still be on a
// waiting list for a party that happened.
//
// EXPAND ONLY: one new table.

exports.up = (pgm) => {
  pgm.createTable("ball_waiting_list", {
    id: "id",
    name: { type: "text", notNull: true },
    email: { type: "text", notNull: true },
    seats_wanted: {
      type: "integer",
      notNull: true,
      default: 1,
      comment: "How many places they are after — lets staff match a released table to a group.",
    },
    note: { type: "text", comment: "Anything they told us, e.g. 'happy to split the table'." },
    newsletter_opt_in: {
      type: "boolean",
      notNull: true,
      default: false,
      comment:
        "Separate, unticked consent. Joining a waiting list is not consent to be marketed to, " +
        "and PECR requires the opt-in to be its own affirmative act.",
    },
    offered_at: {
      type: "timestamptz",
      comment: "Stamped when staff offer them a released place, so nobody is offered twice.",
    },
    expires_at: {
      type: "timestamptz",
      notNull: true,
      default: "2027-02-05T00:00:00Z",
      comment: "90 days after the event, matching ball_guests. A sweep deletes on it.",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // One entry per address: pressing the button twice should not put someone on the list twice,
  // and staff should never have to work out which of two rows is current.
  pgm.addConstraint("ball_waiting_list", "ball_waiting_list_email_unique", { unique: ["email"] });
  pgm.createIndex("ball_waiting_list", "expires_at");
};

exports.down = (pgm) => {
  pgm.dropTable("ball_waiting_list");
};
