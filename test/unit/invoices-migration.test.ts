import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Invoices for donations: two new tables and one new column on donations. Additive only, and it must
// sort after every migration production has already run, or production refuses to migrate.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = resolve(ROOT, "migrations");
const FILE = "1791200000330_donation-invoices.js";
const src = readFileSync(resolve(DIR, FILE), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("the invoices migration", () => {
  it("sorts last, after the newest migration production had run before it", () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf("1791200000320_elf-favourites.js")).toBeGreaterThan(-1);
    expect(names[names.length - 1]).toBe(FILE);
  });

  it("only adds: two tables and one nullable column, nothing dropped or changed", () => {
    expect(up).toContain('pgm.createTable("donation_invoices"');
    expect(up).toContain('pgm.createTable("donation_invoice_settings"');
    expect(up).toContain('pgm.addColumns("donations"');
    expect(up).not.toMatch(/dropTable|dropColumn|alterColumn|renameColumn|DELETE FROM|UPDATE |notNull: true, references: "donation_invoices"/);
  });

  it("holds the rules the code relies on", () => {
    expect(up).toContain("payer_kind IN ('person', 'business', 'group')");
    expect(up).toContain("status IN ('waiting', 'paid', 'cancelled')");
    expect(up).toContain("paid_by IN ('card', 'transfer')");
    expect(up).toContain("amount_pence BETWEEN 100 AND 5000000");
    expect(up).toContain("id = 1");
  });

  it("never blocks a donation or an invoice being erased", () => {
    expect(up.match(/onDelete: "SET NULL"/g)?.length).toBe(2);
  });
});
