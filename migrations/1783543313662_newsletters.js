/* eslint-disable */
// TASK-161 (REQ-069): the admin newsletter store. Staff author an HTML newsletter, save it as a
// draft, and (Admin only) send it to every consenting donor. Additive / expand-contract: one brand
// new table, no existing table touched, so a code-level rollback stays safe (golden rule 2).
// Independent of the earlier additive migrations (order between them does not matter).
//
// Each newsletter is its own row (history model): new drafts never overwrite older ones, and a sent
// newsletter stays as an immutable record (subject/body + sent_at/sent_by/recipient_count). status is
// 'draft' until sent, then 'sent'. sent_by FK → users is ON DELETE RESTRICT (protect the audit trail
// of who sent it), nullable until sent. The migration also seeds ONE starter draft so the admin tab
// is never empty on first load.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "newsletters",
    {
      id: "id",
      subject: { type: "text", notNull: true },
      body_html: { type: "text", notNull: true },
      status: {
        type: "text",
        notNull: true,
        default: "draft",
        check: "status IN ('draft', 'sent')",
      },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      sent_at: { type: "timestamptz" }, // NULL until sent
      sent_by: { type: "integer", references: "users", onDelete: "RESTRICT" }, // NULL until sent
      recipient_count: { type: "integer" }, // NULL until sent
    },
    { comment: "Admin-authored newsletters emailed to consenting donors (REQ-069)." },
  );

  // Seed one starter draft so the Newsletter tab shows something by default.
  pgm.sql(`
    INSERT INTO newsletters (subject, body_html, status)
    VALUES (
      'North Berwick Christmas Committee — Newsletter',
      '<h1>Season''s greetings from the North Berwick Christmas Committee</h1><p>Write your update here.</p>',
      'draft'
    );
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("newsletters");
};
