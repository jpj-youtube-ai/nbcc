/* eslint-disable camelcase */

// TASK-463: give every EXISTING permissions matrix a value for the four sections that arrived before
// the rule in 1788100000000_permissions-business-supporters.js existed: "ball" (Festive Ball, TASK-313,
// 31 August 2026), then "email-audit" (Email audit, TASK-344), "site" (Site pages, TASK-352) and
// "outreach" (Contact businesses, TASK-354), all on 1 September. None shipped with a migration like
// that one, so a matrix saved before one of them arrived has no key for it, and a stored matrix is a
// complete statement of access: no key reads as None, for admins as much as anyone.
//
// The values are what roleToPermissions (src/admin/permissions.ts) gives each role today, and
// test/unit/permissions-backfill.test.ts holds them to it:
//
//   ball         admin edit, editor view, anyone else view
//   email-audit  admin edit, editor none, anyone else none
//   site         admin edit, editor view, anyone else view
//   outreach     admin edit, editor edit, anyone else view
//
// "Anyone else" is a viewer, or a role roleToPermissions does not know, which it treats as a viewer.
//
// Additive: it only ADDS a key to rows that lack one. A matrix that already names a section is left
// alone whatever it says: an explicit None may be somebody's choice or the TASK-459 fault, and only a
// person can tell which, on Team > Manage access. A user with no stored matrix is untouched, because
// they already fall through to their role's defaults.

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE users
       SET permissions = permissions || jsonb_build_object(
             'ball',
             CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'view' ELSE 'view' END
           )
     WHERE permissions IS NOT NULL
       AND permissions <> '{}'::jsonb
       AND NOT (permissions ? 'ball')
  `);
  pgm.sql(`
    UPDATE users
       SET permissions = permissions || jsonb_build_object(
             'email-audit',
             CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'none' ELSE 'none' END
           )
     WHERE permissions IS NOT NULL
       AND permissions <> '{}'::jsonb
       AND NOT (permissions ? 'email-audit')
  `);
  pgm.sql(`
    UPDATE users
       SET permissions = permissions || jsonb_build_object(
             'site',
             CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'view' ELSE 'view' END
           )
     WHERE permissions IS NOT NULL
       AND permissions <> '{}'::jsonb
       AND NOT (permissions ? 'site')
  `);
  pgm.sql(`
    UPDATE users
       SET permissions = permissions || jsonb_build_object(
             'outreach',
             CASE role WHEN 'admin' THEN 'edit' WHEN 'editor' THEN 'edit' ELSE 'view' END
           )
     WHERE permissions IS NOT NULL
       AND permissions <> '{}'::jsonb
       AND NOT (permissions ? 'outreach')
  `);
};

// Deliberately does nothing. The earlier backfills' down removes their key from every matrix, which
// was exact for them: nobody could have saved a section that did not exist yet. These four had existed
// for a month before this ran, so most matrices naming them were saved by a person, and removing the
// keys would take those choices away. What this adds is each role's own default, so leaving it in
// place after a rollback harms nobody.
exports.down = () => {};
