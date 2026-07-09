/* eslint-disable */
// REQ-062: add jon@nbcc.scot (Jon McFarlane) to the admin login roster, matching the existing
// @nbcc.scot admins (kenny@, isabella@, paul.popa@, jaimie.wakefield@).
//
// Additive / expand-contract, safe on populated data (golden rule 2): a data-only INSERT — no schema
// change, no drop/rename/alter, so a code-level rollback stays safe. Email is a natural key (UNIQUE),
// so the INSERT is idempotent via ON CONFLICT (email) DO UPDATE (promotes an existing viewer/editor
// to admin). NO password_hash is set (golden rule 4: secrets never in code) — the account cannot log
// in until a password is set out of band via src/ops/set-admin-password.ts (on staging/prod, the
// one-off ECS task with ADMIN_PASSWORD sourced from the ADMIN_BOOTSTRAP_PASSWORD SSM SecureString).
// The down() removes the account.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO users (email, full_name, role)
    VALUES ('jon@nbcc.scot', 'Jon McFarlane', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM users WHERE email = 'jon@nbcc.scot';`);
};
