/* eslint-disable camelcase */

// Head Elf HQ (docs/superpowers/specs/2026-11-05-elf-admin-design.md): give every EXISTING saved
// permissions matrix a value for the new "elf" section, the Elf Detective School's own admin section.
//
// effectivePermissions treats a saved matrix as the whole of a person's access, so a section it does
// not name is denied. Without this, everyone whose access was ever edited, the admins included, would
// find no Elf Detective School in the menu. The value matches what roleToPermissions gives each role:
// admins edit, everyone else none (it holds children's first names and families' emails; a head elf
// is given it per person from the Team matrix). The pattern is
// 1788100000000_permissions-business-supporters.js.
//
// Additive: it only ADDS a key to saved matrices that lack it. A matrix that already names the section
// is left alone, and a user with no saved matrix falls through to their role's defaults.

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE users
       SET permissions = permissions || jsonb_build_object(
             'elf',
             CASE WHEN role = 'admin' THEN 'edit' ELSE 'none' END
           )
     WHERE permissions IS NOT NULL
       AND permissions <> '{}'::jsonb
       AND NOT (permissions ? 'elf')
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE users
       SET permissions = permissions - 'elf'
     WHERE permissions IS NOT NULL
       AND permissions ? 'elf'
  `);
};
