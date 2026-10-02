import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { REQUEST_KINDS } from "../../src/fundraising/requests";

// TASK-511: the sign up form, round two, and short page links. Additive only (golden rule 2):
// five new nullable columns on fundraisers, one new table remembering every address a fundraiser's
// page used to have, and the requests' kind check WIDENED to take printed QR codes. Nothing that is
// there now changes, so a code rollback is safe. Checked against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000130_fundraising-form-v2.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
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

type Col = { type: string; notNull?: boolean; default?: unknown; references?: string; onDelete?: string; primaryKey?: boolean };

describe("the form round two migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");

  it("sorts after everything on main and both open fundraising PRs (110, 120)", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all[all.length - 1]).toBe(NAME);
    expect(NAME > "1791200000120").toBe(true);
  });

  it("adds the split name, the other kind, and the two social media links, every one nullable", () => {
    const added = calls.find((c) => c.op === "addColumns" && c.args[0] === "fundraisers");
    const cols = (added?.args[1] ?? {}) as Record<string, Col>;
    expect(Object.keys(cols).sort()).toEqual(["facebook", "first_name", "instagram", "kind_other", "last_name"]);
    for (const c of Object.values(cols)) {
      expect(c.type).toBe("text");
      expect(c.notNull).toBeFalsy();
      expect(c.default).toBeUndefined();
    }
  });

  it("remembers every old page address, each once, cleared with its fundraiser", () => {
    const table = calls.find((c) => c.op === "createTable" && c.args[0] === "fundraiser_slug_history");
    const cols = (table?.args[1] ?? {}) as Record<string, Col>;
    expect(cols.old_slug.primaryKey).toBe(true);
    expect(cols.fundraiser_id).toMatchObject({ notNull: true, references: "fundraisers", onDelete: "CASCADE" });
    expect(Object.keys(cols)).toEqual(expect.arrayContaining(["old_slug", "fundraiser_id", "created_at", "created_by"]));
  });

  it("only widens the requests' kind check: every kind the code knows, QR codes included", () => {
    const list = sql.match(/ADD CONSTRAINT fundraiser_requests_kind_check CHECK \(kind IN \(([^)]*)\)\)/);
    const kinds = list ? list[1].split(",").map((s) => s.trim().replace(/'/g, "")) : [];
    expect(kinds.sort()).toEqual([...REQUEST_KINDS].sort());
    expect(kinds).toContain("qr_codes");
    // The old check is found by what it says, whatever Postgres named it.
    expect(sql).toMatch(/pg_get_constraintdef\(oid\) LIKE '%kind IN%'/);
  });

  it("drops and deletes nothing that is there now", () => {
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)|DELETE|UPDATE/i);
    expect(calls.some((c) => c.op === "dropColumns" || c.op === "dropTable")).toBe(false);
  });

  it("goes back without failing on QR code requests already made", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    const downSql = down.calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");
    expect(downSql).toMatch(/NOT VALID/);
    expect(downSql).not.toMatch(/'qr_codes'/);
  });
});
