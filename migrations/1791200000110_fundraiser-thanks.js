/* eslint-disable camelcase */

// TASK-507: "Thank your supporters". An organiser picks gifts on their fundraiser and writes a short
// thank you in their private area; staff check every one; NBCC then emails it to each chosen giver.
// The rules are in src/fundraising/thanks.ts.
//
//   fundraiser_thanks        one thank you: the organiser's words (up to 600 characters), where it is
//                            up to (pending, waiting for staff; approved, sent or being sent;
//                            rejected, staff chose not to send it, with a reason kept for staff
//                            only), who decided and when, and when the last of its emails was dealt
//                            with (delivered_at). Cleared with its fundraiser.
//   fundraiser_thank_gifts   one row per gift it picked, and what happened to that gift's email:
//                            waiting (for staff), queued (approved, to send), sending (claimed by the
//                            sender), sent, skipped (with the reason: no address, on the suppression
//                            list, turned thank you emails off, or the same person already sent this
//                            one), failed, or cancelled (the thank you was not sent, so the gift is
//                            free to thank again). A gift is thanked at most once: a unique index on
//                            the gift, except where cancelled. No email address is ever stored here;
//                            it is read from the giver's donor row at the moment of sending.
//
// Additive only: two new tables, so a code rollback is safe (golden rule 2). Numbered 1791200000110,
// above 1791200000080 (the highest on main) and the 1791200000100 another open task uses.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "fundraiser_thanks",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      message: { type: "text", notNull: true },
      status: { type: "text", notNull: true, default: "pending", check: "status IN ('pending', 'approved', 'rejected')" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      decided_at: { type: "timestamptz" },
      decided_by: { type: "text" }, // "admin:<email>"
      reject_reason: { type: "text" },
      delivered_at: { type: "timestamptz" },
    },
    {
      constraints: {
        check: ["char_length(message) BETWEEN 1 AND 600", "reject_reason IS NULL OR char_length(reject_reason) <= 500"],
      },
      comment: "Thank yous organisers send to their supporters; staff check each one first (TASK-507).",
    },
  );
  pgm.createIndex("fundraiser_thanks", ["fundraiser_id", { name: "created_at", sort: "DESC" }]);
  pgm.createIndex("fundraiser_thanks", "fundraiser_id", { name: "fundraiser_thanks_pending_idx", where: "status = 'pending'" });

  pgm.createTable(
    "fundraiser_thank_gifts",
    {
      id: "id",
      thanks_id: { type: "integer", notNull: true, references: "fundraiser_thanks", onDelete: "CASCADE" },
      donation_id: { type: "integer", notNull: true, references: "donations", onDelete: "CASCADE" },
      outcome: {
        type: "text",
        notNull: true,
        default: "waiting",
        check: "outcome IN ('waiting', 'queued', 'sending', 'sent', 'skipped', 'failed', 'cancelled')",
      },
      skip_reason: {
        type: "text",
        check: "skip_reason IS NULL OR skip_reason IN ('no_email', 'suppressed', 'opted_out', 'duplicate')",
      },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      sent_at: { type: "timestamptz" },
    },
    { comment: "Each gift a thank you picked, and what happened to its email (TASK-507). Never an address." },
  );
  pgm.createIndex("fundraiser_thank_gifts", "thanks_id");
  // A gift is thanked at most once, whatever happens to its email; only a thank you staff did not
  // send (cancelled) frees it.
  pgm.createIndex("fundraiser_thank_gifts", "donation_id", {
    name: "fundraiser_thank_gifts_once_idx",
    unique: true,
    where: "outcome <> 'cancelled'",
  });
  // The sender claims the next queued one.
  pgm.createIndex("fundraiser_thank_gifts", "id", { name: "fundraiser_thank_gifts_queued_idx", where: "outcome IN ('queued', 'sending')" });
};

exports.down = (pgm) => {
  pgm.dropTable("fundraiser_thank_gifts");
  pgm.dropTable("fundraiser_thanks");
};
