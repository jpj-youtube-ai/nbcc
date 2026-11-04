import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-588: the named QR codes' two tables. Additive only, and it must sort after every migration
// production has already run, or production refuses to migrate.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = resolve(ROOT, "migrations");
const FILE = "1791200000305_qr-codes.js";
const src = readFileSync(resolve(DIR, FILE), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("the named QR codes migration", () => {
  it("sorts after the newest migration production had run before it", () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf("1791200000300_ball-chase.js")).toBeGreaterThan(-1);
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("1791200000300_ball-chase.js"));
  });

  it("only adds: two new tables, nothing dropped or changed", () => {
    expect(up).toContain('pgm.createTable("qr_codes"');
    expect(up).toContain('pgm.createTable("qr_code_scans"');
    expect(up).not.toMatch(/dropTable|dropColumn|alterColumn|renameColumn|DELETE FROM|UPDATE /);
  });

  it("keeps one number per code per day, and nothing about the person scanning", () => {
    expect(up).toContain('primaryKey: ["code_id", "day"]');
    const scans = up.slice(up.indexOf('createTable("qr_code_scans"'));
    expect(scans).not.toMatch(/ip|agent|visitor|email/i);
  });
});
