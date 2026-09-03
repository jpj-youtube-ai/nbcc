/* eslint-disable camelcase */

// TASK-406: give every EXISTING permissions matrix a value for the new "business-supporters"
// section.
//
// Why this migration has to exist. effectivePermissions treats a stored matrix as a COMPLETE
// statement of access: a section it does not name is denied. That is deliberate and it is the
// right way round for an authorisation rule - failing closed loses somebody a tab, which is
// visible and recoverable, where failing open grants access nobody chose and nobody sees.
//
// The cost of that rule is exactly this file. The permissions editor submits every section that
// exists when it is used, so a matrix saved before today simply has no key for a section added
// today, and would read as "none" for everyone who has ever had their permissions edited - the
// admins included, who would then have to notice a missing tab and grant it back to themselves.
//
// So the data is brought up to date once, here, matching what roleToPermissions would have given
// each role: admins edit, everyone else none (the same shape as "email-audit", and for the same
// reason - these records carry business contact details and the postal address a certificate is
// sent to).
//
// Additive: it only ADDS a key to rows that lack one. A matrix that already names the section is
// left alone, and a user with no stored matrix is untouched because they already fall through to
// their role defaults.
//
// THE PATTERN FOR NEXT TIME: every new section in src/admin/permissions.ts ships with a migration
// like this one. Forgetting it fails closed, which is why the rule is safe to keep.

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE users
       SET permissions = permissions || jsonb_build_object(
             'business-supporters',
             CASE WHEN role = 'admin' THEN 'edit' ELSE 'none' END
           )
     WHERE permissions IS NOT NULL
       AND permissions <> '{}'::jsonb
       AND NOT (permissions ? 'business-supporters')
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE users
       SET permissions = permissions - 'business-supporters'
     WHERE permissions IS NOT NULL
       AND permissions ? 'business-supporters'
  `);
};
