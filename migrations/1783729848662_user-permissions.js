/* eslint-disable */
// TASK-186 (Admin Phase 2, Task 2): add a per-section permissions matrix column to users, backing
// the new authorizeSection gate (src/admin/permissions.ts). A user's effective permissions are
// this JSONB map if non-empty, else derived from their existing `role` column
// (roleToPermissions) — so every existing row defaults to `{}` and falls back to its current
// role-based access with ZERO data migration; nobody's access changes until an admin edits their
// matrix.
//
// Additive / expand-contract (golden rule 2): one new column, NOT NULL but backed by a DEFAULT, so
// Postgres backfills existing rows with '{}' as part of the DDL — no separate data migration, and
// the `role` column is untouched (kept for defaulting + labels). The down() drops the column.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("users", {
    permissions: { type: "jsonb", notNull: true, default: "{}" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("users", ["permissions"]);
};
