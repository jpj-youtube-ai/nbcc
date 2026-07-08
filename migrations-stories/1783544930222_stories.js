/* eslint-disable */
// TASK-B1 (REQ intent: "Persist My Story submissions to a dedicated stories database with
// consent & retention metadata."). This migration lives in its OWN directory
// (migrations-stories/), run against the SEPARATE `stories` database (never the main
// `charity` DB) via `npm run migrate:stories`, tracked by that database's own
// `pgmigrations` table. The `stories` table is the sole object in that database.
//
// Additive-only by construction (a fresh, dedicated database) — golden rule 2 is trivially
// satisfied since there is no existing data to endanger. Text lengths are capped in the Zod
// schema (src/stories/schema.ts), not here, so the migration stays additive if caps change.
// Column shape mirrors the spec's data-model table exactly (2026-07-08-my-story-design.md).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "stories",
    {
      id: "id",
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      // When consent was given — lets admin review the age of old consents before reusing
      // them publicly (Retention guardrail 3 in the spec).
      consent_captured_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      submitter_role: { type: "text" }, // supported/family_carer/volunteer/professional_partner/supporter_donor/other
      story_text: { type: "text", notNull: true },
      short_quote: { type: "text" },
      use_scope: { type: "text", notNull: true, default: "internal_only" }, // public/internal_only
      consent_share_first_name: { type: "boolean", notNull: true, default: false },
      consent_share_town: { type: "boolean", notNull: true, default: false },
      third_party_consent: { type: "boolean", notNull: true, default: false },
      contact_for_more: { type: "boolean", notNull: true, default: false },
      photo_interest: { type: "boolean", notNull: true, default: false },
      submitter_first_name: { type: "text" },
      submitter_email: { type: "text" }, // never published
      submitter_phone: { type: "text" }, // never published
      submitter_town: { type: "text" },
      age_band: { type: "text" }, // 16_24/25_44/45_64/65_plus
      gender: { type: "text" },
      recipient_type: { type: "text" }, // child/young_person/vulnerable_adult
      heard_about: { type: "text" },
      confirmed_over_16: { type: "boolean", notNull: true, default: false },
      status: { type: "text", notNull: true, default: "new" }, // new/reviewed/used/withdrawn
      admin_tags: { type: "text[]" }, // staff funding/theme tags (admin-only)
      admin_notes: { type: "text" },
    },
    {
      comment:
        "Public My Story submissions (Task B1). Lives in its own dedicated database, never the main charity DB.",
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("stories");
};
