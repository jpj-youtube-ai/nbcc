/* eslint-disable camelcase */

// TASK-453: give every EXISTING permissions matrix a value for the new "events" section.
//
// The pattern from 1788100000000_permissions-business-supporters.js, for the reason explained
// there: a stored matrix is a complete statement of access, so a section it does not name is
// denied, and a matrix saved before today has no key for a section added today.
//
// The values match what roleToPermissions gives each role: admins and editors edit (events are
// content work, like Stories), everyone else may look. Turning the whole page on or off is not
// part of this: that is admin-only in the route, whatever the matrix says.
//
// Additive: only ADDS the key to rows that lack it. A user with no stored matrix is untouched,
// because they already fall through to their role's defaults.

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE users
       SET permissions = permissions || jsonb_build_object(
             'events',
             CASE WHEN role IN ('admin', 'editor') THEN 'edit' ELSE 'view' END
           )
     WHERE permissions IS NOT NULL
       AND permissions <> '{}'::jsonb
       AND NOT (permissions ? 'events')
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE users
       SET permissions = permissions - 'events'
     WHERE permissions IS NOT NULL
       AND permissions ? 'events'
  `);
};
