import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Jaimie 2026-10-03: Invite someone has a First name box and a Surname box (it was one name box,
// split at its first space). Both are kept on fundraiser_invites. Additive only: two nullable
// columns with their own length checks, and the old `name` column stays, so a code rollback is safe
// and an invite sent before this still works (it falls back to the old split). It must sort after
// keep-in-touch (170): node-pg-migrate refuses on production to run one that sorts before a
// migration already run.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000175_invite-first-last-name.js";
const PATH = resolve(ROOT, "migrations", NAME);

function run(fn: "up" | "down"): string {
  const migration = createRequire(import.meta.url)(PATH) as Record<"up" | "down", (pgm: { sql: (s: string) => void }) => void>;
  const sql: string[] = [];
  migration[fn]({ sql: (s: string) => sql.push(s) });
  return sql.join(" ");
}

describe("the invite first name and surname migration", () => {
  it("is there, under its own number", () => {
    expect(existsSync(PATH)).toBe(true);
  });

  it("adds a nullable first_name and last_name, each up to 50 characters, and leaves name alone", () => {
    const up = run("up");
    expect(up).toMatch(/ALTER TABLE fundraiser_invites/);
    expect(up).toMatch(/ADD COLUMN IF NOT EXISTS first_name text\b/);
    expect(up).toMatch(/ADD COLUMN IF NOT EXISTS last_name text\b/);
    expect(up).not.toMatch(/NOT NULL/i);
    expect(up).toContain("char_length(first_name) <= 50");
    expect(up).toContain("char_length(last_name) <= 50");
    // Additive only: nothing dropped, renamed or rewritten.
    expect(up).not.toMatch(/\bDROP\b/i);
    expect(up).not.toMatch(/\bRENAME\b/i);
    expect(up).not.toMatch(/\bUPDATE\b/i);
    expect(up).not.toMatch(/\bname\b(?!_)/);
  });

  it("takes only the two new columns away on the way down", () => {
    const down = run("down");
    expect(down).toContain("DROP COLUMN IF EXISTS first_name");
    expect(down).toContain("DROP COLUMN IF EXISTS last_name");
    expect(down).not.toMatch(/DROP COLUMN IF EXISTS name\b/);
  });

  it("sorts after keep-in-touch (170)", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js")).sort();
    expect(names).toContain("1791200000170_fundraising-keep-in-touch.js");
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000170_fundraising-keep-in-touch.js"));
  });
});
