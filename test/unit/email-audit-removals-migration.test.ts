import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-562: the table that remembers which addresses staff removed from the Email audit's red
// band. A new table and nothing else: email_log is written by every email the site sends, the
// Festive Ball's included, and email_suppressions is read by every newsletter send, so neither is
// altered. Additive only (golden rule 2), and it must sort after every migration production has
// already run, or production refuses to migrate (CLAUDE.md, "A migration").

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = resolve(ROOT, "migrations");
const FILE = "1791200000260_email-audit-removals.js";
const src = readFileSync(resolve(DIR, FILE), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("email-audit-removals migration", () => {
  // After the newest one on main when this was written. Not "is the last file": that would turn
  // red for whoever adds the next migration.
  it("sorts after the migration that was newest when it was written", () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf("1791200000250_donation-source.js")).toBeGreaterThan(-1);
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("1791200000250_donation-source.js"));
  });

  it("creates email_audit_removals: the address, the kind, who and when, and who put it back", () => {
    expect(up).toMatch(/createTable\(\s*["']email_audit_removals["']/);
    for (const column of ["email", "kind", "blocked", "removed_at", "removed_by", "put_back_at", "put_back_by"]) {
      expect(up, column).toMatch(new RegExp(`\\b${column}:\\s*\\{`));
    }
    expect(up).toMatch(/email:\s*\{[^}]*notNull:\s*true/);
    expect(up).toMatch(/removed_by:\s*\{[^}]*notNull:\s*true/);
  });

  it("allows only the two kinds of removal", () => {
    expect(up).toContain("kind IN ('stop', 'tidy')");
  });

  // A put back is a stamp, never a delete, so the two "put back" columns are the only ones that
  // may be empty.
  it("stamps a put back rather than deleting the removal", () => {
    expect(up).toMatch(/put_back_at:\s*\{\s*type:\s*["']timestamptz["']\s*\}/);
    expect(up).toMatch(/put_back_by:\s*\{\s*type:\s*["']text["']\s*\}/);
  });

  it("indexes the removals still in force by address, which is how the band looks them up", () => {
    expect(up).toMatch(/createIndex\(\s*["']email_audit_removals["'],\s*["']email["'],\s*\{\s*where:\s*["']put_back_at IS NULL["']/);
  });

  it("is additive only, and alters no table that an email being sent writes to or reads", () => {
    expect(up).not.toMatch(/dropColumn|dropTable|renameColumn|alterColumn|renameTable|addColumn/i);
    expect(up).not.toMatch(/["'](email_log|email_suppressions)["']/);
  });
});
