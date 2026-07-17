import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-262 (REQ-003): the migration adding the July 2026 Master Supporter List partners to
// supporter_ticker, on top of the original seed (1783709948147 / TASK-181). Data-only and idempotent
// (INSERT … WHERE NOT EXISTS), so it is additive/expand-contract safe (golden rule 2). The live
// "the rows land" check runs in CI's migrations job; here we guard shape so it can't drift.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(ROOT, "migrations/1784900000000_seed-partners-july-2026.js"), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));
const down = src.slice(src.indexOf("exports.down"));

// The NAMES array only — NOT the header comment, which quotes example names for documentation.
const namesBlock = /const NAMES = \[([\s\S]*?)\];/.exec(src)![1];
const NAMES = [...namesBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

describe("seed-partners-july-2026 migration", () => {
  it("inserts partner names into supporter_ticker, idempotently", () => {
    expect(up).toMatch(/insert\s+into\s+supporter_ticker/i);
    expect(up).toMatch(/where\s+not\s+exists/i); // no duplicates on re-run / pre-existing rows
  });

  // The point of this migration's guard: supporter_ticker.active DEFAULTS TO TRUE, and
  // 1783715098494_partners-hidden-by-default was a one-shot UPDATE that will not hide rows added
  // later. Inserting without an explicit false would push all 266 partners live on deploy.
  it("inserts partners HIDDEN so staff review and reveal them one at a time", () => {
    expect(up).toMatch(/insert\s+into\s+supporter_ticker\s*\(\s*name\s*,\s*active\s*,\s*sort_order\s*\)/i);
    expect(up).toMatch(/select\s+v\.name\s*,\s*false\s*,\s*0/i);
    expect(up).not.toMatch(/select\s+v\.name\s*,\s*true/i);
  });

  // The original seed compared raw names (s.name = v.name), which would not catch punctuation or
  // casing variants. This one normalises BOTH sides, so "Morrisons, Ayr" cannot duplicate the
  // already-seeded "Morrisons Ayr".
  it("dedupes on a normalised key, not a raw name match", () => {
    expect(up).toMatch(/regexp_replace\(\s*lower\(\s*s\.name\s*\)\s*,\s*'\[\^a-z0-9\]\+'\s*,\s*''\s*,\s*'g'\s*\)/i);
    expect(up).toMatch(/regexp_replace\(\s*lower\(\s*v\.name\s*\)\s*,\s*'\[\^a-z0-9\]\+'\s*,\s*''\s*,\s*'g'\s*\)/i);
  });

  it("escapes single quotes in names (so apostrophes don't break the SQL)", () => {
    expect(src).toContain(".replace(/'/g, \"''\")");
    expect(NAMES.some((n) => n.includes("'"))).toBe(true); // e.g. Maggie's — the escaping is load-bearing
  });

  it("carries the full July 2026 list, excluding partners already seeded", () => {
    expect(NAMES).toHaveLength(266);

    // Approved as genuinely separate partners from a similarly-named seeded one.
    expect(NAMES).toContain("Ayr United Football Academy"); // vs seeded "Ayr United Football club"
    expect(NAMES).toContain("Wellington School Nursery"); // vs seeded "Wellington School"

    // Already in the original seed under a different spelling — must not be added twice.
    for (const dupe of [
      "Morrisons, Ayr", // seeded as "Morrisons Ayr"
      "Carrick Quilters", // seeded as "The Carrick Quilters"
      "Pro Lawn Ltd", // seeded as "Pro Lawn"
      "Acute Stroke Unit, Crosshouse", // seeded as "Acute Stroke Unit Crosshouse"
      "Doonfoot Primary", // seeded as "Doonfoot Primary School"
      "Monkton Primary", // seeded as "Monkton Primary School"
      "15th Paisley Boys Brigade - Ina", // seeded as "15th Paisley Boys Brigade"
    ]) {
      expect(NAMES).not.toContain(dupe);
    }
  });

  // Names only: the source sheet carries contact names, emails and phone numbers, and this table
  // feeds PUBLIC surfaces (the site-wide ticker and the Supporters page).
  it("imports names only — no contact details leak in", () => {
    expect(namesBlock).not.toMatch(/@/); // no email addresses
    expect(namesBlock).not.toMatch(/\d{5,}/); // no phone numbers
  });

  it("has no normalised collisions within its own batch", () => {
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    expect(new Set(NAMES.map(key)).size).toBe(NAMES.length);
  });

  it("is additive-only — nothing dropped/renamed/altered in the up", () => {
    expect(up).not.toMatch(/dropColumn|dropTable|renameColumn|alterColumn|createTable/i);
    expect(up).not.toMatch(/drop\s+table|drop\s+column|alter\s+column|not\s+null/i);
  });

  it("down removes exactly what up added, on the same normalised key", () => {
    expect(down).toMatch(/delete\s+from\s+supporter_ticker/i);
    expect(down).toMatch(/regexp_replace/i);
  });
});
