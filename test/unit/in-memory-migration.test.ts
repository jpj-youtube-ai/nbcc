import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// In memory pages (Jaimie, 2026-10-03): a page set up in memory of someone. The fundraiser keeps who
// it remembers and who set it up; a gift keeps whether the giver asked to let the family know, and
// when staff approved its message (every message on an in memory page waits for staff). Additive
// only, so a code rollback is safe, and numbered after the team pages migration (190), which merges
// first: node-pg-migrate refuses on production to run one that sorts before one already run.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000195_in-memory.js";

type Call = { op: string; args: unknown[] };
function fakePgm() {
  const calls: Call[] = [];
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  return {
    calls,
    pgm: {
      addColumns: rec("addColumns"),
      dropColumns: rec("dropColumns"),
      addConstraint: rec("addConstraint"),
      dropConstraint: rec("dropConstraint"),
      createIndex: rec("createIndex"),
      dropIndex: rec("dropIndex"),
      sql: rec("sql"),
    },
  };
}

const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

describe("the in memory migration", () => {
  it("adds who the page remembers and who set it up to fundraisers, every one nullable or with a default", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const add = calls.find((c) => c.op === "addColumns" && c.args[0] === "fundraisers");
    expect(add).toBeTruthy();
    const cols = add?.args[1] as Record<string, { type: string; notNull?: boolean; default?: unknown }>;
    expect(Object.keys(cols).sort()).toEqual(
      [
        "in_memory",
        "memory_dates",
        "memory_name",
        "memory_permission",
        "memory_reminder_done_at",
        "memory_reminder_done_by",
        "memory_setup_by",
        "memory_show_target",
      ].sort(),
    );
    expect(cols.in_memory).toMatchObject({ type: "boolean", notNull: true, default: false });
    for (const [name, c] of Object.entries(cols)) {
      if (name !== "in_memory") expect(c.notNull, name).toBeFalsy();
    }
  });

  it("adds the family tick and the staff check of a message to donations", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const add = calls.find((c) => c.op === "addColumns" && c.args[0] === "donations");
    const cols = add?.args[1] as Record<string, { type: string; notNull?: boolean; default?: unknown }>;
    expect(Object.keys(cols).sort()).toEqual(["family_notify", "message_approved_at", "message_approved_by"]);
    expect(cols.family_notify).toMatchObject({ type: "boolean", notNull: true, default: false });
  });

  it("holds an in memory page to a name, who set it up, and the family's permission; rows already there pass", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const checks = calls.filter((c) => c.op === "addConstraint").map((c) => JSON.stringify(c.args));
    const all = checks.join(" ");
    expect(all).toContain("memory_setup_by IS NULL OR memory_setup_by IN ('family', 'friend', 'funeral_director')");
    expect(all).toContain("in_memory IS NOT TRUE OR");
    expect(all).toContain("memory_permission IS TRUE");
    expect(all).toContain("char_length(memory_name) <= 100");
    expect(all).toContain("char_length(memory_dates) <= 60");
  });

  it("takes it all away again on the way down", () => {
    const { calls, pgm } = fakePgm();
    migration.down(pgm);
    const dropped = calls.filter((c) => c.op === "dropColumns").map((c) => c.args[0]);
    expect(dropped).toEqual(expect.arrayContaining(["fundraisers", "donations"]));
  });

  it("sorts after the team pages migration", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js")).sort();
    expect(names).toContain(NAME);
    expect(NAME > "1791200000190").toBe(true);
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000180_signup-age-and-split.js"));
  });
});
