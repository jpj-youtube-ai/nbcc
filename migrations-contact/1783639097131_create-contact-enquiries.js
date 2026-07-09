/* eslint-disable */
// Contact inbox (2026-07-10 spec). This migration lives in its OWN directory
// (migrations-contact/), run against the SEPARATE `contact` database (never the main
// `charity` DB, never the `stories` DB) via `npm run migrate:contact`, tracked by that
// database's own `pgmigrations` table. `contact_enquiries` is the sole object in that database.
//
// Additive-only by construction (a fresh, dedicated database) — golden rule 2 is trivially
// satisfied. Text lengths are capped in the Zod schema (src/contact/schema.ts), not here.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "contact_enquiries",
    {
      id: "id",
      first_name: { type: "text", notNull: true },
      last_name: { type: "text", notNull: true, default: "" },
      email: { type: "text", notNull: true },
      message: { type: "text", notNull: true },
      status: { type: "text", notNull: true, default: "new" }, // new/replied
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      replied_at: { type: "timestamptz" }, // set when marked replied; null otherwise
      replied_by: { type: "text" }, // email of the admin who marked it replied; null otherwise
    },
    {
      comment:
        "Public contact-form submissions (2026-07-10 spec). Lives in its own dedicated database, never the main charity DB or the stories DB.",
    },
  );
  // Defence in depth: status may only ever be one of the two workflow values.
  pgm.addConstraint("contact_enquiries", "contact_enquiries_status_check", {
    check: "status IN ('new', 'replied')",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("contact_enquiries");
};
