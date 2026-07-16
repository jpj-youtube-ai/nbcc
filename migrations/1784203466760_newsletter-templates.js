/* eslint-disable */
// TASK-249: saved newsletter templates — a SHARED library any Editor can start a newsletter from.
// Additive: one brand-new table, no existing table touched, so a code-level rollback stays safe
// (golden rule 2). A template is just a stored block document (the same shape newsletters.body_json
// holds), so it inherits every block feature automatically — including the TASK-248 size step, which
// is relative and therefore still correct when the template is reused on different copy.
//
// name is UNIQUE: the library is shared, so two people both saving "Christmas Appeal" would leave the
// team unable to tell them apart. The route turns that conflict into a 409 the UI explains.
// created_by FK → users is ON DELETE SET NULL, mirroring newsletter_images: keep the team's template
// if the staff account that saved it is later removed.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "newsletter_templates",
    {
      id: "id",
      name: { type: "text", notNull: true, unique: true },
      body_json: { type: "jsonb", notNull: true },
      created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Saved newsletter templates: a shared library of reusable block documents (TASK-249)." },
  );
  pgm.createIndex("newsletter_templates", "created_at"); // the picker lists newest first
};

exports.down = (pgm) => {
  pgm.dropTable("newsletter_templates");
};
