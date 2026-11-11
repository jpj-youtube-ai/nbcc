/* eslint-disable camelcase */

// NBCC Elf Detective School, wave 2: alerts and claimed sends.
// Design: docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md.
//
//   elf_head_elves  a head elf's mobile (kept as E.164) and whether their alerts are on.
//   elf_alerts      each alert that went: when, for which door, how many emails and texts, and
//                   the names whose text did not go. No photo and no family name is kept here.
//   elf_sends       every timed send, claimed once by (kind, key) before it goes, so it goes once
//                   however many tasks run; attempts and the last error let a failed send retry.
//
// Additive: three new tables.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "elf_head_elves",
    {
      user_id: { type: "integer", primaryKey: true, references: "users", onDelete: "CASCADE" },
      mobile: { type: "text", check: "mobile IS NULL OR mobile ~ '^\\+447[0-9]{9}$'" },
      alerts_on: { type: "boolean", notNull: true, default: true },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    {
      comment: "A head elf's mobile for photo alerts (E.164) and whether their alerts are on.",
    },
  );

  pgm.createTable(
    "elf_alerts",
    {
      id: "id",
      kind: { type: "text", notNull: true, check: "kind IN ('photo', 'test')" },
      sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      year: { type: "integer", notNull: true },
      door: { type: "integer" },
      emails: { type: "integer", notNull: true, default: 0 },
      texts: { type: "integer", notNull: true, default: 0 },
      texts_failed: { type: "text[]", notNull: true, default: "{}" },
    },
    {
      comment: "Each alert sent to head elves: when, which door, how many went, and whose text did not.",
    },
  );
  pgm.createIndex("elf_alerts", ["kind", "sent_at"]);

  pgm.createTable(
    "elf_sends",
    {
      kind: { type: "text", notNull: true },
      key: { type: "text", notNull: true },
      claimed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      sent_at: { type: "timestamptz" },
      attempts: { type: "integer", notNull: true, default: 1 },
      last_error: { type: "text" },
    },
    {
      constraints: { primaryKey: ["kind", "key"] },
      comment: "Every timed send, claimed once by kind and key before it goes.",
    },
  );
  pgm.createIndex("elf_sends", ["kind", "sent_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("elf_sends");
  pgm.dropTable("elf_alerts");
  pgm.dropTable("elf_head_elves");
};
