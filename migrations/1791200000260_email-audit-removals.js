/* eslint-disable camelcase */

// TASK-NNN: which addresses staff have removed from the Email audit's red band ("Needs a look"),
// so a dead address stops coming back into it, and into the Overview's count, every time
// something is sent to it.
//
//   email        the address, lowercased, as email_log.recipient is.
//   kind         'stop': its problems leave the band and the address is blocked (newsletters and
//                fundraising emails no longer go to it). 'tidy': they leave the band, nothing else.
//   blocked      true when this removal is what blocked the address. False for a tidy, and for a
//                stop on an address that was already blocked (its mail bounced, or it marked us as
//                spam): putting the removal back must then leave that block alone.
//   removed_at / removed_by     when, and which member of staff.
//   put_back_at / put_back_by   a removal is never deleted. Putting it back stamps it, as lifting
//                a block stamps email_suppressions, so who removed what, and who undid it, stays
//                answerable.
//
// Nothing is hidden by this table on its own. The band's query (listRecentEmailFailures,
// src/db/email-log.ts) leaves out a problem whose address has a removal still in force, when the
// problem is older than the removal, or the removal is a 'stop' and the address is still blocked.
//
// A NEW TABLE, and no change to any other. email_log is written by every email the site sends, the
// Festive Ball's included, and email_suppressions is read by every newsletter send: neither is
// altered here, and no code on the path an email takes when it is sent reads this table.
//
// The index holds only the removals still in force, by address: that is the lookup the band makes.
//
// Additive only (golden rule 2), so a code rollback is safe: old code never reads the table.
// Numbered 1791200000260: after the 250 on main.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "email_audit_removals",
    {
      id: "id",
      email: { type: "text", notNull: true },
      kind: { type: "text", notNull: true, check: "kind IN ('stop', 'tidy')" },
      blocked: { type: "boolean", notNull: true, default: false },
      removed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      removed_by: { type: "text", notNull: true },
      put_back_at: { type: "timestamptz" },
      put_back_by: { type: "text" },
    },
    { comment: "Addresses staff removed from the Email audit's red band (TASK-NNN). Stamped, never deleted, when put back." },
  );
  pgm.createIndex("email_audit_removals", "email", { where: "put_back_at IS NULL" });
};

exports.down = (pgm) => {
  pgm.dropTable("email_audit_removals", { ifExists: true });
};
