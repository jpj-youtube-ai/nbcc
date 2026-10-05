import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { roleToPermissions } from "../../src/admin/permissions";

// Fill a Red Bag: the one migration that comes with staff editing of the list. A new table for the
// list's versions, and the new "red-bag" access section written into the access already saved (the
// rule since TASK-406: a saved matrix is a complete statement, so a section it does not name is
// denied, admins included). Additive only. Checked against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000260_red-bag-lists.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
  PERMISSIONS_BACKFILL: string;
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
      addConstraint: record("addConstraint"),
      addColumns: record("addColumns"),
      dropColumns: record("dropColumns"),
      alterColumn: record("alterColumn"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

type Col = { type: string; notNull?: boolean; default?: unknown; primaryKey?: boolean; check?: string; references?: string };

describe("the red bag lists migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const table = calls.find((c) => c.op === "createTable" && c.args[0] === "red_bag_lists");
  const cols = (table?.args[1] ?? {}) as Record<string, Col>;
  const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0]));

  // node-pg-migrate refuses, on production, to run a migration that sorts before one already run.
  it("sorts last of all, after 1791200000250", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all[all.length - 1]).toBe(NAME);
    expect(all[all.length - 2]).toBe("1791200000250_donation-source.js");
  });

  it("creates one new table, and touches no table that exists", () => {
    expect(calls.filter((c) => c.op === "createTable").map((c) => c.args[0])).toEqual(["red_bag_lists"]);
    expect(calls.some((c) => ["addColumns", "dropColumns", "alterColumn", "dropTable"].includes(c.op))).toBe(false);
  });

  it("keeps a whole list in each row, a draft or a published one", () => {
    expect(cols.id).toBe("id");
    expect(cols.status).toMatchObject({ type: "text", notNull: true });
    expect(cols.status.check).toBe("status IN ('draft', 'published')");
    expect(cols.data).toMatchObject({ type: "jsonb", notNull: true });
    expect(cols.version).toMatchObject({ type: "integer", notNull: true, default: 1 });
    expect(cols.changes).toMatchObject({ type: "jsonb", notNull: true });
    expect(cols.summary.type).toBe("text");
    expect(cols.restored_from).toMatchObject({ type: "integer", references: "red_bag_lists" });
    expect(cols.restored_original).toMatchObject({ type: "boolean", notNull: true, default: false });
    for (const c of ["created_at", "updated_at"]) expect(cols[c]).toMatchObject({ type: "timestamptz", notNull: true });
    expect(cols.published_at.type).toBe("timestamptz");
    expect(cols.published_at.notNull).toBeFalsy();
    for (const c of ["created_by", "updated_by", "updated_by_name", "published_by", "published_by_name"]) expect(cols[c].type).toBe("text");
  });

  it("allows one draft at most, by an index only drafts are in", () => {
    const index = calls.find((c) => c.op === "createIndex" && c.args[0] === "red_bag_lists" && (c.args[2] as { unique?: boolean }).unique);
    expect(index).toBeTruthy();
    expect(index!.args[1]).toBe("status");
    expect(index!.args[2]).toMatchObject({ unique: true, where: "status = 'draft'" });
  });

  it("makes a published row say when it was published", () => {
    const check = calls.find((c) => c.op === "addConstraint" && c.args[0] === "red_bag_lists");
    expect(JSON.stringify(check?.args)).toContain("status <> 'published' OR published_at IS NOT NULL");
  });

  it("seeds no list: the website keeps the built-in one until someone publishes", () => {
    expect(sql.join("\n")).not.toMatch(/INSERT INTO red_bag_lists/i);
  });

  it("writes the new section into the access already saved, at each role's own level", () => {
    expect(sql).toEqual([migration.PERMISSIONS_BACKFILL]);
    const found = [...migration.PERMISSIONS_BACKFILL.matchAll(/jsonb_build_object\(\s*'red-bag',\s*CASE role WHEN 'admin' THEN '(\w+)' WHEN 'editor' THEN '(\w+)' ELSE '(\w+)' END/g)];
    expect(found).toHaveLength(1);
    const [, admin, editor, anyoneElse] = found[0];
    expect({ admin, editor, anyoneElse }).toEqual({
      admin: roleToPermissions("admin")["red-bag"] ?? "none",
      editor: roleToPermissions("editor")["red-bag"] ?? "none",
      anyoneElse: roleToPermissions("viewer")["red-bag"] ?? "none",
    });
    // As agreed: admins have it, and nobody else until it is given to them.
    expect({ admin, editor, anyoneElse }).toEqual({ admin: "edit", editor: "none", anyoneElse: "none" });
  });

  it("only ever ADDS the key: people with no saved access, and a matrix that names it already, are left alone", () => {
    const s = migration.PERMISSIONS_BACKFILL;
    expect(s).toContain("permissions <> '{}'::jsonb");
    expect(s).toContain("NOT (permissions ? 'red-bag')");
    expect(s).toContain("permissions || jsonb_build_object(");
    // One UPDATE of users, and it sets nothing but the one key.
    expect(s.match(/UPDATE users/g)).toHaveLength(1);
    expect(s).not.toMatch(/DELETE|permissions\s*=\s*'|permissions - /i);
  });

  it("records every key it adds in the audit log", () => {
    const s = migration.PERMISSIONS_BACKFILL;
    expect(s).toContain("INSERT INTO audit_log");
    expect(s).toContain("'admin_user.permissions_backfilled'");
    expect(s).toContain("'migration:red-bag-lists'");
    expect(s).toContain("jsonb_build_object('section', 'red-bag', 'level', level)");
  });

  it("goes back by dropping its own table only, and takes nobody's access away", () => {
    const back = fakePgm();
    migration.down(back.pgm);
    expect(back.calls).toEqual([{ op: "dropTable", args: ["red_bag_lists"] }]);
  });

  it("has no comment that could pass for SQL, and no destructive word outside one", () => {
    const source = readFileSync(resolve(ROOT, "migrations", NAME), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/DROP COLUMN|ALTER TABLE users|TRUNCATE|RENAME/i);
  });
});
