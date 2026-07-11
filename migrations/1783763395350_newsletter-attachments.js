/* eslint-disable camelcase */

// File attachments for a newsletter (TASK-193). Bytes stored in Postgres (like newsletter_images),
// tied to the newsletter and cascade-deleted with it. Attachments are added to a draft and sent as
// email attachments to every recipient. New table — additive, safe with a code-level rollback.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "newsletter_attachments",
    {
      id: { type: "uuid", primaryKey: true },
      newsletter_id: {
        type: "integer",
        notNull: true,
        references: "newsletters",
        onDelete: "CASCADE",
      },
      filename: { type: "text", notNull: true },
      mime: { type: "text", notNull: true },
      bytes: { type: "bytea", notNull: true },
      byte_size: { type: "integer", notNull: true },
      uploaded_by: { type: "integer", references: "users", onDelete: "SET NULL" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Files attached to a newsletter, sent as email attachments (TASK-193)." },
  );
  pgm.createIndex("newsletter_attachments", "newsletter_id");
};

exports.down = (pgm) => {
  pgm.dropTable("newsletter_attachments");
};
