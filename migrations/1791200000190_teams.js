/* eslint-disable camelcase */

// Team pages (Jaimie, 2026-10-03). A sponsorship fundraiser (path 'raising') can be a TEAM: the
// person who set it up is its team organiser, and other people join it with member pages of their
// own, each approved by staff. Gifts on a member page count on the member's meter AND the team's.
//
//   fundraisers.is_team          this sign up is a team page.
//   fundraisers.team_id          this sign up is a member page of that team.
//   fundraisers.team_share_mode  on a team that shares what it raises with another cause: 'team'
//                                (every member page has the same split, and members are not asked)
//                                or 'organiser' (just the organiser's; each member is asked).
//   fundraisers.team_left_at/_by a member taken off the team (by its organiser, from their private
//                                area); the page carries on as their own, and no longer counts.
//   fundraisers.team_nudge_1_at/_2_at
//                                the two automatic "did you send the invite to your team?" emails to
//                                the team organiser (day 3, and day 10 if still nobody has joined),
//                                claimed before sending so each goes once.
//   team_invites                 the people the team organiser added at sign up: first name, surname
//                                and email. HELD (sent_at null) until staff approve the team, then
//                                invited (only the sha256 of the link's token is kept), reminded once
//                                after 5 days, and DELETED (names, email and token cleared, the row kept
//                                for the counts) 30 days after the invite or after the event,
//                                whichever is sooner.
//   team_handovers               staff moving the team organiser role to someone else; the new team
//                                organiser confirms with an emailed 6 digit code, kept only as a
//                                keyed hash, with a limit on tries. One open handover a team. The
//                                name, email, phone and code hash are cleared 30 days after it is
//                                confirmed, cancelled or runs out.
//
// Additive only: new nullable columns, one with a constant default, two new tables, and checks every
// row already there passes (none is a team or a member), so a code rollback is safe (golden rule 2).
// Numbered 1791200000190: after the 185 the event pages change adds, which merges first.

exports.shorthands = undefined;

const FUNDRAISER_COLUMNS = ["is_team", "team_id", "team_share_mode", "team_left_at", "team_left_by", "team_nudge_1_at", "team_nudge_2_at"];

