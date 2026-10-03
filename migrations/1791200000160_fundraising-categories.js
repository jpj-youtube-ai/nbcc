/* eslint-disable camelcase */

// Fundraising categories: one category each, A to Z, and staff can add more.
//
//   fundraising_categories   what someone is doing to raise money, or what kind of event it is: a
//                            key that never changes (fundraisers.kind holds it), the name people
//                            read, and whether the sign up form offers it. Admins add, rename and
//                            hide them in Admin > Fundraising. Never deleted, so every sign up's
//                            category always has a name.
//
// Seeded with the new list (one category each: Bake sale, Birthday, Coffee morning, Party, Quiz, Run,
// Santa dash, School collection, Walk, Workplace collection, and Something else) and the old "this or
// that" ones (Run or walk, Bake sale or coffee morning, Quiz or party, Workplace or school collection),
// kept but no longer offered: the sign ups that chose one keep it, and its name, until staff change
// it. Santa dash, Birthday and Something else mean what they always did, so they keep their keys.
// The list matches src/fundraising/categories.ts (checked by test/unit/fundraising-categories-migration.test.ts).
//
// fundraisers.kind: the hard coded check from 1791200000000 (fundraisers_kind_check, named there by
// pgm.addConstraint) is replaced by a link to the table, so a new category can be used and a category
// in use can never be deleted. Every key a sign up has is in the table before the link is made.
//
// Additive (golden rule 2): a new table, and a check that only widens (every key the old code writes
// is in the table). No sign up is changed. Code from before this release reads and writes as it did,
// so a code rollback is safe.
// Numbered 1791200000160: above 1791200000130 (the highest on main) and 150 (the keep in touch work,
// still open), so it sorts last whichever lands first.

exports.shorthands = undefined;

/** The list, as src/fundraising/categories.ts has it (BUILT_IN_CATEGORIES). */
const SEED = [
  { key: "bake_sale_2", label: "Bake sale", active: true },
  { key: "birthday", label: "Birthday", active: true },
  { key: "coffee_morning", label: "Coffee morning", active: true },
  { key: "party", label: "Party", active: true },
  { key: "quiz", label: "Quiz", active: true },
  { key: "run", label: "Run", active: true },
  { key: "santa_dash", label: "Santa dash", active: true },
  { key: "school_collection", label: "School collection", active: true },
  { key: "walk", label: "Walk", active: true },
  { key: "workplace_collection", label: "Workplace collection", active: true },
  { key: "other", label: "Something else", active: true },
  { key: "run_walk", label: "Run or walk", active: false },
  { key: "bake_sale", label: "Bake sale or coffee morning", active: false },
  { key: "quiz_party", label: "Quiz or party", active: false },
  { key: "collection", label: "Workplace or school collection", active: false },
];
exports.SEED = SEED;

const OLD_KINDS = ["run_walk", "santa_dash", "bake_sale", "quiz_party", "collection", "birthday", "other"];

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// The old check by its name, then any other check that lists the old kinds (found by one of them:
// Postgres keeps "kind IN (...)" as "(kind = ANY (ARRAY['run_walk'::text, ...]))", so the words
// "kind IN" are never there to find). Checks only (contype 'c'), so the link below is never touched.
const dropKindChecks = `
  ALTER TABLE fundraisers DROP CONSTRAINT IF EXISTS fundraisers_kind_check;
  DO $$
  DECLARE c text;
  BEGIN
    FOR c IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'fundraisers'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%quiz_party%'
    LOOP
      EXECUTE format('ALTER TABLE fundraisers DROP CONSTRAINT %I', c);
    END LOOP;
  END $$;
`;

exports.up = (pgm) => {
  pgm.createTable(
    "fundraising_categories",
    {
      key: { type: "text", primaryKey: true, check: "key ~ '^[a-z][a-z0-9_]{0,39}$'" },
      label: { type: "text", notNull: true, check: "char_length(label) BETWEEN 1 AND 60" },
      active: { type: "boolean", notNull: true, default: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      created_by: { type: "text" },
      retired_at: { type: "timestamptz" },
    },
    { comment: "Fundraising categories: one each, A to Z on the sign up form; admins add, rename and hide them. Never deleted." },
  );
  // Two categories never share a name, whatever the case ("Quiz" and "quiz").
  pgm.sql("CREATE UNIQUE INDEX fundraising_categories_label_unique ON fundraising_categories (lower(label))");

  const rows = SEED.map((c) => `(${quote(c.key)}, ${quote(c.label)}, ${c.active}, ${c.active ? "NULL" : "now()"}, 'migration')`).join(",\n    ");
  pgm.sql(`INSERT INTO fundraising_categories (key, label, active, retired_at, created_by) VALUES
    ${rows}
  ON CONFLICT (key) DO NOTHING`);

  // Belt and braces: any category a sign up has that the list does not know (there should be none,
  // as the old check allowed only the seven) is kept, not offered, named from its key.
  pgm.sql(`INSERT INTO fundraising_categories (key, label, active, retired_at, created_by)
    SELECT DISTINCT f.kind, initcap(replace(f.kind, '_', ' ')), false, now(), 'migration'
      FROM fundraisers f
     WHERE f.kind ~ '^[a-z][a-z0-9_]{0,39}$'
  ON CONFLICT (key) DO NOTHING`);

  pgm.sql(dropKindChecks);
  pgm.sql(
    "ALTER TABLE fundraisers ADD CONSTRAINT fundraisers_kind_fkey FOREIGN KEY (kind) REFERENCES fundraising_categories (key) ON UPDATE RESTRICT ON DELETE RESTRICT",
  );
};

// Back to the old check. NOT VALID, so sign ups that chose a new category do not stop the rollback;
// new rows are held to the old list again, as the code before this expects.
exports.down = (pgm) => {
  pgm.sql("ALTER TABLE fundraisers DROP CONSTRAINT IF EXISTS fundraisers_kind_fkey");
  pgm.sql(dropKindChecks);
  pgm.sql(
    `ALTER TABLE fundraisers ADD CONSTRAINT fundraisers_kind_check CHECK (kind IN (${OLD_KINDS.map(quote).join(", ")})) NOT VALID`,
  );
  pgm.dropTable("fundraising_categories");
};
