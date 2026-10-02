/* eslint-disable camelcase */

// TASK-507 (Jaimie's decision, 2026-10-02): an organiser's thank you (email 20) goes to every giver
// they pick, as the give form promises "to send your receipt and a thank you", EXCEPT anyone who has
// opted out. So the opt out needs a record of its own, by address.
//
//   email_opt_outs   one live row per address (lower cased) that asked us to stop: "all" (Stop all
//                    emails in the preference centre) or "thank_you" (thank yous turned off there).
//                    Turning thank yous back on tombstones it (removed_at, removed_by), never deletes
//                    it, the house rule for unsubscribes and the suppression list. By address, so it
//                    covers every donor row and list membership with that address.
//
// The backfill. Before this, the preference centre kept no record of "Stop all emails": it set
// email_consent and thankyou_consent to false on every donor row for the address (no audit_log row,
// no history) and tombstoned the address's list memberships. Both flags false is also how a giver who
// never ticked the newsletter box looks, so the two cannot be told apart from the flags. What CAN be
// told: the preference centre is only reachable from a link in a newsletter or the list welcome
// email. So an address is backfilled as opted out when some donor row for it has thankyou_consent
// false AND it could have pressed Stop all emails or turned thank yous off:
//   - some donor row for it has email_consent true (thank yous off with the newsletter kept: only
//     the preference centre does that);
//   - it was sent a newsletter (newsletter_sends), has a newsletter event (an unsubscribe, a
//     complaint), or is on a list (list_subscribers, live or tombstoned: the welcome email);
//   - or it was on file when a newsletter went out before each recipient was recorded (newsletters
//     sent before the first newsletter_sends row), when we cannot know who it reached.
// Conservative by design: some who never asked to stop are counted as opted out (a thank you they do
// not get), never the other way round. A giver whose address no newsletter, welcome or list ever
// reached could not have opened the preference centre, so is not backfilled.
//
// Also widens fundraiser_thank_gifts.skip_reason (from 1791200000110) to the three send time checks:
// refunded, paid_in and not_running. Additive only (a new table; a check that allows more), so a
// code rollback is safe (golden rule 2). Numbered 120, above 110.

exports.shorthands = undefined;

const NEW_REASONS = "'no_email', 'suppressed', 'opted_out', 'duplicate', 'refunded', 'paid_in', 'not_running'";

exports.up = (pgm) => {
  pgm.createTable(
    "email_opt_outs",
    {
      id: "id",
      email: { type: "text", notNull: true, check: "email = lower(email) AND char_length(email) BETWEEN 3 AND 320" },
      kind: { type: "text", notNull: true, check: "kind IN ('all', 'thank_you')" },
      source: { type: "text", notNull: true, check: "source IN ('preferences', 'backfill')" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      removed_at: { type: "timestamptz" },
      removed_by: { type: "text" },
    },
    { comment: "Addresses that asked us to stop (Stop all emails, or thank yous off): never sent a fundraiser's thank you (TASK-507)." },
  );
  pgm.createIndex("email_opt_outs", "email", { name: "email_opt_outs_live_idx", unique: true, where: "removed_at IS NULL" });

  pgm.sql(`
    INSERT INTO email_opt_outs (email, kind, source)
    SELECT DISTINCT lower(trim(dn.email)), 'all', 'backfill'
      FROM donors dn
     WHERE dn.email IS NOT NULL AND char_length(trim(dn.email)) BETWEEN 3 AND 320
       AND dn.thankyou_consent = false
       AND (
             EXISTS (SELECT 1 FROM donors d2 WHERE lower(trim(d2.email)) = lower(trim(dn.email)) AND d2.email_consent = true)
          OR EXISTS (SELECT 1 FROM newsletter_sends ns WHERE lower(trim(ns.email)) = lower(trim(dn.email)))
          OR EXISTS (SELECT 1 FROM newsletter_email_events ne
                      WHERE lower(trim(ne.email)) = lower(trim(dn.email)) AND ne.event_type IN ('unsubscribed', 'complained'))
          OR EXISTS (SELECT 1 FROM list_subscribers ls WHERE lower(trim(ls.email)) = lower(trim(dn.email)))
          OR EXISTS (SELECT 1 FROM newsletters n
                      WHERE n.status = 'sent' AND n.sent_at IS NOT NULL AND dn.created_at <= n.sent_at
                        AND n.sent_at < COALESCE((SELECT min(sent_at) FROM newsletter_sends), 'infinity'::timestamptz))
           )
  `);

  pgm.dropConstraint("fundraiser_thank_gifts", "fundraiser_thank_gifts_skip_reason_check", { ifExists: true });
  pgm.addConstraint("fundraiser_thank_gifts", "fundraiser_thank_gifts_skip_reason_check", {
    check: `skip_reason IS NULL OR skip_reason IN (${NEW_REASONS})`,
  });
};

exports.down = (pgm) => {
  pgm.dropTable("email_opt_outs");
  // The wider skip reasons stay: rows may already use them, and the older code never writes them.
};
