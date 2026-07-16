/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration, NOT the wall-clock stamp
// `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md (a wall-clock number sorts
// before the hand-rounded future-dated migrations already applied, and aborts every staging/prod
// deploy while CI stays green).
//
// TASK-255: what actually happened to each newsletter email (Phase 1 of the email stats dashboard).
//
//   newsletter_sends        — one row per ACCEPTED recipient per send. Written best-effort after the
//                             send loop. It is both the correlation target for webhook events (which
//                             arrive keyed by address, not by newsletter) and the honest denominator
//                             for rates.
//   newsletter_email_events — per-address facts reported back by Resend (delivered / bounced /
//                             complained) plus our own unsubscribed events. svix_event_id carries
//                             Resend's delivery id: UNIQUE (partial — our own events have none), so
//                             Resend's retries can never double-count.
//
// Additive only: two brand-new tables, nothing existing touched (golden rule 2). Rows hold donor
// email addresses, so TASK-255 also extends the TASK-252 redaction to clear them — same data class
// as failed_emails.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "newsletter_sends",
    {
      id: "id",
      newsletter_id: { type: "integer", notNull: true, references: "newsletters", onDelete: "CASCADE" },
      donor_id: { type: "integer", references: "donors", onDelete: "SET NULL" },
      email: { type: "text", notNull: true },
      sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "One row per accepted newsletter recipient (TASK-255): correlation target + rate denominator." },
  );
  // The webhook correlates by address, newest send first.
  pgm.createIndex("newsletter_sends", ["email", "sent_at"]);
  pgm.createIndex("newsletter_sends", "newsletter_id");

  pgm.createTable(
    "newsletter_email_events",
    {
      id: "id",
      svix_event_id: { type: "text" }, // Resend/Svix delivery id; NULL for our own unsubscribe events
      newsletter_id: { type: "integer", notNull: true, references: "newsletters", onDelete: "CASCADE" },
      email: { type: "text", notNull: true },
      event_type: {
        type: "text",
        notNull: true,
        check: "event_type IN ('delivered', 'bounced', 'complained', 'unsubscribed')",
      },
      occurred_at: { type: "timestamptz", notNull: true },
      detail: { type: "jsonb" }, // e.g. the bounce reason; never a whole payload
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Per-address newsletter email facts (TASK-255): Resend webhook events + our unsubscribes." },
  );
  // Idempotency: Resend retries webhook deliveries until acknowledged; the same svix id inserts once.
  pgm.createIndex("newsletter_email_events", "svix_event_id", {
    unique: true,
    where: "svix_event_id IS NOT NULL",
    name: "newsletter_email_events_svix_uniq",
  });
  pgm.createIndex("newsletter_email_events", ["newsletter_id", "event_type"]);
};

exports.down = (pgm) => {
  pgm.dropTable("newsletter_email_events");
  pgm.dropTable("newsletter_sends");
};