exports.up = (pgm) => {
  pgm.addColumns("fundraisers", {
    is_team: { type: "boolean", notNull: true, default: false },
    team_id: { type: "integer", references: "fundraisers", onDelete: "SET NULL" },
    team_share_mode: { type: "text" },
    team_left_at: { type: "timestamptz" },
    team_left_by: { type: "text" },
    team_nudge_1_at: { type: "timestamptz" },
    team_nudge_2_at: { type: "timestamptz" },
  });
  pgm.addConstraint("fundraisers", "fundraisers_team_not_member", { check: "NOT (is_team AND team_id IS NOT NULL)" });
  pgm.addConstraint("fundraisers", "fundraisers_team_not_self", { check: "team_id IS NULL OR team_id <> id" });
  pgm.addConstraint("fundraisers", "fundraisers_team_raising", {
    // A page taken off its team (team_left_at) is its own again, and may be anything staff make it.
    check: "(NOT is_team AND (team_id IS NULL OR team_left_at IS NOT NULL)) OR path = 'raising'",
  });
  pgm.addConstraint("fundraisers", "fundraisers_team_share_mode", {
    check: "team_share_mode IS NULL OR (is_team AND shares_with_other IS TRUE AND team_share_mode IN ('team', 'organiser'))",
  });
  pgm.createIndex("fundraisers", "team_id", { name: "fundraisers_team_id_idx", where: "team_id IS NOT NULL" });

  pgm.createTable(
    "team_invites",
    {
      id: "id",
      team_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      first_name: { type: "text" },
      last_name: { type: "text" },
      email: { type: "text" },
      token_hash: { type: "text", unique: true },
      // The one reminder's own link: the first email's link keeps working beside it.
      reminder_token_hash: { type: "text", unique: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      created_by: { type: "text", notNull: true, default: "organiser" },
      sent_at: { type: "timestamptz" },
      reminded_at: { type: "timestamptz" },
      joined_at: { type: "timestamptz" },
      joined_fundraiser_id: { type: "integer", references: "fundraisers", onDelete: "SET NULL" },
      deleted_at: { type: "timestamptz" },
    },
    { comment: "People a team organiser added, held until staff approve the team; deleted after 30 days or the event (teams)." },
  );
  pgm.addConstraint("team_invites", "team_invites_details_kept", {
    check: "deleted_at IS NOT NULL OR (first_name IS NOT NULL AND last_name IS NOT NULL AND email IS NOT NULL)",
  });
  pgm.addConstraint("team_invites", "team_invites_deleted_cleared", {
    check: "deleted_at IS NULL OR (first_name IS NULL AND last_name IS NULL AND email IS NULL AND token_hash IS NULL AND reminder_token_hash IS NULL)",
  });
  pgm.addConstraint("team_invites", "team_invites_lengths", {
    check:
      "(first_name IS NULL OR char_length(first_name) <= 50) AND (last_name IS NULL OR char_length(last_name) <= 50)" +
      " AND (email IS NULL OR char_length(email) <= 254)",
  });
  pgm.addConstraint("team_invites", "team_invites_reminded_after_sent", { check: "reminded_at IS NULL OR sent_at IS NOT NULL" });
  pgm.createIndex("team_invites", "team_id", { name: "team_invites_team_id_idx" });
  // One live invite per address on a team (an address typed twice is one person).
  pgm.sql("CREATE UNIQUE INDEX team_invites_one_per_email ON team_invites (team_id, lower(email)) WHERE deleted_at IS NULL");

  pgm.createTable(
    "team_handovers",
    {
      id: "id",
      team_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      // Cleared (with the code's hash) 30 days after it is confirmed, cancelled or runs out.
      to_first_name: { type: "text" },
      to_last_name: { type: "text" },
      to_email: { type: "text" },
      to_phone: { type: "text" },
      code_hash: { type: "text" },
      expires_at: { type: "timestamptz", notNull: true },
      attempts: { type: "integer", notNull: true, default: 0 },
      created_by: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      confirmed_at: { type: "timestamptz" },
      cancelled_at: { type: "timestamptz" },
      cleared_at: { type: "timestamptz" },
    },
    { comment: "Staff moving a team organiser role; the new organiser confirms with an emailed code, kept as a keyed hash (teams)." },
  );
  pgm.addConstraint("team_handovers", "team_handovers_details_kept", {
    check: "cleared_at IS NOT NULL OR (to_first_name IS NOT NULL AND to_last_name IS NOT NULL AND to_email IS NOT NULL AND to_phone IS NOT NULL AND code_hash IS NOT NULL)",
  });
  pgm.addConstraint("team_handovers", "team_handovers_lengths", {
    check:
      "(to_first_name IS NULL OR char_length(to_first_name) BETWEEN 1 AND 50) AND (to_last_name IS NULL OR char_length(to_last_name) BETWEEN 1 AND 50)" +
      " AND (to_email IS NULL OR char_length(to_email) BETWEEN 3 AND 254) AND (to_phone IS NULL OR char_length(to_phone) <= 20)",
  });
  pgm.createIndex("team_handovers", "team_id", {
    name: "team_handovers_one_open",
    unique: true,
    where: "confirmed_at IS NULL AND cancelled_at IS NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("team_handovers", { ifExists: true });
  pgm.dropTable("team_invites", { ifExists: true });
  pgm.dropIndex("fundraisers", "team_id", { name: "fundraisers_team_id_idx", ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_team_share_mode", { ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_team_raising", { ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_team_not_self", { ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_team_not_member", { ifExists: true });
  pgm.dropColumns("fundraisers", FUNDRAISER_COLUMNS);
};
