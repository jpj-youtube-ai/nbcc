/* eslint-disable camelcase */

// TASK-492: a QR code scan is its own channel in Admin > Analytics (see
// docs/superpowers/specs/2026-10-02-admin-qr-codes-design.md). The channel check on analytics_views
// is WIDENED to allow 'qr': every value it allowed before is still allowed, and code from before
// this release never writes 'qr', so a code-level rollback stays safe (golden rule 2).
//
// The check was declared on the column in 1791000000000_site-analytics.js, so Postgres named it.
// Rather than guess that name, every check on the table that mentions channel is dropped, and the
// widened one is added back under a name of our own.
//
// Numbered after 1791100000000_business-supporter-calls.js, the highest on main.

const OLD = "channel IN ('newsletter', 'email', 'search', 'social', 'other_websites', 'direct')";
const NEW = "channel IN ('newsletter', 'email', 'qr', 'search', 'social', 'other_websites', 'direct')";

const dropChannelChecks = `
  DO $$
  DECLARE c text;
  BEGIN
    FOR c IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'analytics_views'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%channel%'
    LOOP
      EXECUTE format('ALTER TABLE analytics_views DROP CONSTRAINT %I', c);
    END LOOP;
  END $$;
`;

exports.up = (pgm) => {
  pgm.sql(dropChannelChecks);
  pgm.sql(`ALTER TABLE analytics_views ADD CONSTRAINT analytics_views_channel_check CHECK (${NEW})`);
};

// Back to the old list. NOT VALID, so rows already counted as 'qr' do not stop the rollback; new
// rows are held to the old list again.
exports.down = (pgm) => {
  pgm.sql(dropChannelChecks);
  pgm.sql(`ALTER TABLE analytics_views ADD CONSTRAINT analytics_views_channel_check CHECK (${OLD}) NOT VALID`);
};
