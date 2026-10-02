import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// TASK-506: the news updates an organiser posts. One new table, so the rows already there are
// untouched and a code rollback is safe (golden rule 2). Checked against a fake pgm, without a
// database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000100_fundraiser-updates.js";
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
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

type Col = { type: string; notNull?: boolean; default?: unknown; unique?: boolean; references?: string; onDelete?: string; check?: string };

describe("the news updates migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const table = calls.find((c) => c.op === "createTable" && c.args[0] === "fundraiser_updates");
  const cols = (table?.args[1] ?? {}) as Record<string, Col>;
  const opts = (table?.args[2] ?? {}) as { constraints?: { check?: string | string[] }; comment?: string };

  it("sorts last, above everything on main (the highest there is TASK-505's 080)", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all[all.length - 1]).toBe(NAME);
    expect(NAME > "1791200000080").toBe(true);
  });

  it("only adds: one table and its indexes", () => {
    expect(calls.map((c) => c.op).filter((op) => op !== "createTable" && op !== "createIndex")).toEqual([]);
    expect(calls.filter((c) => c.op === "createTable").map((c) => c.args[0])).toEqual(["fundraiser_updates"]);
  });

  it("belongs to a fundraiser, and goes with it", () => {
    expect(cols.fundraiser_id).toMatchObject({ type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" });
  });

  it("keeps the words, up to 500 characters", () => {
    expect(cols.body).toMatchObject({ type: "text", notNull: true });
    expect(JSON.stringify(opts.constraints)).toContain("char_length(body) BETWEEN 1 AND 500");
  });

  it("waits for staff by default, and can only be pending, approved, rejected or hidden", () => {
    expect(cols.status).toMatchObject({ type: "text", notNull: true, default: "pending" });
    expect(cols.status.check).toBe("status IN ('pending', 'approved', 'rejected', 'hidden')");
  });

  it("keeps an optional photo by its own address, of the three types only", () => {
    expect(cols.photo_id).toMatchObject({ type: "uuid", unique: true });
    expect(cols.photo_id.notNull).toBeFalsy();
    expect(cols.photo_bytes).toMatchObject({ type: "bytea" });
    expect(cols.photo_mime.check).toBe("photo_mime IS NULL OR photo_mime IN ('image/jpeg', 'image/png', 'image/webp')");
    expect(JSON.stringify(opts.constraints)).toContain("(photo_id IS NULL) = (photo_bytes IS NULL)");
  });

  it("records who decided, when, and an internal reason", () => {
    for (const c of ["decided_at", "decided_by", "reject_reason", "created_at"]) expect(cols[c]).toBeDefined();
    expect(JSON.stringify(opts.constraints)).toContain("reject_reason IS NULL OR char_length(reject_reason) <= 500");
  });

  it("is indexed for a fundraiser's updates, newest first, and for those waiting", () => {
    const idx = calls.filter((c) => c.op === "createIndex").map((c) => JSON.stringify(c.args));
    expect(idx.some((i) => i.includes("fundraiser_id") && i.includes("created_at"))).toBe(true);
    expect(idx.some((i) => i.includes("status = 'pending'"))).toBe(true);
  });

  it("undoes itself", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    expect(down.calls.map((c) => `${c.op}:${c.args[0]}`)).toEqual(["dropTable:fundraiser_updates"]);
  });
});
