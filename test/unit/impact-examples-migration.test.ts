import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { STARTING_EXAMPLES } from "../../src/impact/examples";

// What gifts could do: the impact_examples table, seeded with the five examples Jaimie approved.
// Additive only (a new table). Checked against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000200_impact-examples.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
  SEED: Array<Record<string, unknown>>;
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
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

type Col = { type: string; notNull?: boolean; default?: unknown; primaryKey?: boolean; check?: string; unique?: boolean };

describe("the impact examples migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");
  const table = calls.find((c) => c.op === "createTable" && c.args[0] === "impact_examples");
  const cols = (table?.args[1] ?? {}) as Record<string, Col>;

  // node-pg-migrate refuses on production to run one that sorts before a migration already run: it
  // must come after everything merging before it (in memory 195, wording approvals 197, ball phone 198).
  it("sorts after 1791200000198, by name", () => {
    expect(NAME > "1791200000198").toBe(true);
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000197_touch-wording-approvals.js"));
  });

  it("makes one new table, and changes nothing else", () => {
    expect(calls.filter((c) => c.op === "createTable").map((c) => c.args[0])).toEqual(["impact_examples"]);
    expect(calls.some((c) => ["addColumns", "dropTable"].includes(c.op))).toBe(false);
    expect(sql).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE)\b/i);
  });

  it("has an amount, the words, on or off, an order, where it shows, and who changed it when", () => {
    expect(Object.keys(cols).sort()).toEqual([
      "active", "amount_pence", "created_at", "created_by", "id", "meter_line", "on_give_form", "sort_order", "updated_at", "updated_by", "wording",
    ]);
    expect(cols.amount_pence.notNull).toBe(true);
    expect(cols.amount_pence.check).toContain("amount_pence BETWEEN 100 AND 1000000");
    expect(cols.active.default).toBe(true);
    expect(cols.on_give_form.default).toBe(true);
    expect(cols.meter_line.unique).toBe(true);
    expect(cols.meter_line.check).toContain("'red_bags'");
    expect(cols.meter_line.check).toContain("'uniforms'");
  });

  it("holds the words to starting with could, and never a promise, in the database too", () => {
    expect(cols.wording.notNull).toBe(true);
    expect(cols.wording.check).toContain("wording ~* '^could\\M'");
    expect(cols.wording.check).toContain("wording !~* '\\m(will\\s+(buy|pay\\s+for|cover|fund|provide)|pays\\s+for|buys)\\M'");
  });

  it("seeds the five examples exactly as src/impact/examples.ts has them", () => {
    expect(
      migration.SEED.map((s) => ({
        amountPence: s.amountPence,
        wording: s.wording,
        active: s.active,
        sortOrder: s.sortOrder,
        onGiveForm: s.onGiveForm,
        meterLine: s.meterLine,
      })),
    ).toEqual(STARTING_EXAMPLES.map((e) => ({ ...e })));
    for (const s of STARTING_EXAMPLES) expect(sql).toContain(`'${s.wording.replace(/'/g, "''")}'`);
  });

  it("seeds only an empty table, so running it again adds nothing", () => {
    expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM impact_examples\)/);
  });

  it("drops only its own table on the way down", () => {
    const d = fakePgm();
    migration.down(d.pgm);
    expect(d.calls.map((c) => [c.op, c.args[0]])).toEqual([["dropTable", "impact_examples"]]);
  });
});
