/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration (1785000000000), NOT the
// wall-clock stamp `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md.
//
// TASK-272: the suppression list — addresses we must stop emailing.
//
// Until now a hard bounce or a spam complaint was RECORDED and then ignored: the recipient queries
// filtered on consent alone, so a dead mailbox and a person who pressed "report spam" were mailed
// again on every subsequent send, forever. That is the single strongest signal a mailbox provider
// uses to decide a sender is careless, and it puts the whole nbcc.scot domain at risk — including the
// admin sign-in codes and donation receipts that share it.
//
//   email    — the suppressed address, matched case-insensitively (unique index on lower(email)).
//   reason   — 'bounced' (permanent/hard only), 'complained' (they pressed report-spam), or 'manual'
//              (a human added it). Complaints and hard bounces arrive from the Resend webhook.
//   detail   — the provider's own words for why, so an admin can judge a borderline case.
//   created_at / removed_at — suppression is itself a TOMBSTONE, matching how this codebase already
//              treats unsubscribes: lifting one keeps the history of it having happened, so "why did
//              we stop emailing them, and who decided to start again?" stays answerable.
//
// NOT suppressed: transient/soft bounces (a full mailbox, a temporary server fault). Those are
// counted but keep receiving — suppressing after N repeats is a documented follow-up.
//
// Additive: one new table.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "email_suppressions",
    {
      id: "id",
      email: { type: "text", notNull: true },
      reason: {
        type: "text",
        notNull: true,
        check: "reason IN ('bounced', 'complained', 'manual')",
      },
      detail: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      removed_at: { type: "timestamptz" }, // tombstone: an admin lifted the suppression
      removed_by: { type: "text" },
    },
    { comment: "Addresses we must not email (TASK-272): hard bounces, spam complaints, manual adds." },
  );
  // One ACTIVE suppression per address, case-insensitively. Partial, so a lifted suppression can be
  // re-applied later without colliding with the historic row.
  pgm.sql(
    `CREATE UNIQUE INDEX email_suppressions_active_email_uniq
       ON email_suppressions (lower(email)) WHERE removed_at IS NULL`,
  );
};

exports.down = (pgm) => {
  pgm.dropTable("email_suppressions");
};
