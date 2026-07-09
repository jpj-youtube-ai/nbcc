/* eslint-disable */
// TASK-168 (REQ-069): storage for uploaded newsletter images. Additive: one brand-new table, no
// existing table touched. Images are served publicly by GET /media/newsletter/:id; the uuid (app-
// generated with crypto.randomUUID) is the capability. No extension needed (id is supplied by the
// app, not gen_random_uuid). uploaded_by FK → users is ON DELETE SET NULL (keep the image if the
// staff account is later removed).
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "newsletter_images",
    {
      id: { type: "uuid", primaryKey: true }, // app-supplied crypto.randomUUID()
      mime: { type: "text", notNull: true },
      bytes: { type: "bytea", notNull: true },
      byte_size: { type: "integer", notNull: true },
      uploaded_by: { type: "integer", references: "users", onDelete: "SET NULL" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Uploaded newsletter images, served by GET /media/newsletter/:id (REQ-069)." },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("newsletter_images");
};
