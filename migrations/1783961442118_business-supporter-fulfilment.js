/* eslint-disable */
// TASK-205 (business-supporter thank-you & fulfilment — DATA-MODEL FOUNDATION): the "expand" step
// that later PRs (thank-you page capture, reminders, admin fulfilment UI, backfill) build on.
// Additive / expand-contract: ONE brand-new table, no existing table touched, every column nullable
// or defaulted, so a code-level rollback stays safe (golden rule 2). Independent of the earlier
// additive migrations (order between them does not matter).
//
// One fulfilment record per business supporter: donor_id is UNIQUE (a supporter has exactly one
// fulfilment row, upserted). The FK is ON DELETE RESTRICT, mirroring the financial FKs to donors
// (donations/declarations) — a business supporter is a paying donor, so their fulfilment record is
// protected rather than silently cascaded away. The UNIQUE constraint already creates the donor_id
// index, so no separate index is added (avoids a duplicate).
//
// `band` is the recognition band the supporter's MONTHLY gift earned (bronze|silver|gold|platinum) —
// the pure banding + perk logic lives in src/donors/fulfilment.ts. The "captured preferences" block
// is what the business fills in on the thank-you form (all nullable / defaulted false until they
// submit — captured_at is NULL until then). The "admin fulfilment flags" are booleans only; WHO did
// each action and WHEN is recorded separately in the existing append-only audit_log, not here. The
// reminder_*_at columns are for the later reminders task. All perks are £0-value recognition perks,
// so nothing here affects the HMRC Gift-Aid benefit cap.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "business_supporter_fulfilment",
    {
      id: "id",
      // One fulfilment record per donor (UNIQUE); FK RESTRICT protects the record like the other
      // donor-referencing financial rows. The UNIQUE constraint supplies the donor_id index.
      donor_id: {
        type: "integer",
        notNull: true,
        references: "donors",
        onDelete: "RESTRICT",
        unique: true,
      },
      // The recognition band the supporter's monthly gift earned (see src/donors/fulfilment.ts).
      band: {
        type: "text",
        notNull: true,
        check: "band IN ('bronze', 'silver', 'gold', 'platinum')",
      },

      // ---- Captured preferences: what the business submits on the thank-you form ----
      // Nullable / defaulted-false until they fill it in; captured_at stays NULL until submission.
      credit_name: { type: "text" }, // how their business name should appear
      website: { type: "text" },
      socials: { type: "text" },
      list_on_supporters: { type: "boolean", notNull: true, default: false }, // opt-in; default hidden
      want_social: { type: "boolean", notNull: true, default: false },
      want_badge: { type: "boolean", notNull: true, default: false },
      want_certificate: { type: "boolean", notNull: true, default: false },
      // NULL until chosen; a NULL passes the check (unknown), so it stays optional.
      certificate_delivery: {
        type: "text",
        check: "certificate_delivery IN ('download', 'post')",
      },
      certificate_address: { type: "text" },
      consent_featured: { type: "boolean", notNull: true, default: false },
      captured_at: { type: "timestamptz" }, // NULL = the business has not filled in the form yet

      // ---- Admin fulfilment flags (booleans only; who/when lives in audit_log) ----
      certificate_sent: { type: "boolean", notNull: true, default: false },
      certificate_posted: { type: "boolean", notNull: true, default: false },
      badge_sent: { type: "boolean", notNull: true, default: false },
      social_done: { type: "boolean", notNull: true, default: false },
      added_to_supporters: { type: "boolean", notNull: true, default: false },

      // ---- Reminder tracking (for the later reminders task) ----
      reminder_5_at: { type: "timestamptz" },
      reminder_14_at: { type: "timestamptz" },

      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      comment:
        "Business-supporter thank-you & fulfilment record; one row per donor (TASK-205). Captured preferences + admin fulfilment flags; recognition band per src/donors/fulfilment.ts.",
    },
  );
  // NOTE: no explicit index on donor_id — the UNIQUE constraint above already creates one.
};

exports.down = (pgm) => {
  pgm.dropTable("business_supporter_fulfilment");
};
