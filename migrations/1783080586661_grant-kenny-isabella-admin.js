/* eslint-disable */
// TASK-107 (REQ-062): grant Kenny and Isabella the Admin role. They are the two NBCC staff who hold
// the Admin/Claims permission (run and submit claims, user management, settings). The users table
// (1782987698792) seeded no rows, and the role enum + credential exist (1782987698792 / 1783078996722),
// so this seeds the two admin accounts.
//
// Additive / expand-contract, safe on populated data (golden rule 2): a data-only INSERT — it adds
// rows, changes no schema, and drops/renames/alters no column, so a code-level rollback stays safe.
// Idempotent via ON CONFLICT (email): if a row already exists for either address it is UPGRADED to
// role='admin' (satisfying "set role='admin' for the rows identified as Kenny and Isabel") rather
// than duplicated; otherwise it is inserted as an admin. No password_hash is set here — the accounts
// cannot log in until a password is set out of band (golden rule 4: secrets never in code), which is
// the safe default.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO users (email, full_name, role)
    VALUES
      ('kenny@nightbeforechristmas.co.uk',    'Kenny',    'admin'),
      ('isabella@nightbeforechristmas.co.uk', 'Isabella', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM users
     WHERE email IN ('kenny@nightbeforechristmas.co.uk', 'isabella@nightbeforechristmas.co.uk');
  `);
};
