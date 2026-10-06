/* eslint-disable camelcase */

// TASK-568: nbcc.scot/drop forwards to drop.nbcc.scot, as the client asked, from the moment the
// release that lets staff add such forwards themselves (Admin > Site pages > Spare addresses) is
// live. One row in the existing site_aliases table; no change to any table's shape.
//
// Only if nobody has made a /drop already: a forward staff added by hand is theirs, and is left
// exactly as it is. Removing it later is the Remove button on that screen, like any other.
//
// Additive only (golden rule 2), so a code rollback is safe: code from before this release sends a
// stored https address on as it is, with a 301 rather than a 302.
// Numbered 1791200000290: after the Email audit's 280, the newest production had run.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(
    `INSERT INTO site_aliases (from_path, to_path, created_by)
     VALUES ('/drop', 'https://drop.nbcc.scot', 'system:TASK-568')
     ON CONFLICT (from_path) DO NOTHING`,
  );
};

// Takes back only the row this migration made, never one staff made or changed.
exports.down = (pgm) => {
  pgm.sql(
    `DELETE FROM site_aliases
      WHERE from_path = '/drop' AND to_path = 'https://drop.nbcc.scot' AND created_by = 'system:TASK-568'`,
  );
};
