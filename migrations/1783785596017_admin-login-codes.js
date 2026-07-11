/* eslint-disable */
// Admin management Phase 3 (TASK-188, mandatory email 2FA): the storage for the one-time login
// code challenged at step 2 of admin login. Additive only (golden rule 2): one brand-new table,
// no existing table touched, so a code-level rollback stays safe. Independent of the earlier
// additive migrations (order between them does not matter).
//
// One row per user (the LATEST challenge only) — user_id is the PRIMARY KEY, not a separate
// surrogate id, so each login upserts (INSERT ... ON CONFLICT (user_id) DO UPDATE) rather than
// accumulating a row per attempt. ON DELETE CASCADE: a pending code is worthless once its user is
// gone, so it is cleaned up with the user (mirrors portal_access_tokens.donor_id). code_hash is
// the keyed HMAC (never the raw code — see src/admin/two-factor.ts). expires_at bounds the code's
// life (10 min); attempts counts wrong guesses toward the 5-attempt cap. Both enforced in
// src/db/login-codes.ts / the login route, not by a DB constraint.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "admin_login_codes",
    {
      user_id: { type: "integer", primaryKey: true, references: "users", onDelete: "CASCADE" },
      code_hash: { type: "text", notNull: true },
      expires_at: { type: "timestamptz", notNull: true },
      attempts: { type: "integer", notNull: true, default: 0 },
    },
    { comment: "One-time email login codes for mandatory admin 2FA (Admin Phase 3, TASK-188). One row per user (latest challenge), upserted each login step 1." },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("admin_login_codes");
};
