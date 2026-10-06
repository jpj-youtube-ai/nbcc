import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aliasFromProblem, aliasToProblem } from "../../src/site/pages";

// TASK-568: nbcc.scot/drop forwards to drop.nbcc.scot from the moment the release is live, as the
// client asked. One row in site_aliases, added only if nobody has made a /drop already. It must
// sort after every migration production has already run, or production refuses to migrate.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = resolve(ROOT, "migrations");
const FILE = "1791200000290_site-alias-drop.js";
const src = readFileSync(resolve(DIR, FILE), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("the /drop forward migration", () => {
  it("sorts after the newest migration production had run before it", () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf("1791200000280_email-audit-removals.js")).toBeGreaterThan(-1);
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("1791200000280_email-audit-removals.js"));
  });

  it("adds /drop to https://drop.nbcc.scot, and leaves an existing /drop alone", () => {
    expect(up).toContain("'/drop'");
    expect(up).toContain("'https://drop.nbcc.scot'");
    expect(up).toContain("ON CONFLICT (from_path) DO NOTHING");
    expect(up).not.toMatch(/DELETE FROM|UPDATE |DROP TABLE|ALTER TABLE/i);
  });

  it("seeds a pair the admin form itself would accept", () => {
    expect(aliasFromProblem("/drop")).toBeNull();
    expect(aliasToProblem("https://drop.nbcc.scot")).toBeNull();
  });
});
