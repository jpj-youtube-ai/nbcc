/* eslint-disable camelcase */

// TASK-313 (plan 5): guest details for the Festive Ball.
//
// After paying, the booker gets an emailed link to name their guests and tell us about dietary
// and access needs. Those two are SPECIAL CATEGORY data under UK GDPR — an allergy is health
// information and an access need can reveal a disability — so this migration carries the
// retention rule with the columns rather than leaving it to a policy document: `expires_at`
// defaults to 90 days after the event and a later sweep deletes on it.
//
// The booker reaches the form with an unguessable token on the booking, mirroring the
// business-certificate idiom (src/routes/business.ts): no login, no password, and a token that
// resolves to exactly one booking.
//
// EXPAND ONLY: one new table plus two nullable columns on ball_bookings.

exports.up = (pgm) => {
  pgm.addColumns("ball_bookings", {
    guest_token: {
      type: "text",
      unique: true,
      comment:
        "TASK-313: unguessable token in the 'tell us about your table' email link. NULL until " +
        "the booking is paid and the link is minted.",
    },
    table_name: {
      type: "text",
      comment: "TASK-313: optional name for the table plan, e.g. 'Ayrshire Bakery'.",
    },
  });
  pgm.createIndex("ball_bookings", "guest_token");

  pgm.createTable("ball_guests", {
    id: "id",
    booking_id: {
      type: "integer",
      notNull: true,
      references: "ball_bookings",
      onDelete: "CASCADE",
      comment: "Deleting a booking takes its guests with it — they have no meaning alone.",
    },
    full_name: { type: "text", notNull: true },
    dietary: {
      type: "text",
      comment:
        "SPECIAL CATEGORY (health). Shared with the venue only as far as catering needs, and " +
        "deleted on expires_at.",
    },
    access_needs: {
      type: "text",
      comment: "SPECIAL CATEGORY (may reveal a disability). Same handling as dietary.",
    },
    expires_at: {
      type: "timestamptz",
      notNull: true,
      // The ball is 7 Nov 2026; 90 days after that is 5 Feb 2027. A default rather than a
      // computed sweep window, so every row states its own deletion date and a later change of
      // event date cannot silently extend retention on rows already collected.
      default: "2027-02-05T00:00:00Z",
      comment:
        "TASK-313: 90 days after the event, per the published ticket terms. A sweep deletes " +
        "rows past this date.",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("ball_guests", "booking_id");
  pgm.createIndex("ball_guests", "expires_at");
};

exports.down = (pgm) => {
  pgm.dropTable("ball_guests");
  pgm.dropColumns("ball_bookings", ["guest_token", "table_name"]);
};
