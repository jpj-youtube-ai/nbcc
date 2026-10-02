/* eslint-disable camelcase */

// TASK-503: the fundraising team's tools in Admin > Fundraising.
//
//   fundraiser_invites            someone staff invited to fundraise. Their name and email (the only
//                                 things the invite fills in on the sign up form), the personal note
//                                 in the email, who it is signed by (a first name) and who sent it,
//                                 and when it was sent and last resent. The token in the email's link
//                                 is kept only as its sha256 (src/fundraising/invite.ts), so a copy of
//                                 this table opens nothing. Marked used, and linked to the sign up,
//                                 when the sign up made from it arrives.
//   fundraiser_calls              one row per call made to a fundraiser: the call a week before its
//                                 date or the one a week after, when, who by, and an optional note.
//                                 Cleared with the fundraiser it belongs to.
//   fundraisers.off_list_at/by    when, and by whom, staff took it off the Get involved list. Its page
//                                 and giving link keep working; it is only no longer listed.
//   fundraising_settings.summary_recipients / summary_last_week
//                                 who gets the Monday summary (set in the admin, never in code), and
//                                 the Monday it last went, so it never goes twice in one week.
//
// Additive only: two new tables, two nullable columns, one jsonb with a constant default (an empty
// list) and one nullable date, so a code rollback is safe (golden rule 2). Numbered 1791200000070,
// above 1791200000050 (the highest on main) and the 1791200000060 another stage 1b task may use.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "fundraiser_invites",
    {
      id: "id",
      name: { type: "text", notNull: true },
      email: { type: "text", notNull: true }, // lower case
      note: { type: "text" },
      signed_by: { type: "text", notNull: true }, // the first name the email is signed with
      sent_by: { type: "text", notNull: true }, // "admin:<email>"
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      resent_at: { type: "timestamptz" },
      token_hash: { type: "text", notNull: true, unique: true },
      used_by_fundraiser_id: { type: "integer", references: "fundraisers", onDelete: "SET NULL" },
      used_at: { type: "timestamptz" },
    },
    {
      constraints: { check: ["note IS NULL OR char_length(note) <= 600", "char_length(name) <= 100"] },
      comment: "Invitations to fundraise sent from Admin > Fundraising; tokens kept only as sha256 (TASK-503).",
    },
  );
  pgm.createIndex("fundraiser_invites", "used_at");

  pgm.createTable(
    "fundraiser_calls",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      which: { type: "text", notNull: true, check: "which IN ('before', 'after')" },
      called_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      called_by: { type: "text" },
      note: { type: "text" },
    },
    {
      constraints: { check: "note IS NULL OR char_length(note) <= 500" },
      comment: "Calls made to a fundraiser, a week before and a week after its date (TASK-503).",
    },
  );
  pgm.createIndex("fundraiser_calls", ["fundraiser_id", { name: "called_at", sort: "DESC" }]);

  pgm.addColumns("fundraisers", {
    off_list_at: { type: "timestamptz" },
    off_list_by: { type: "text" },
  });

  pgm.addColumns("fundraising_settings", {
    summary_recipients: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    summary_last_week: { type: "date" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("fundraising_settings", ["summary_recipients", "summary_last_week"]);
  pgm.dropColumns("fundraisers", ["off_list_at", "off_list_by"]);
  pgm.dropTable("fundraiser_calls");
  pgm.dropTable("fundraiser_invites");
};
