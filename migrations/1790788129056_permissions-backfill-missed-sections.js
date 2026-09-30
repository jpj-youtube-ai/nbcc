/* eslint-disable camelcase */

// TASK-463: give every EXISTING permissions matrix a value for three of the four sections that arrived
// before the rule in 1788100000000_permissions-business-supporters.js existed: "ball" (Festive Ball,
// TASK-313, 31 August 2026), "site" (Site pages, TASK-352) and "outreach" (Contact businesses,
// TASK-354), both on 1 September. None shipped with a migration like that one, so a matrix saved
// before one of them arrived has no key for it, and a stored matrix is a complete statement of access:
// no key reads as None, for admins as much as anyone.
//
// The values are what roleToPermissions (src/admin/permissions.ts) gives each role today, and
// test/unit/permissions-backfill.test.ts holds them to it:
//
//   ball      admin edit, editor view, anyone else view
//   site      admin edit, editor view, anyone else view
//   outreach  admin edit, editor edit, anyone else view
//
// "Anyone else" is a viewer, or a role roleToPermissions does not know, which it treats as a viewer.
//
// The fourth, "email-audit" (Email audit, TASK-344, 1 September), is deliberately NOT backfilled. It
// was asked for so that exactly two named admins hold it and grant it to anyone else, and the page lists
// who was sent which email. Filling it in here would hand it to every admin account whose access
// predates it, so a missing key stays None: that fails closed, and editors and viewers get None for it
// anyway.
//
// Additive: it only ADDS a key to rows that lack one. A matrix that already names a section is left
// alone whatever it says: an explicit None may be somebody's choice, the TASK-459 fault, or Manage
// access filling a gap with None when an older matrix was saved again, and only a person can tell
// which, on Team > Manage access. A user with no stored matrix is untouched, because they already fall
// through to their role's defaults.
//
// Every key it adds is recorded in audit_log as admin_user.permissions_backfilled, by
// migration:TASK-463, with the section and level, so whose access this changed is on the record the
// same way a change made on Manage access is.

exports.up = (pgm) => {
  pgm.sql(`
    WITH added AS (
      UPDATE users
         SET permissions = permissions || jsonb_build_object(
               'ball',
               CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'view' ELSE 'view' END
             )
       WHERE permissions IS NOT NULL
         AND permissions <> '{}'::jsonb
         AND NOT (permissions ? 'ball')
      RETURNING id, permissions->>'ball' AS level
    )
    INSERT INTO audit_log (actor, action, entity, entity_id, data)
    SELECT 'migration:TASK-463', 'admin_user.permissions_backfilled', 'user', id,
           jsonb_build_object('section', 'ball', 'level', level)
      FROM added
  `);
  pgm.sql(`
    WITH added AS (
      UPDATE users
         SET permissions = permissions || jsonb_build_object(
               'site',
               CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'view' ELSE 'view' END
             )
       WHERE permissions IS NOT NULL
         AND permissions <> '{}'::jsonb
         AND NOT (permissions ? 'site')
      RETURNING id, permissions->>'site' AS level
    )
    INSERT INTO audit_log (actor, action, entity, entity_id, data)
    SELECT 'migration:TASK-463', 'admin_user.permissions_backfilled', 'user', id,
           jsonb_build_object('section', 'site', 'level', level)
      FROM added
  `);
  pgm.sql(`
    WITH added AS (
      UPDATE users
         SET permissions = permissions || jsonb_build_object(
               'outreach',
               CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'edit' ELSE 'view' END
             )
       WHERE permissions IS NOT NULL
         AND permissions <> '{}'::jsonb
         AND NOT (permissions ? 'outreach')
      RETURNING id, permissions->>'outreach' AS level
    )
    INSERT INTO audit_log (actor, action, entity, entity_id, data)
    SELECT 'migration:TASK-463', 'admin_user.permissions_backfilled', 'user', id,
           jsonb_build_object('section', 'outreach', 'level', level)
      FROM added
  `);
};

// Deliberately does nothing. The earlier backfills' down removes their key from every matrix, which
// was exact for them: nobody could have saved a section that did not exist yet. These had existed for
// a month before this ran, so most matrices naming them were saved by a person, and removing the keys
// would take those choices away. What this adds is exactly what anyone of the same role with no saved
// access already has; to take it back from somebody, use Team > Manage access (the audit_log rows say
// who got what).
exports.down = () => {};
