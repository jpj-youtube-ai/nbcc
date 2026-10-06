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
const FILE = "1791200000290_site-alias-subdomains.js";
const src = readFileSync(resolve(DIR, FILE), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("the subdomain forwards migration", () => {
  it("sorts after the newest migration production had run before it", () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf("1791200000280_email-audit-removals.js")).toBeGreaterThan(-1);
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("1791200000280_email-audit-removals.js"));
  });

  // The forwards the client asked for with the release: /drop, then (the same evening) the two ways
  // people type the referral form and the two for volunteering.
  const SEEDED: [string, string][] = [
    ["/drop", "https://drop.nbcc.scot"],
    ["/referrals", "https://referrals.nbcc.scot"],
    ["/referral", "https://referrals.nbcc.scot"],
    ["/volunteer", "https://vol.nbcc.scot"],
    ["/volunteers", "https://vol.nbcc.scot"],
  ];

  it("adds exactly the five forwards asked for, and leaves an existing address alone", () => {
    for (const [from, to] of SEEDED) expect(up, from).toContain(`('${from}', '${to}', 'seed')`);
    expect(up.split("'seed')").length - 1).toBe(SEEDED.length);
    expect(up).toContain("ON CONFLICT (from_path) DO NOTHING");
    expect(up).not.toMatch(/DELETE FROM|UPDATE |DROP TABLE|ALTER TABLE/i);
  });

  it("seeds only pairs the admin form itself would accept", () => {
    for (const [from, to] of SEEDED) {
      expect(aliasFromProblem(from), from).toBeNull();
      expect(aliasToProblem(to), to).toBeNull();
    }
  });
});
