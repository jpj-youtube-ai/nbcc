/* eslint-disable */
// TASK-105 (REQ-062): give admin/staff `users` a login credential. The users table
// (1782987698792) already carries the role enum (viewer/editor/admin, NOT NULL default
// 'viewer'), so RBAC identity is already modelled — this only adds the missing credential:
// a password hash the admin login endpoint verifies against.
//
// Additive / expand-contract, safe on populated data (golden rule 2): ONE brand-new
// NULLABLE column. Every existing user back-fills to NULL (no login until a hash is set,
// which is the safe default), and no existing column is dropped, renamed or made NOT NULL,
// so a code-level rollback stays safe. Independent of the earlier additive migrations
// (order between them does not matter). Mirrors the nullable-column style of
// 1783068943728 (declaration-revocation).
//
// The password IS NOT stored here — password_hash holds a salted scrypt hash
// (scrypt$<saltHex>$<keyHex>), produced/verified by src/admin/password.ts. The plaintext
// never touches the database or the logs (golden rule 4).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("users", {
    // Salted scrypt password hash (scrypt$<saltHex>$<keyHex>); NULL for an account with no
    // password set yet (e.g. an invited user), which simply cannot log in until one is set.
    password_hash: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("users", "password_hash");
};
