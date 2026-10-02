/* eslint-disable camelcase */

// TASK-493: give every EXISTING permissions matrix a value for the new "fundraising" section, the
// TASK-479 way (1791000000001_permissions-analytics.js).
//
// A stored matrix is a complete statement of access: a section it does not name is denied, admins
// included, so without this anyone whose access was ever saved could not open the new screen.
//
// The values are what roleToPermissions (src/admin/permissions.ts) gives each role, and
// test/unit/permissions-backfill.test.ts holds them to it:
//
//   fundraising  admin edit, editor edit, anyone else view
//
// Additive: it only ADDS a key to rows that lack one. A user with no stored matrix is untouched,
// because they already fall through to their role's defaults. Every key it adds is recorded in
// audit_log as admin_user.permissions_backfilled, by migration:TASK-493, with the section and level.

exports.up = (pgm) => {
  pgm.sql(`
    WITH added AS (
      UPDATE users
         SET permissions = permissions || jsonb_build_object(
               'fundraising',
               CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'edit' ELSE 'view' END
             )
       WHERE permissions IS NOT NULL
         AND permissions <> '{}'::jsonb
         AND NOT (permissions ? 'fundraising')
      RETURNING id, permissions->>'fundraising' AS level
    )
    INSERT INTO audit_log (actor, action, entity, entity_id, data)
    SELECT 'migration:TASK-493', 'admin_user.permissions_backfilled', 'user', id,
           jsonb_build_object('section', 'fundraising', 'level', level)
      FROM added
  `);
};

// Deliberately does nothing, like the earlier backfills: once the screen exists, a saved matrix
// naming it may be somebody's choice. To take access away, use Team > Manage access.
exports.down = () => {};
