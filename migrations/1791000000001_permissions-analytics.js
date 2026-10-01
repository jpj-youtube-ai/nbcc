/* eslint-disable camelcase */

// TASK-479: give every EXISTING permissions matrix a value for the new "analytics" section, the
// TASK-463 way (1790788129056_permissions-backfill-missed-sections.js).
//
// A stored matrix is a complete statement of access: a section it does not name is denied, admins
// included, so without this an admin whose access was ever saved could not open the new page.
//
// The values are what roleToPermissions (src/admin/permissions.ts) gives each role, and
// test/unit/permissions-backfill.test.ts holds them to it:
//
//   analytics  admin edit, editor none, anyone else none
//
// Jaimie asked for it to be admins only for now, given to anyone else from Team > Manage access.
//
// Additive: it only ADDS a key to rows that lack one. A user with no stored matrix is untouched,
// because they already fall through to their role's defaults. Every key it adds is recorded in
// audit_log as admin_user.permissions_backfilled, by migration:TASK-479, with the section and level.

exports.up = (pgm) => {
  pgm.sql(`
    WITH added AS (
      UPDATE users
         SET permissions = permissions || jsonb_build_object(
               'analytics',
               CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'none' ELSE 'none' END
             )
       WHERE permissions IS NOT NULL
         AND permissions <> '{}'::jsonb
         AND NOT (permissions ? 'analytics')
      RETURNING id, permissions->>'analytics' AS level
    )
    INSERT INTO audit_log (actor, action, entity, entity_id, data)
    SELECT 'migration:TASK-479', 'admin_user.permissions_backfilled', 'user', id,
           jsonb_build_object('section', 'analytics', 'level', level)
      FROM added
  `);
};

// Deliberately does nothing, like the TASK-463 backfill: once the page exists, a saved matrix
// naming it may be somebody's choice. To take access away, use Team > Manage access.
exports.down = () => {};
