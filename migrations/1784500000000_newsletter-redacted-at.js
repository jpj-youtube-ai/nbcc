/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration, not stamped with the wall-clock
// time `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md. `create` produced
// 1784207882808 here, which sorts BEFORE two already-applied migrations and would have aborted every
// staging/production deploy while CI stayed green.
//
// TASK-252: `redacted_at` — when a SENT newsletter's content was deleted.
//
// Deleting a sent newsletter outright would destroy the record of what was emailed to real donors;
// keeping it forever means holding donor addresses (failed_emails) indefinitely. So a sent newsletter
// is REDACTED instead: the content and the bounced addresses go, and a permanent stub stays — subject,
// sent_at, recipient_count, sent_count, failed_count — so "what did we send, when, to how many?" is
// always answerable. This column is what marks that, and what lets the UI say so plainly.
//
// Additive: one new nullable column, nothing dropped or narrowed, so a code-level rollback stays safe
// (golden rule 2). Note the redaction itself blanks body_html to '' rather than NULL — the column is
// NOT NULL and this migration deliberately does not relax that: widening it would break older code
// that expects a string on rollback.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("newsletters", {
    redacted_at: { type: "timestamptz" }, // NULL = never redacted (every existing row)
  });
  pgm.addColumns("newsletters", {
    redacted_by: { type: "integer", references: "users", onDelete: "SET NULL" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("newsletters", ["redacted_at", "redacted_by"]);
};
