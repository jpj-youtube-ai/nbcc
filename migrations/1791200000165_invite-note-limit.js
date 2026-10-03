/* eslint-disable camelcase */

// Jaimie 2026-10-03: the personal note on an invite from Admin > Fundraising may be up to 5,000
// characters (TASK-503 allowed 600). The table check from 1791200000070 was unnamed, so it is found
// by what it says (Postgres renders it as char_length(note) <= 600) and swapped for a named one.
// Numbered to sort after the categories migration (160) and before keep-in-touch (170).

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE c record;
    BEGIN
      FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'fundraiser_invites'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%char_length(note)%'
      LOOP
        EXECUTE format('ALTER TABLE fundraiser_invites DROP CONSTRAINT %I', c.conname);
      END LOOP;
    END $$;
  `);
  pgm.sql(`ALTER TABLE fundraiser_invites ADD CONSTRAINT fundraiser_invites_note_length CHECK (note IS NULL OR char_length(note) <= 5000)`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE fundraiser_invites DROP CONSTRAINT IF EXISTS fundraiser_invites_note_length`);
  pgm.sql(`ALTER TABLE fundraiser_invites ADD CONSTRAINT fundraiser_invites_note_check CHECK (note IS NULL OR char_length(note) <= 600) NOT VALID`);
};
