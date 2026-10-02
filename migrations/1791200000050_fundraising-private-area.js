/* eslint-disable camelcase */

// TASK-501: the fundraising private area at /fundraise/manage.
//
//   fundraiser_sign_in_codes   the 6 digit code emailed to an organiser. One row per email (a new
//                              code replaces the last), kept only as a keyed hash
//                              (src/fundraising/sign-in.ts), with its expiry (10 minutes) and a
//                              count of tries (5 wrong ones and it is dead).
//   fundraiser_sessions        a signed in organiser: the sha256 of the random id in their cookie,
//                              the email it belongs to, and its expiry (2 hours). A copy of either
//                              table opens nothing.
//   fundraisers.finished_requested_at
//                              when the organiser pressed "I've finished". It tells staff; it
//                              finishes nothing by itself.
//   donations.paid_in_by_organiser
//                              money the organiser collected and paid in by card from their private
//                              area. It counts on the meter like any gift, never shows on the wall,
//                              and never carries Gift Aid (it is not their own gift).
//
// Additive only: two new tables, one nullable column, and one boolean with a constant default (every
// existing gift reads false), so a code rollback is safe (golden rule 2). The old 24 hour links
// table (fundraiser_manage_tokens) is no longer written; it is dropped in a later release.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "fundraiser_sign_in_codes",
    {
      email: { type: "text", primaryKey: true }, // lower case
      code_hash: { type: "text", notNull: true },
      expires_at: { type: "timestamptz", notNull: true },
      attempts: { type: "integer", notNull: true, default: 0 },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Emailed fundraising sign in codes, kept only as keyed hashes (TASK-501)." },
  );

  pgm.createTable(
    "fundraiser_sessions",
    {
      session_hash: { type: "text", primaryKey: true }, // sha256 hex of the cookie's random id
      email: { type: "text", notNull: true }, // lower case
      expires_at: { type: "timestamptz", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Signed in fundraising organisers, kept only as sha256 hashes (TASK-501)." },
  );
  pgm.createIndex("fundraiser_sessions", "expires_at");

  pgm.addColumns("fundraisers", {
    finished_requested_at: { type: "timestamptz" },
  });

  pgm.addColumns("donations", {
    paid_in_by_organiser: { type: "boolean", notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("donations", ["paid_in_by_organiser"]);
  pgm.dropColumns("fundraisers", ["finished_requested_at"]);
  pgm.dropTable("fundraiser_sessions");
  pgm.dropTable("fundraiser_sign_in_codes");
};
