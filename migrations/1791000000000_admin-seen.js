/* eslint-disable camelcase */

// TASK-478: the New pills in the admin. One row per person per section: when they last opened it.
// A section is new to someone when something arrived there after that moment, so one person
// opening it clears the pill for them alone.
//
// Additive only (golden rule 2): a new table and nothing else. Removing a staff account removes
// its rows with it.

exports.up = (pgm) => {
  pgm.createTable(
    "admin_seen",
    {
      user_id: { type: "integer", notNull: true, references: "users", onDelete: "CASCADE" },
      area: { type: "text", notNull: true, comment: "The admin section (its data-view), e.g. contact." },
      seen_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { constraints: { primaryKey: ["user_id", "area"] } },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("admin_seen");
};
