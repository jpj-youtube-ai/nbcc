import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-228 (grandfather the pre-223 supporters wall): the migration adds the additive
// grandfathered_on_supporters flag AND, in the SAME up(), takes a one-time snapshot of the OLD
// (pre-223) wall's set by back-filling the flag. The OLD wall (git 8d2f829) showed a donor iff NOT
// anonymous AND they had a qualifying donation; the grandfather path re-bands by the donor's MAX PAID
// amount, so the snapshot is donors with NOT anonymous AND >= 1 payment_status='paid' donation. Schema
// change is additive/expand-contract safe (golden rule 2); CI's migrations job runs it live. Read the
// file as text (DB-free) — the same style as partners-hidden-migration.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = "migrations/1784260000000_grandfather-supporters.js";
const src = readFileSync(resolve(ROOT, FILE), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));
const down = src.slice(src.indexOf("exports.down"));

describe("grandfather-supporters migration", () => {
  it("adds an additive grandfathered_on_supporters boolean NOT NULL default false on donors", () => {
    expect(up).toMatch(/addColumn\(\s*["']donors["']/);
    expect(up).toMatch(/grandfathered_on_supporters/);
    expect(up).toMatch(/type:\s*["']boolean["']/);
    expect(up).toMatch(/notNull:\s*true/);
    expect(up).toMatch(/default:\s*false/);
  });

  it("back-fills the flag to true for the OLD wall's set: NOT anonymous AND has >= 1 PAID donation", () => {
    // A single UPDATE that snapshots the pre-223 wall's inclusion set.
    expect(up).toMatch(/update\s+donors/i);
    expect(up).toMatch(/set\s+grandfathered_on_supporters\s*=\s*true/i);
    // Excludes anonymous donors exactly as the old wall's isPubliclyListable did.
    expect(up).toMatch(/anonymous\s*=\s*false/i);
    // Requires a settled (paid) donation — the amount the grandfather path bands by.
    expect(up).toMatch(/payment_status\s*=\s*'paid'/i);
    expect(up).toMatch(/from\s+donations/i);
  });

  it("is additive-only in the up — nothing dropped/renamed/altered", () => {
    expect(up).not.toMatch(/dropColumn|dropTable|renameColumn|alterColumn|createTable/i);
    expect(up).not.toMatch(/drop\s+table|drop\s+column|alter\s+column/i);
  });

  it("drops the column in the down (expand-contract reverse)", () => {
    expect(down).toMatch(/dropColumn\(\s*["']donors["']\s*,\s*["']grandfathered_on_supporters["']\s*\)/);
  });
});
