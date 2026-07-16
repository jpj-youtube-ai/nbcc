/* eslint-disable */
// NOTE ON THE FILENAME (TASK-250): this is numbered ABOVE 1784300000000_supporter-subscription-
// cancelled-at, not stamped with the wall-clock time `node-pg-migrate create` gives you. Several
// existing migrations carry hand-rounded numbers that sit slightly in the FUTURE, so a freshly
// created migration sorts BEFORE them — and node-pg-migrate throws "Not run migration X is preceding
// already run migration Y" against any database that already ran them. CI never catches this (its DB
// is empty, so everything runs in order from zero); it fails on staging/production, where history
// exists. If you create a migration and CI is green, check `ls migrations | sort | tail` and make sure
// yours is genuinely last.
//
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
