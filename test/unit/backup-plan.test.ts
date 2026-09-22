import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKUP_DATABASES, tablesIn, expectedTableCount } from "../../src/backup/plan";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// TASK-423. This file exists because of a near miss.
//
// NBCC does not have one database, it has THREE. The main charity database, plus two deliberately
// isolated ones so the public "My Story" form and the contact form can never read or write donor
// data (STORIES_DATABASE_URL / CONTACT_DATABASE_URL in src/config/schema.ts). The obvious way to
// write a backup — pg_dump $DATABASE_URL — captures 42 of the 44 tables and silently drops every
// story submission and every contact enquiry. It would have produced a file of plausible size,
// passed any test that only counted its own output, and been discovered during a restore.
//
// So the truth here is not a hand-written list. It is the migration directories on disk. Add a
// fourth database and this fails until the backup knows about it.

describe("the backup plan covers every database that exists", () => {
  it("names all three databases", () => {
    expect(BACKUP_DATABASES.map((d) => d.configKey).sort()).toEqual([
      "CONTACT_DATABASE_URL",
      "DATABASE_URL",
      "STORIES_DATABASE_URL",
    ]);
  });

  it("has no migration directory it does not back up", () => {
    const onDisk = readdirSync(ROOT)
      .filter((n) => n === "migrations" || n.startsWith("migrations-"))
      .filter((n) => existsSync(resolve(ROOT, n)))
      .sort();
    expect(BACKUP_DATABASES.map((d) => d.migrationsDir).sort()).toEqual(onDisk);
  });

  it("gives every database a distinct folder name inside the archive", () => {
    const labels = BACKUP_DATABASES.map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("knowing how many tables to expect", () => {
  // A dump that yielded three tables when 44 exist must abort before it overwrites a good backup.
  it("counts 44 across the three databases", () => {
    expect(expectedTableCount(ROOT)).toBe(44);
  });

  it("finds the two tables that live outside the main database", () => {
    expect(tablesIn(ROOT, "migrations-stories")).toEqual(["stories"]);
    expect(tablesIn(ROOT, "migrations-contact")).toEqual(["contact_enquiries"]);
  });

  it("reads the main database's tables from its migrations, including the ones easy to forget", () => {
    const main = tablesIn(ROOT, "migrations");
    // Gift Aid (six-year HMRC retention) and the suppression list (losing it means emailing
    // people who opted out) are the two whose absence would be most expensive.
    expect(main).toContain("declarations");
    expect(main).toContain("email_suppressions");
    expect(main).toContain("erasure_log");
    expect(main.length).toBe(42);
  });

  it("returns nothing for a directory that does not exist, rather than throwing", () => {
    expect(tablesIn(ROOT, "migrations-nope")).toEqual([]);
  });
});
