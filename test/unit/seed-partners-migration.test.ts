import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-181 (REQ-003): the migration that seeds the real partner list into supporter_ticker. Data-only
// and idempotent (INSERT … WHERE NOT EXISTS), so it is additive/expand-contract safe (golden rule 2).
// The live "the rows land" check runs in CI's migrations job; here we guard shape so it can't drift.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(ROOT, "migrations/1783709948147_seed-partners.js"), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("seed-partners migration", () => {
  it("inserts partner names into supporter_ticker, idempotently", () => {
    expect(up).toMatch(/insert\s+into\s+supporter_ticker/i);
    expect(up).toMatch(/where\s+not\s+exists/i); // no duplicates on re-run / pre-existing rows
  });

  it("escapes single quotes in names (so apostrophes don't break the SQL)", () => {
    expect(src).toContain(".replace(/'/g, \"''\")");
  });

  it("carries a large, real name list including known partners", () => {
    expect(src).toContain("Ayrshire College");
    expect(src).toContain("Whiteleys Retreat");
    // a healthy list (100+), not a stub
    const count = (src.match(/^\s{2}"[^"]+",$/gm) ?? []).length;
    expect(count).toBeGreaterThan(100);
  });

  it("is additive-only — nothing dropped/renamed/altered in the up", () => {
    expect(up).not.toMatch(/dropColumn|dropTable|renameColumn|alterColumn|createTable/i);
    expect(up).not.toMatch(/drop\s+table|drop\s+column|alter\s+column|not\s+null/i);
  });
});
