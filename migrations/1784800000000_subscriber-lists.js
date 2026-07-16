/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration, NOT the wall-clock stamp
// `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md.
//
// TASK-259: audience lists. Until now "the audience" was hardcoded: every consenting donor. The
// charity mails more than donors — volunteers, partners, referrers — and those audiences must be
// separate lists with separate memberships and separate unsubscribes.
//
//   subscriber_lists — the audiences. Seeded with the four the charity runs today; admins can add
//                      more. slug is the stable programmatic handle ('newsletter' is special: donors
//                      with email consent are automatically part of that audience, on top of its own
//                      subscriber rows).
//   list_subscribers — one membership per (list, address). consent_source records HOW consent arrived
//                      (footer signup / spreadsheet import / typed in by staff) — the thing a
//                      regulator asks for. unsubscribed_at is a tombstone, NOT a delete: "this person
//                      opted out on this date" is itself consent history, and it is what stops a
//                      later import silently re-subscribing someone who opted out.
//
// Additive: two new tables + one nullable column on newsletters (which list a send went to; NULL for
// every pre-lists send, read as the newsletter audience).
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "subscriber_lists",
    {
      id: "id",
      slug: { type: "text", notNull: true, unique: true },
      name: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Mailing audiences (TASK-259). 'newsletter' additionally includes consenting donors." },
  );
  pgm.sql(`INSERT INTO subscriber_lists (slug, name) VALUES
    ('newsletter', 'Newsletter'),
    ('volunteers', 'Volunteers'),
    ('partners', 'Partners'),
    ('referrers', 'Referrers')`);

  pgm.createTable(
    "list_subscribers",
    {
      id: "id",
      list_id: { type: "integer", notNull: true, references: "subscriber_lists", onDelete: "CASCADE" },
      name: { type: "text" },
      email: { type: "text", notNull: true },
      phone: { type: "text" }, // optional, captured for future SMS — nothing sends texts yet
      consent_source: { type: "text", notNull: true, check: "consent_source IN ('footer', 'import', 'admin')" },
      consented_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      unsubscribed_at: { type: "timestamptz" }, // tombstone — never deleted, it IS the opt-out record
    },
    { comment: "List memberships (TASK-259): who is on which audience, how they consented, and when they left." },
  );
  // One membership per address per list, case-insensitively.
  pgm.sql(`CREATE UNIQUE INDEX list_subscribers_list_email_uniq ON list_subscribers (list_id, lower(email))`);

  pgm.addColumns("newsletters", {
    list_id: { type: "integer", references: "subscriber_lists" }, // NULL = pre-lists send (newsletter)
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("newsletters", ["list_id"]);
  pgm.dropTable("list_subscribers");
  pgm.dropTable("subscriber_lists");
};
