import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Jaimie 2026-10-03: the invite's personal note may be up to 5,000 characters (it was 600). The
// table check from TASK-503 is swapped for a named one with the new limit. It must run after the
// categories migration (160) and before keep-in-touch (170): node-pg-migrate refuses on production
// to run one that sorts before a migration already run.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000165_invite-note-limit.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: { sql: (s: string) => void }) => void;
  down: (pgm: { sql: (s: string) => void }) => void;
};

function run(fn: "up" | "down"): string {
  const sql: string[] = [];
  migration[fn]({ sql: (s: string) => sql.push(s) });
  return sql.join(" ");
}

describe("the invite note limit migration", () => {
  it("drops the old note check whatever Postgres named it, then adds the 5,000 limit", () => {
    const up = run("up");
    expect(up).toMatch(/char_length\(note\)/);
    expect(up).toMatch(/DROP CONSTRAINT/);
    expect(up).toContain("fundraiser_invites_note_length");
    expect(up).toContain("char_length(note) <= 5000");
    expect(up.indexOf("DROP CONSTRAINT")).toBeLessThan(up.indexOf("ADD CONSTRAINT"));
  });

  it("puts the 600 limit back on the way down, NOT VALID so longer notes already saved do not block it", () => {
    const down = run("down");
    expect(down).toContain("DROP CONSTRAINT IF EXISTS fundraiser_invites_note_length");
    expect(down).toContain("char_length(note) <= 600");
    expect(down).toContain("NOT VALID");
  });

  it("sorts after the TASK-503 team migration", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000070_fundraising-team.js"));
  });
});
