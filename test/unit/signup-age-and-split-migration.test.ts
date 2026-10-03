import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// The sign up form asks two more things (Jaimie, 2026-10-03): are you 18 or over, and are you sharing
// what you raise with another cause (and if so, NBCC's percentage and the other cause's name). Four
// nullable columns on fundraisers, so every row already there is untouched (old ones read as null and
// show nothing) and a code rollback is safe (golden rule 2), with checks that hold the split together.
// Checked against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000180_signup-age-and-split.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

function fakePgm() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  return {
    calls,
    pgm: {
      addColumns: record("addColumns"),
      dropColumns: record("dropColumns"),
      addConstraint: record("addConstraint"),
      dropConstraint: record("dropConstraint"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

describe("the sign up age and split migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const adds = calls.filter((c) => c.op === "addColumns");
  const columns = (adds[0]?.args[1] ?? {}) as Record<string, { type: string; notNull?: boolean; default?: unknown }>;
  const checks = calls
    .filter((c) => c.op === "addConstraint")
    .map((c) => ({ name: String(c.args[1]), def: JSON.stringify(c.args[2]) }));

  // Never "is the last one": other changes add their own. It must sort after keep in touch (170),
  // the highest on main, and after 175, which another change is adding.
  it("sorts after keep in touch (170) and after 175", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000170_fundraising-keep-in-touch.js"));
    expect(NAME > "1791200000175").toBe(true);
  });

  it("adds four nullable columns to fundraisers, with no default, so old rows read as not asked", () => {
    expect(adds).toHaveLength(1);
    expect(adds[0].args[0]).toBe("fundraisers");
    expect(Object.keys(columns)).toEqual(["over_18", "shares_with_other", "nbcc_share_percent", "other_cause_name"]);
    for (const [name, col] of Object.entries(columns)) {
      expect(col.notNull, name).toBeFalsy();
      expect(col.default, name).toBeUndefined();
    }
    expect(columns.over_18.type).toBe("boolean");
    expect(columns.shares_with_other.type).toBe("boolean");
    expect(columns.nbcc_share_percent.type).toBe("integer");
    expect(columns.other_cause_name.type).toBe("text");
  });

  it("holds the percentage to 1 to 99 and the name to a sensible length", () => {
    const pct = checks.find((c) => c.name === "fundraisers_nbcc_share_percent_range");
    expect(pct?.def).toContain("nbcc_share_percent BETWEEN 1 AND 99");
    const name = checks.find((c) => c.name === "fundraisers_other_cause_name_length");
    expect(name?.def).toContain("char_length(other_cause_name) <= 120");
  });

  it("needs both the percentage and the name when sharing, and neither when not", () => {
    const split = checks.find((c) => c.name === "fundraisers_split_complete");
    expect(split?.def).toContain("shares_with_other IS TRUE");
    expect(split?.def).toContain("nbcc_share_percent IS NOT NULL");
    expect(split?.def).toContain("btrim(other_cause_name) <> ''");
    expect(split?.def).toContain("nbcc_share_percent IS NULL AND other_cause_name IS NULL");
  });

  it("takes everything away again on the way down", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    const drops = down.calls.filter((c) => c.op === "dropColumns");
    expect(drops[0].args[0]).toBe("fundraisers");
    expect(drops[0].args[1]).toEqual(["over_18", "shares_with_other", "nbcc_share_percent", "other_cause_name"]);
  });
});
