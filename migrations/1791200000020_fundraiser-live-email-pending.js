/* eslint-disable camelcase */

// TASK-497: a fundraiser approved while fundraising is switched off, who would have a public page,
// is marked as waiting for their "Your page is live" email. When an admin switches fundraising on,
// that email goes to every approved fundraiser still waiting, and the mark is cleared
// (src/fundraising/send.ts, sendWaitingLiveEmails). This replaces the old "you're approved, your
// page will appear when our pages open" email.
//
// Additive: one new column with a constant default, so every existing row reads "not waiting" and
// a code rollback is safe (golden rule 2).
//
// Anyone ALREADY approved with a page, while fundraising has never been switched on, is still
// waiting for that news, so they are marked too. If fundraising has ever been on, nobody is marked:
// page holders approved while it was on were sent "Your page is live" at the time.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("fundraisers", {
    live_email_pending: { type: "boolean", notNull: true, default: false },
  });
  pgm.sql(`
    UPDATE fundraisers SET live_email_pending = true
     WHERE status = 'approved' AND public = true AND path = 'raising'
       AND NOT EXISTS (
         SELECT 1 FROM audit_log
          WHERE action = 'fundraising.switched' AND entity = 'fundraising_settings' AND data->>'pageOn' = 'true'
       )
       AND NOT COALESCE((SELECT page_on FROM fundraising_settings WHERE id = 1), false)
  `);
};

exports.down = (pgm) => {
  pgm.dropColumns("fundraisers", ["live_email_pending"]);
};
