import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// TASK-502: one nullable column, donations.wall_added_at: when a giver added their message and wall
// choices from the thank you after paying. It is what makes that step once only. Nullable, so every
// gift already there reads as never added, and a code rollback is safe (golden rule 2). Checked
// against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000060_fundraising-wall-after-paying.js";
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

describe("the wall after paying migration", () => {
  it("sorts after the private area's, which is on main", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000050_fundraising-private-area.js"));
  });

  it("adds only when the giver added to the wall, nullable", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    expect(calls).toEqual([{ op: "addColumns", args: ["donations", { wall_added_at: { type: "timestamptz" } }] }]);
  });

  it("can be undone", () => {
    const { calls, pgm } = fakePgm();
    migration.down(pgm);
    expect(calls).toEqual([{ op: "dropColumns", args: ["donations", ["wall_added_at"]] }]);
  });
});
