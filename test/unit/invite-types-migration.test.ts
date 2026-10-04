import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Invite types (Jaimie, B1 + I1): an invite says what the person is being invited to do, so its link
// opens the sign up form at the right place and its email has the right words. One nullable column,
// checked against the four values; an invite from before has none and behaves as it always did.
// Nothing is seeded as approved: the in memory wording waits for an admin's sign off.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000235_invite-types.js";
type Col = { type: string; notNull?: boolean; default?: unknown; check?: string };
type Pgm = {
  addColumns: (table: string, cols: Record<string, Col>) => void;
  dropColumns: (table: string, cols: string[]) => void;
  sql: (s: string) => void;
  createTable: () => void;
};
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as { up: (pgm: Pgm) => void; down: (pgm: Pgm) => void };

function run(fn: "up" | "down") {
  const added: Array<[string, Record<string, Col>]> = [];
  const dropped: Array<[string, string[]]> = [];
  const sql: string[] = [];
  let tables = 0;
  migration[fn]({
    addColumns: (t, c) => added.push([t, c]),
    dropColumns: (t, c) => dropped.push([t, c]),
    sql: (s) => sql.push(s),
    createTable: () => {
      tables += 1;
    },
  });
  return { added, dropped, sql: sql.join(" "), tables };
}

describe("the invite types migration", () => {
  it("adds one nullable invite_type to fundraiser_invites, with no default, checked against the four values", () => {
    const up = run("up");
    expect(up.added).toHaveLength(1);
    const [table, cols] = up.added[0];
    expect(table).toBe("fundraiser_invites");
    expect(Object.keys(cols)).toEqual(["invite_type"]);
    const col = cols.invite_type;
    expect(col.type).toBe("text");
    expect(col.notNull).toBeFalsy();
    expect(col.default).toBeUndefined();
    for (const v of ["raising", "team", "event", "memory"]) expect(col.check).toContain(`'${v}'`);
  });

  it("is additive only, and approves no wording: the in memory invite waits for sign off", () => {
    const up = run("up");
    expect(up.tables).toBe(0);
    expect(up.dropped).toHaveLength(0);
    expect(up.sql).not.toMatch(/touch_wording_approvals/);
    expect(up.sql).not.toMatch(/invite_memory/);
  });

  it("takes the column away on the way down", () => {
    expect(run("down").dropped).toEqual([["fundraiser_invites", ["invite_type"]]]);
  });

  it("sorts after the welcome pack migration, by name", () => {
    expect(NAME > "1791200000230").toBe(true);
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000215_event-tickets.js"));
  });
});
