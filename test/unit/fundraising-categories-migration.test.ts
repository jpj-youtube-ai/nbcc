import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { BUILT_IN_CATEGORIES, LEGACY_CATEGORIES, STARTING_CATEGORIES } from "../../src/fundraising/categories";

// Fundraising categories: the table the list lives in, seeded with the new list and the old
// categories (no longer offered, still named), and the hard coded check on fundraisers.kind swapped
// for a link to the table. Every sign up there now keeps its category. Checked against a fake pgm,
// without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000160_fundraising-categories.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
  SEED: Array<{ key: string; label: string; active: boolean }>;
};

function fakePgm() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  return {
    calls,
    pgm: {
      createTable: record("createTable"),
      dropTable: record("dropTable"),
      createIndex: record("createIndex"),
      addColumns: record("addColumns"),
      dropColumns: record("dropColumns"),
      addConstraint: record("addConstraint"),
      dropConstraint: record("dropConstraint"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

type Col = { type: string; notNull?: boolean; default?: unknown; primaryKey?: boolean; check?: string };

describe("the fundraising categories migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");

  it("sorts after everything on main and the open keep in touch work (150)", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all[all.length - 1]).toBe(NAME);
    expect(NAME > "1791200000150").toBe(true);
  });

  it("makes the table: a key that never changes, a name, on offer or not, and who added it when", () => {
    const table = calls.find((c) => c.op === "createTable" && c.args[0] === "fundraising_categories");
    const cols = (table?.args[1] ?? {}) as Record<string, Col>;
    expect(Object.keys(cols).sort()).toEqual(["active", "created_at", "created_by", "key", "label", "retired_at"]);
    expect(cols.key).toMatchObject({ type: "text", primaryKey: true });
    expect(cols.label).toMatchObject({ type: "text", notNull: true });
    expect(cols.active).toMatchObject({ type: "boolean", notNull: true, default: true });
    expect(cols.key.check).toMatch(/\^\[a-z\]\[a-z0-9_\]/);
  });

  it("never lets two categories have the same name, whatever the case", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX fundraising_categories_label_unique ON fundraising_categories \(lower\(label\)\)/);
  });

  it("seeds exactly the code's list: the new categories on offer, the old ones kept but not offered", () => {
    expect(migration.SEED).toEqual(BUILT_IN_CATEGORIES.map(({ key, label, active }) => ({ key, label, active })));
    for (const c of STARTING_CATEGORIES) expect(sql).toContain(`('${c.key}', '${c.label}', true`);
    for (const c of LEGACY_CATEGORIES) expect(sql).toContain(`('${c.key}', '${c.label}', false`);
    // Seeded once: run again (or after an admin renamed one), nothing is overwritten.
    expect(sql).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
  });

  it("keeps any category a sign up has that the list does not know, rather than failing", () => {
    expect(sql).toMatch(/INSERT INTO fundraising_categories[\s\S]*SELECT DISTINCT f\.kind[\s\S]*FROM fundraisers f[\s\S]*ON CONFLICT \(key\) DO NOTHING/);
  });

  // fundraisers_kind_check was named in 1791200000000 (pgm.addConstraint), so it is dropped by that
  // name; and any other check listing the old kinds too, found by one of them: Postgres keeps
  // "kind IN (...)" as "kind = ANY (ARRAY[...])", so the words "kind IN" are never there to find.
  it("drops the old hard coded check by its real name, before linking to the table", () => {
    const drop = sql.indexOf("ALTER TABLE fundraisers DROP CONSTRAINT IF EXISTS fundraisers_kind_check");
    expect(drop).toBeGreaterThan(-1);
    expect(sql).toMatch(/pg_get_constraintdef\(oid\) LIKE '%quiz_party%'/);
    expect(sql).not.toMatch(/LIKE '%kind IN%'/);
    const link = sql.indexOf("ADD CONSTRAINT fundraisers_kind_fkey FOREIGN KEY (kind) REFERENCES fundraising_categories (key)");
    expect(link).toBeGreaterThan(drop);
    // Seeded first, so every sign up's category is there when the link is checked.
    expect(sql.indexOf("SELECT DISTINCT f.kind")).toBeLessThan(link);
    // A category in use can never be deleted.
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
  });

  it("changes and deletes no sign up", () => {
    expect(sql).not.toMatch(/UPDATE fundraisers|DELETE FROM|DROP TABLE|DROP COLUMN/i);
    expect(calls.some((c) => c.op === "dropColumns" || c.op === "dropTable")).toBe(false);
  });

  it("goes back: the link and the table go, and the old check returns without failing on new categories", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    const downSql = down.calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS fundraisers_kind_fkey/);
    expect(downSql).toMatch(/ADD CONSTRAINT fundraisers_kind_check CHECK \(kind IN \('run_walk', 'santa_dash', 'bake_sale', 'quiz_party', 'collection', 'birthday', 'other'\)\) NOT VALID/);
    expect(downSql.indexOf("fundraisers_kind_fkey")).toBeLessThan(downSql.indexOf("ADD CONSTRAINT fundraisers_kind_check"));
    expect(down.calls.find((c) => c.op === "dropTable")?.args[0]).toBe("fundraising_categories");
  });
});
