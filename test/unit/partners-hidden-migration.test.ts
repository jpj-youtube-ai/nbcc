import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-182 (REQ-003): the migration that hides the seeded partners by default. Data-only flag flip,
// additive/expand-contract safe (golden rule 2) — no schema change. CI's migrations job runs it live.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(ROOT, "migrations/1783715098494_partners-hidden-by-default.js"), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("partners-hidden-by-default migration", () => {
  it("sets active = false on supporter_ticker in the up", () => {
    expect(up).toMatch(/update\s+supporter_ticker\s+set\s+active\s*=\s*false/i);
  });

  it("is additive-only — nothing dropped/renamed/altered", () => {
    expect(up).not.toMatch(/dropColumn|dropTable|renameColumn|alterColumn|createTable/i);
    expect(up).not.toMatch(/drop\s+table|drop\s+column|alter\s+column/i);
  });
});
