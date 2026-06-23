/* eslint-disable */
// Sample expand-only migration. Follow expand-contract:
//   1) additive change ships with the code that uses it,
//   2) destructive cleanup (drop column/table) ships ONLY in a later release,
//      after the old code is fully gone. This keeps code-level rollback safe.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("supporters", {
    id: "id",
    email: { type: "text", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("supporters");
};
