/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration, NOT the wall-clock stamp
// `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md.
//
// TASK-257: engagement events (email stats Phase 2 — opens + clicks). Two widenings of the TASK-255
// events table, both additive:
//   - event_type now also admits 'opened' and 'clicked' (the CHECK is dropped and re-added wider —
//     metadata only, no table rewrite; old code writes a subset of the new set, so a code rollback
//     stays safe, which is what golden rule 2 actually demands);
//   - link_url (nullable): the DESTINATION a 'clicked' event was for, powering the per-link table.
//     NULL for every other type, and for a click Resend reported without a link.
//
// The events themselves only start arriving once the user enables open/click tracking on the
// newsletter-only sending subdomain in Resend — until then this is dormant capacity, exactly like the
// webhook itself was before its secret existed.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.dropConstraint("newsletter_email_events", "newsletter_email_events_event_type_check");
  pgm.addConstraint("newsletter_email_events", "newsletter_email_events_event_type_check", {
    check: "event_type IN ('delivered', 'bounced', 'complained', 'unsubscribed', 'opened', 'clicked')",
  });
  pgm.addColumns("newsletter_email_events", {
    link_url: { type: "text" }, // clicked only: the destination URL, for the per-link breakdown
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("newsletter_email_events", ["link_url"]);
  pgm.dropConstraint("newsletter_email_events", "newsletter_email_events_event_type_check");
  pgm.addConstraint("newsletter_email_events", "newsletter_email_events_event_type_check", {
    check: "event_type IN ('delivered', 'bounced', 'complained', 'unsubscribed')",
  });
};
