/* eslint-disable camelcase */

// TASK-575: the Festive Ball chase. Every other day in the last week before the guest details
// deadline, bookers still missing guest names or meal choices get a reminder, and the volunteers get
// a list of who to phone.
//
// Additive only (golden rule 2):
//   - one new column on the one-row ball_settings, with a default, so the existing row reads as
//     "nobody to send the list to" and nothing changes until staff add the volunteers' addresses;
//   - a new table recording each chase email that went out (or is going): which day, to whom, and
//     which bookings it covered. The unique key lets only one claim exist per kind, day and
//     address, so a second run of the daily job on the same morning sends nothing twice.
//
// The volunteers' addresses are kept here rather than in code: this repository is public.
// email_log.kind is plain text with no constraint, so the new kind ballChaseList needs nothing here.
//
// Numbered 1791200000300: after the site alias subdomains' 290, the newest production had run.

exports.up = (pgm) => {
  pgm.addColumns("ball_settings", {
    chase_recipients: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
  });

  pgm.createTable("ball_chase_sends", {
    id: "id",
    kind: { type: "text", notNull: true, comment: "'reminder' to a booker, or 'list' to a volunteer." },
    sent_on: { type: "date", notNull: true, comment: "The UK date it went, or was claimed for." },
    recipient: { type: "text", notNull: true, comment: "The address it went to, lower-cased." },
    status: { type: "text", notNull: true, default: "claimed" },
    booking_ids: {
      type: "int[]",
      notNull: true,
      default: pgm.func("'{}'::int[]"),
      comment: "The bookings it covered. Ids only, never anyone's details.",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("ball_chase_sends", "ball_chase_sends_kind_check", {
    check: "kind IN ('reminder', 'list')",
  });
  pgm.addConstraint("ball_chase_sends", "ball_chase_sends_status_check", {
    check: "status IN ('claimed', 'sent')",
  });
  pgm.addConstraint("ball_chase_sends", "ball_chase_sends_one_a_day", {
    unique: ["kind", "sent_on", "recipient"],
  });
};

exports.down = (pgm) => {
  pgm.dropTable("ball_chase_sends");
  pgm.dropColumns("ball_settings", ["chase_recipients"]);
};
