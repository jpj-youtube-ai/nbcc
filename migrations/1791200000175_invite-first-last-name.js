/* eslint-disable camelcase */

// Jaimie 2026-10-03: Invite someone in Admin > Fundraising has a First name box and a Surname box
// (it was one "Their name" box, split at its first space when filling in the sign up form, so
// "Mary Jane Smith" became Mary / Jane Smith). Both are kept here and filled in exactly.
//
// Additive only: two nullable columns, each with its own named length check (50, the sign up
// form's own limit). The `name` column stays and is still written (the two joined), so a code
// rollback is safe (golden rule 2), and an invite sent before this has no first or last name and
// falls back to the old split (src/fundraising/invite.ts, inviteNameParts). Numbered to sort after
// keep-in-touch (1791200000170).

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE fundraiser_invites
      ADD COLUMN IF NOT EXISTS first_name text,
      ADD COLUMN IF NOT EXISTS last_name text
  `);
  pgm.sql(`
    ALTER TABLE fundraiser_invites
      ADD CONSTRAINT fundraiser_invites_first_name_length CHECK (first_name IS NULL OR char_length(first_name) <= 50),
      ADD CONSTRAINT fundraiser_invites_last_name_length CHECK (last_name IS NULL OR char_length(last_name) <= 50)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE fundraiser_invites
      DROP COLUMN IF EXISTS first_name,
      DROP COLUMN IF EXISTS last_name
  `);
};
