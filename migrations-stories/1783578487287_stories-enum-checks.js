/* eslint-disable */
// Task C (defense-in-depth): the enum-shaped columns on `stories` are validated at the app layer
// (Zod: src/stories/schema.ts for submitter-facing fields; STORY_STATUSES in src/routes/admin.ts
// for the admin-only `status` workflow field), but nothing at the DB level stops a bad value ever
// landing there — e.g. a future direct SQL fix, a bug in another writer, or a migration mistake.
// This migration adds CHECK constraints mirroring those same allowed value sets, so the DB itself
// rejects anything outside them.
//
// Additive / expand-contract, safe on populated data (golden rule 2):
//   • Every constraint here is a NEW constraint on an EXISTING column — no column type, default or
//     nullability changes, so no existing row can be silently altered.
//   • Each set matches (or is a superset of) the current app-level enum, so any row already
//     persisted by the app-layer validation already satisfies its constraint. use_scope,
//     submitter_role, age_band and recipient_type are nullable columns (per
//     migrations-stories/1783544930222_stories.js), so their CHECKs explicitly allow NULL — only
//     status is NOT NULL (with a default), so its CHECK does not need the NULL branch, but the
//     migration would still be safe if a NULL ever existed since NULL always passes a SQL CHECK
//     unless the check itself is stated NOT to allow it.
//   • If a genuinely new enum value is ever needed, DROP + ADD the constraint with the widened set
//     (see migrations/1783067859348_claim-adjustments-and-status.js for that pattern) — never
//     narrow a set that has live data using an old value.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addConstraint(
    "stories",
    "stories_use_scope_check",
    "CHECK (use_scope IN ('public','internal_only'))",
  );
  pgm.addConstraint(
    "stories",
    "stories_submitter_role_check",
    "CHECK (submitter_role IS NULL OR submitter_role IN " +
      "('supported','family_carer','volunteer','professional_partner','supporter_donor','other'))",
  );
  pgm.addConstraint(
    "stories",
    "stories_age_band_check",
    "CHECK (age_band IS NULL OR age_band IN ('16_24','25_44','45_64','65_plus'))",
  );
  pgm.addConstraint(
    "stories",
    "stories_recipient_type_check",
    "CHECK (recipient_type IS NULL OR recipient_type IN ('child','young_person','vulnerable_adult'))",
  );
  pgm.addConstraint(
    "stories",
    "stories_status_check",
    "CHECK (status IN ('new','reviewed','used','withdrawn'))",
  );
};

exports.down = (pgm) => {
  pgm.dropConstraint("stories", "stories_status_check");
  pgm.dropConstraint("stories", "stories_recipient_type_check");
  pgm.dropConstraint("stories", "stories_age_band_check");
  pgm.dropConstraint("stories", "stories_submitter_role_check");
  pgm.dropConstraint("stories", "stories_use_scope_check");
};
