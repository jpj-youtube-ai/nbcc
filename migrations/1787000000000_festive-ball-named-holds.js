/* eslint-disable camelcase */

// TASK-324: holds you can actually account for.
//
// Until now "held back" was a single number on ball_settings. It reserved seats but recorded
// nothing about them — not who they were for, not why, not until when. In practice that number
// only ever goes up: nobody dares reduce it because nobody remembers what it was covering, and
// by November the room is short of seats no one can explain.
//
// This is the same reservation, with the three facts that make it releasable: WHO it is for,
// HOW MUCH, and UNTIL WHEN. The commonest case is a company that asked to be invoiced — their
// tables have to be off sale while the invoice is settled, and back on sale if it never is.
//
// held_seats stays and still works. Total held = held_seats + the active rows here, so this is
// purely additive and the old number can be retired later once the holds it stood for have
// been written down properly.
//
// A hold is ACTIVE while released_at IS NULL and it has not expired. Expiry is by clause, not
// by a job: nothing has to run for seats to come back, so a hold cannot outlive its deadline
// because a sweeper failed.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("ball_holds", {
    id: "id",
    name: {
      type: "text",
      notNull: true,
      comment: "Who the seats are for, e.g. 'Ayrshire Bakery (invoice #1042)'.",
    },
    kind: { type: "text", notNull: true, comment: "'seat' or 'table'." },
    quantity: { type: "integer", notNull: true },
    seats: {
      type: "integer",
      notNull: true,
      comment: "Seats consumed: quantity, or quantity x seats_per_table for whole tables.",
    },
    note: { type: "text", comment: "Why, and anything staff need to chase it." },
    expires_at: {
      type: "timestamptz",
      comment: "When the seats go back on sale by themselves. NULL means held until released.",
    },
    released_at: { type: "timestamptz", comment: "Set when staff hand the seats back early." },
    created_by: { type: "text", notNull: true, comment: "Admin email that placed the hold." },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("ball_holds", "ball_holds_kind_check", { check: "kind IN ('seat', 'table')" });
  pgm.addConstraint("ball_holds", "ball_holds_quantity_check", { check: "quantity > 0" });
  pgm.addConstraint("ball_holds", "ball_holds_seats_check", { check: "seats > 0" });

  // Every availability read sums the active holds, so index what that filters on.
  pgm.createIndex("ball_holds", ["released_at", "expires_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("ball_holds");
};
