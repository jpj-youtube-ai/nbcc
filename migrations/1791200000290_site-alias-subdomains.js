/* eslint-disable camelcase */

// TASK-568: the forwards to NBCC subdomains the client asked for, working from the moment the release
// that lets staff add such forwards themselves (Admin > Site pages > Spare addresses) is live:
//
//   /drop                      -> drop.nbcc.scot
//   /referrals, /referral      -> referrals.nbcc.scot   (both ways people type it)
//   /volunteer, /volunteers    -> vol.nbcc.scot
//
// Rows in the existing site_aliases table; no change to any table's shape. All three subdomains were
// checked to exist and answer on 2026-10-06, and none of the five addresses was a page.
//
// Only where nobody has made that address already: a forward staff added by hand is theirs, and is
// left exactly as it is. Removing one later is the Remove button on that screen, like any other.
//
// Additive only (golden rule 2), so a code rollback is safe: code from before this release sends a
// stored https address on as it is, with a 301 rather than a 302.
// Numbered 1791200000290: after the Email audit's 280, the newest production had run.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(
    `INSERT INTO site_aliases (from_path, to_path, created_by)
     VALUES ('/drop', 'https://drop.nbcc.scot', 'seed'),
            ('/referrals', 'https://referrals.nbcc.scot', 'seed'),
            ('/referral', 'https://referrals.nbcc.scot', 'seed'),
            ('/volunteer', 'https://vol.nbcc.scot', 'seed'),
            ('/volunteers', 'https://vol.nbcc.scot', 'seed')
     ON CONFLICT (from_path) DO NOTHING`,
  );
};

// Takes back only the rows this migration made, never one staff made or changed.
exports.down = (pgm) => {
  pgm.sql(
    `DELETE FROM site_aliases
      WHERE created_by = 'seed'
        AND (from_path, to_path) IN (
          ('/drop', 'https://drop.nbcc.scot'),
          ('/referrals', 'https://referrals.nbcc.scot'),
          ('/referral', 'https://referrals.nbcc.scot'),
          ('/volunteer', 'https://vol.nbcc.scot'),
          ('/volunteers', 'https://vol.nbcc.scot'))`,
  );
};
