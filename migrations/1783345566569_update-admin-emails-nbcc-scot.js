/* eslint-disable */
// TASK-147 (REQ-062): move the admin login identities onto the nbcc.scot domain and add a third
// admin. The two staff accounts seeded by 1783080586661 (kenny@ / isabella@) are repointed from the
// old nightbeforechristmas.co.uk domain to nbcc.scot, matching the public contact addresses
// (TASK-146). A third admin, paul.popa1995@yahoo.ro, is added.
//
// Additive / expand-contract, safe on populated data (golden rule 2): a data-only UPDATE + INSERT —
// it changes no schema, and drops/renames/alters no column, so a code-level rollback stays safe. The
// email is a natural key (UNIQUE), so the UPDATEs are keyed on the OLD address and the INSERT is
// idempotent via ON CONFLICT (email) DO UPDATE. No password_hash is set (golden rule 4: secrets never
// in code) — each account can log in only once a password is set out of band. The down() restores the
// old addresses and removes the added admin.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE users SET email = 'kenny@nbcc.scot'    WHERE email = 'kenny@nightbeforechristmas.co.uk';
    UPDATE users SET email = 'isabella@nbcc.scot' WHERE email = 'isabella@nightbeforechristmas.co.uk';
    INSERT INTO users (email, full_name, role)
    VALUES ('paul.popa1995@yahoo.ro', 'Paul', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM users WHERE email = 'paul.popa1995@yahoo.ro';
    UPDATE users SET email = 'kenny@nightbeforechristmas.co.uk'    WHERE email = 'kenny@nbcc.scot';
    UPDATE users SET email = 'isabella@nightbeforechristmas.co.uk' WHERE email = 'isabella@nbcc.scot';
  `);
};
