import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-475: the table that remembers erased stories, in the STORIES database (migrations-stories),
// beside the stories it guards. Additive only (golden rule 2), holds nothing readable, and sorts
// last in its directory, or production refuses to migrate (CLAUDE.md, "A migration").

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = resolve(ROOT, "migrations-stories");
const FILE = "1790803772256_erased-stories.js";
const src = readFileSync(resolve(DIR, FILE), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("erased-stories migration", () => {
  it("sorts last among the stories migrations", () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith(".js")).sort();
    expect(names[names.length - 1]).toBe(FILE);
  });

  it("creates erased_stories keyed by the fingerprint alone", () => {
    expect(up).toMatch(/createTable\(\s*["']erased_stories["']/);
    expect(up).toMatch(/fingerprint:\s*\{[^}]*primaryKey:\s*true/);
  });

  it("refuses anything but a sha256 in hex, so nothing readable can be kept there", () => {
    expect(up).toContain("^[0-9a-f]{64}$");
  });

  it("has no column that could hold personal data", () => {
    expect(up).not.toMatch(/story_text|email|phone|first_name|town|record_id|story_id/i);
  });

  it("is additive only: nothing dropped, renamed or altered in the up", () => {
    expect(up).not.toMatch(/dropColumn|dropTable|renameColumn|alterColumn|renameTable/i);
  });
});
