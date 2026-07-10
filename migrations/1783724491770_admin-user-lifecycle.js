/* eslint-disable */
// Admin management Phase 1: give admin `users` a lifecycle (invited -> active, or disabled)
// plus an invited_at / last_login_at stamp. Additive only (golden rule 2): every existing
// row defaults to status='active', so current admins keep signing in unchanged.
exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.addColumns("users", {
    status: { type: "text", notNull: true, default: "active" }, // invited | active | disabled
    invited_at: { type: "timestamptz" },
    last_login_at: { type: "timestamptz" },
  });
  pgm.addConstraint("users", "users_status_check", {
    check: "status IN ('invited', 'active', 'disabled')",
  });
};
exports.down = (pgm) => {
  pgm.dropConstraint("users", "users_status_check");
  pgm.dropColumns("users", ["status", "invited_at", "last_login_at"]);
};
