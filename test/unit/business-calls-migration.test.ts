import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// TASK-491: the migration behind the call reminders. Additive only (golden rule 2): a nullable phone
// column, a new calls table, and a one off copy of phone numbers the outreach screen already holds.
// The backfill itself runs against Postgres in features/business-calls.feature; this checks its shape.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const FILE = "1791100000000_business-supporter-calls.js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require(resolve(ROOT, "migrations", FILE));

type Call = { op: string; args: unknown[] };
function record(fn: "up" | "down"): Call[] {
  const calls: Call[] = [];
  const pgm = new Proxy(
    { func: (s: string) => ({ fn: s }) },
    {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return (...args: unknown[]) => calls.push({ op: prop, args });
      },
    },
  );
  migration[fn](pgm);
  return calls;
}

describe("the business supporter calls migration", () => {
  // It sorted last when it shipped; later migrations sort after it (TASK-492 is the next), so this
  // now checks it still sorts after the one that was highest before it.
  it("sorts after every migration that was on main before it, so production never saw it out of order", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("1791000000003_ball-transfer-invoices.js"));
  });

  it("adds a nullable phone to the fulfilment record", () => {
    const add = record("up").find((c) => c.op === "addColumns" || c.op === "addColumn");
    expect(add?.args[0]).toBe("business_supporter_fulfilment");
    const cols = add?.args[1] as Record<string, { type: string; notNull?: boolean }>;
    expect(cols.phone.type).toBe("text");
    expect(cols.phone.notNull).toBeFalsy();
  });

  it("creates the calls table, tied to the record and cleared with it", () => {
    const create = record("up").find((c) => c.op === "createTable");
    expect(create?.args[0]).toBe("business_supporter_calls");
    const cols = create?.args[1] as Record<string, Record<string, unknown>>;
    expect(cols.fulfilment_id).toMatchObject({
      notNull: true,
      references: "business_supporter_fulfilment",
      onDelete: "CASCADE",
    });
    expect(cols.called_at).toMatchObject({ type: "timestamptz", notNull: true });
    expect(cols.called_by.type).toBe("text");
    expect(cols.note.type).toBe("text");
    expect(cols.note.notNull).toBeFalsy();
  });

  it("indexes calls by record, newest first", () => {
    const index = record("up").find((c) => c.op === "createIndex");
    expect(index?.args[0]).toBe("business_supporter_calls");
    expect(JSON.stringify(index?.args[1])).toMatch(/fulfilment_id.*called_at/);
  });

  it("keeps a note to 500 characters in the database too", () => {
    const create = record("up").find((c) => c.op === "createTable");
    const opts = JSON.stringify(create?.args[2] ?? {});
    expect(opts).toMatch(/char_length\(note\)\s*<=\s*500/);
  });

  it("copies an outreach phone only into an empty phone, and only a valid one", () => {
    const sql: string = migration.BACKFILL_PHONE_SQL;
    expect(record("up").some((c) => c.op === "sql" && c.args[0] === sql)).toBe(true);
    expect(sql).toMatch(/business_outreach/);
    expect(sql).toMatch(/donor_id/);
    expect(sql).toMatch(/contact_phone/);
    expect(sql).toMatch(/f\.phone\s+IS\s+NULL/i);
    expect(sql).toMatch(/\[0-9 \+\(\)-\]/);
    expect(sql).toMatch(/<=\s*40/);
  });

  it("does nothing destructive on the way up", () => {
    const ops = record("up").map((c) => c.op);
    for (const bad of ["dropColumn", "dropColumns", "dropTable", "renameColumn", "alterColumn"]) {
      expect(ops).not.toContain(bad);
    }
  });

  it("undoes itself on the way down", () => {
    const ops = record("down").map((c) => c.op);
    expect(ops).toContain("dropTable");
    expect(ops.some((o) => o === "dropColumn" || o === "dropColumns")).toBe(true);
  });
});
