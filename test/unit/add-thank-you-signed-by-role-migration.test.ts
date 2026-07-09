import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-165 (REQ-069): the migration adding thank_you_sent.signed_by_role. Additive/expand-contract
// safe (golden rule 2): one NEW, NULLABLE column — no drop/rename, nothing made NOT NULL — so it is
// safe to ship with a code-level rollback. This encodes that so the migration can't drift destructive.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(ROOT, "migrations/1783620000000_add-thank-you-signed-by-role.js"), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("add-thank-you-signed-by-role migration", () => {
  it("adds a nullable signed_by_role column in the up", () => {
    expect(up).toMatch(/addColumn/);
    expect(up).toContain("thank_you_sent");
    expect(up).toContain("signed_by_role");
    expect(up).not.toMatch(/notNull\s*:\s*true/); // nullable — safe on populated data
  });

  it("is additive-only — nothing dropped, renamed or made NOT NULL in the up", () => {
    expect(up).not.toMatch(/dropColumn|dropTable|renameColumn|alterColumn/i);
    expect(up).not.toMatch(/not\s+null/i);
  });
});
