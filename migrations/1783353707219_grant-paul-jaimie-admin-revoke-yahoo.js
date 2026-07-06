/* eslint-disable */
// REQ-062: adjust the admin login roster. Adds two nbcc.scot admins — paul.popa@nbcc.scot (Paul Popa)
// and jaimie.wakefield@nbcc.scot (Jaimie Wakefield) — and revokes the interim personal admin
// paul.popa1995@yahoo.ro added by 1783345566569 (superseded by the paul.popa@nbcc.scot identity).
//
// Additive / expand-contract, safe on populated data (golden rule 2): data-only INSERT/DELETE — it
// changes no schema and drops/renames/alters no column, so a code-level rollback stays safe. Email is a
// natural key (UNIQUE), so the INSERT is idempotent via ON CONFLICT (email) DO UPDATE (promotes an
// existing viewer/editor to admin). No password_hash is set (golden rule 4: secrets never in code) —
// each account logs in only once a password is set out of band (src/ops/set-admin-password.ts). The
// down() restores the yahoo admin and removes the two added accounts.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO users (email, full_name, role)
    VALUES
      ('paul.popa@nbcc.scot',        'Paul Popa',        'admin'),
      ('jaimie.wakefield@nbcc.scot', 'Jaimie Wakefield', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin';
    DELETE FROM users WHERE email = 'paul.popa1995@yahoo.ro';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    INSERT INTO users (email, full_name, role)
    VALUES ('paul.popa1995@yahoo.ro', 'Paul', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin';
    DELETE FROM users WHERE email IN ('paul.popa@nbcc.scot', 'jaimie.wakefield@nbcc.scot');
  `);
};
