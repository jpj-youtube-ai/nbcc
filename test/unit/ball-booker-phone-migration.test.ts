import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Jaimie 2026-10-03: the Festive Ball booking form asks for the booker's phone number. Stored on the
// booking in one new nullable column: bookings made before have none, and the old code, which inserts
// without it during the deploy, keeps working (golden rule 2). It must sort after the migrations merged
// before it (195, 197) and before the ones still to merge (200, 205): node-pg-migrate refuses on production
// to run one that sorts before a migration already run.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000198_ball-booker-phone.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: { sql: (s: string) => void }) => void;
  down: (pgm: { sql: (s: string) => void }) => void;
};

function run(fn: "up" | "down"): string {
  const sql: string[] = [];
  migration[fn]({ sql: (s: string) => sql.push(s) });
  return sql.join(" ");
}

describe("the ball booker phone migration", () => {
  it("adds one nullable text column, with a length check matching the form's 40 characters", () => {
    const up = run("up");
    expect(up).toMatch(/ALTER TABLE ball_bookings\s+ADD COLUMN IF NOT EXISTS buyer_phone text/);
    expect(up).not.toMatch(/NOT NULL/i);
    expect(up).not.toMatch(/DEFAULT/i);
    expect(up).toContain("ball_bookings_buyer_phone_length");
    expect(up).toContain("buyer_phone IS NULL OR char_length(buyer_phone) <= 40");
    // Additive only: nothing dropped, renamed or rewritten on the way up.
    expect(up).not.toMatch(/DROP|RENAME|UPDATE /i);
  });

  it("takes the column away on the way down", () => {
    expect(run("down")).toContain("DROP COLUMN IF EXISTS buyer_phone");
  });

  it("sorts after 1791200000197 and before 1791200000200", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js")).sort();
    expect(names).toContain(NAME);
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000190_teams.js"));
    expect(NAME > "1791200000197").toBe(true);
    expect(NAME < "1791200000200").toBe(true);
  });
});
