import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Event pages: every approved public event gets its own page at /event/<short name>, and staff must
// set the short name before approving one. One new nullable column says when they did, so it is
// additive (golden rule 2) and a code rollback is safe. Events already approved keep the address
// they have, counted as set. Checked against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000185_event-pages.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

function fakePgm() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  return { calls, pgm: { addColumns: record("addColumns"), dropColumns: record("dropColumns"), sql: record("sql") } };
}

describe("the event pages migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");

  it("adds one nullable timestamp to fundraisers: when staff set the short name", () => {
    const adds = calls.filter((c) => c.op === "addColumns");
    expect(adds).toHaveLength(1);
    expect(adds[0].args[0]).toBe("fundraisers");
    expect(adds[0].args[1]).toEqual({ slug_set_at: { type: "timestamptz" } });
  });

  it("counts the short name of every event already approved or finished as set, so none is stuck", () => {
    expect(sql).toMatch(/UPDATE fundraisers SET slug_set_at = COALESCE\(approved_at, updated_at\)/);
    expect(sql).toMatch(/path = 'event'/);
    expect(sql).toMatch(/status IN \('approved', 'finished'\)/);
    expect(sql).toMatch(/slug_set_at IS NULL/);
  });

  it("drops nothing and renames nothing on the way up", () => {
    expect(calls.map((c) => c.op).filter((op) => op !== "addColumns" && op !== "sql")).toEqual([]);
    expect(sql).not.toMatch(/\b(DROP|ALTER|DELETE|RENAME)\b/i);
  });

  it("can be undone", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    expect(down.calls).toEqual([{ op: "dropColumns", args: ["fundraisers", ["slug_set_at"]] }]);
  });

  // node-pg-migrate refuses on production to run one that sorts before a migration already run: it
  // must come after keep in touch (170) and the two numbers taken by builds alongside it (175, 180).
  it("sorts after keep in touch and after 180", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000170_fundraising-keep-in-touch.js"));
    expect(names.indexOf("1791200000180_signup-age-and-split.js")).toBeGreaterThan(-1);
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000180_signup-age-and-split.js"));
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000175_invite-first-last-name.js"));
  });
});
