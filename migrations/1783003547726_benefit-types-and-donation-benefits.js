/* eslint-disable */
// TASK-066 (REQ-045): benefit tracking — the catalogue of donor benefits and the
// per-donation benefits awarded, so the Gift Aid benefit cap can be reasoned about.
// Additive / expand-contract: two brand-new tables (benefit_types, donation_benefits)
// plus a single NULLABLE-DEFAULTED boolean column on donations. No existing
// donors/declarations/donations/audit_log column is dropped, renamed or made NOT NULL
// on populated data, so a code-level rollback stays safe (golden rule 2). Independent
// of the earlier additive migrations (order between them does not matter).
//
// The benefit-cap calculation itself (HMRC's relevant-value rule) and the code that
// awards benefits / flips benefit_cap_breached are NOT built here — this only lays the
// shared model rows they will write through.

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ---- benefit_types: the catalogue of benefits a donor may receive ----
  // is_recognition_perk marks the low-/no-value recognition perks (name on a page, a
  // thank-you) that are seeded below; default_value_pence is the optional typical
  // monetary value used by the cap calculation, NULL when a perk carries no set value.
  pgm.createTable(
    "benefit_types",
    {
      id: "id",
      name: { type: "text", notNull: true, unique: true },
      is_recognition_perk: { type: "boolean", notNull: true, default: false },
      default_value_pence: { type: "integer", check: "default_value_pence >= 0" }, // nullable
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Catalogue of donor benefits; recognition perks are low/no-value (REQ-045)." },
  );

  // Seed the named recognition perks — low-/no-value benefits that do not count against
  // the Gift Aid benefit cap. default_value_pence is left NULL (no set monetary value).
  pgm.sql(`
    INSERT INTO benefit_types (name, is_recognition_perk) VALUES
      ('name-on-page', true),
      ('impact update', true),
      ('social thank-you', true),
      ('digital badge', true),
      ('certificate', true);
  `);

  // ---- donation_benefits: a benefit awarded against one donation ----
  // value_pence is the value attributed to THIS award (used by the cap calc); it is NOT
  // NULL because a recorded benefit always has an attributed value (0 for a no-value
  // perk). Both FKs are indexed and RESTRICT so a referenced row cannot be deleted while
  // an award points at it.
  pgm.createTable(
    "donation_benefits",
    {
      id: "id",
      donation_id: { type: "integer", notNull: true, references: "donations", onDelete: "RESTRICT" },
      benefit_type_id: {
        type: "integer",
        notNull: true,
        references: "benefit_types",
        onDelete: "RESTRICT",
      },
      value_pence: { type: "integer", notNull: true, check: "value_pence >= 0" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "A benefit awarded against a donation, valued for the Gift Aid cap (REQ-045)." },
  );
  pgm.createIndex("donation_benefits", "donation_id");
  pgm.createIndex("donation_benefits", "benefit_type_id");

  // ---- donations.benefit_cap_breached: have this gift's benefits breached the cap? ----
  // Additive: a NOT NULL column WITH a default(false), so every existing donation row
  // back-fills to false without touching any existing column (safe on populated data).
  // The cap calculation that flips it is a later task.
  pgm.addColumn("donations", {
    benefit_cap_breached: { type: "boolean", notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  // Reverse order: drop the donations column, then the awards table, then its catalogue.
  pgm.dropColumn("donations", "benefit_cap_breached");
  pgm.dropTable("donation_benefits");
  pgm.dropTable("benefit_types");
};
