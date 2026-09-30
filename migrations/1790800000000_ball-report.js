/* eslint-disable camelcase */

// TASK-464: the Festive Ball ticket report, twice a week to the people running the Ball with us.
//
// Additive only (golden rule 2):
//   • two new columns on the one-row ball_settings, both with defaults, so the existing row reads as
//     "switched off, nobody to send to" and nothing about the Ball changes until staff act;
//   • a new table recording each report that went out: which day, to whom, and the numbers it
//     carried. A unique index lets only one scheduled report claim a day, so a second run of the
//     daily job on the same morning sends nothing.
//
// The recipients are business contacts of the Ball (the organiser, the sponsor, our own staff),
// kept here rather than in code: this repository is public.
//
// Numbered above 1790788129056 (TASK-463's migration, open at the same time) so that whichever
// merges first, this one never sorts before a migration production has already run.

exports.up = (pgm) => {
  pgm.addColumns("ball_settings", {
    report_on: { type: "boolean", notNull: true, default: false },
    report_recipients: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
  });

  pgm.createTable("ball_report_sends", {
    id: "id",
    sent_on: { type: "date", notNull: true, comment: "The UK date the report went, or was claimed for." },
    kind: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "claimed" },
    recipients: { type: "text[]", notNull: true, default: pgm.func("'{}'::text[]") },
    figures: { type: "jsonb", comment: "The numbers that went out: counts only, never anyone's details." },
    counted_to: {
      type: "timestamptz",
      comment: "The moment its numbers were counted to. The next report counts on from exactly here.",
    },
    sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    sent_by: { type: "text", notNull: true },
  });
  pgm.addConstraint("ball_report_sends", "ball_report_sends_kind_check", {
    check: "kind IN ('scheduled', 'test')",
  });
  pgm.addConstraint("ball_report_sends", "ball_report_sends_status_check", {
    check: "status IN ('claimed', 'sent')",
  });
  pgm.createIndex("ball_report_sends", "sent_on", {
    name: "ball_report_sends_one_scheduled_a_day",
    unique: true,
    where: "kind = 'scheduled'",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("ball_report_sends");
  pgm.dropColumns("ball_settings", ["report_on", "report_recipients"]);
};
