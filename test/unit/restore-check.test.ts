import { describe, it, expect } from "vitest";
import {
  assertSafeRestoreTarget,
  compareRestore,
  describeVerdict,
  scratchDatabaseName,
  protectedDatabaseNames,
  UnsafeRestoreTarget,
  RESTORE_PREFIX,
} from "../../src/backup/restore-check";
import type { Manifest } from "../../src/backup/manifest";

// TASK-452. Everything before this proves a FILE is produced and stored in two places. It does not
// prove the file is worth anything. A backup nobody has restored is a hope, and the way you find out
// otherwise is the morning you need it.

const manifest = (over: Partial<Manifest> = {}): Manifest =>
  ({
    takenAt: "2026-09-30T02:00:00.000Z",
    tableCount: 3,
    rowCount: 60,
    archiveBytes: 1024,
    databases: [
      { label: "main", dumpBytes: 512, tables: { donors: 14, donations: 21 } },
      { label: "stories", dumpBytes: 256, tables: { stories: 25 } },
    ],
    ...over,
  }) as Manifest;

describe("refusing to restore over a live database", () => {
  // THE thing this file exists for. A restore writes over everything in its target, so the one
  // unrecoverable mistake available is pointing it at a real database - destroying the very data
  // the backup protects, using the backup, while checking the backup.
  it("refuses every live database by name", () => {
    for (const real of protectedDatabaseNames()) {
      expect(() => assertSafeRestoreTarget(real)).toThrow(UnsafeRestoreTarget);
    }
  });

  it("takes the protected names from the backup plan, not a second list", () => {
    // A fourth database added to BACKUP_DATABASES must be protected the day it is added, not the
    // day somebody remembers to update a list over here.
    expect(protectedDatabaseNames().length).toBeGreaterThanOrEqual(3);
    expect(protectedDatabaseNames()).toEqual(["main", "stories", "contact"]);
  });

  it("refuses anything without the throwaway prefix", () => {
    expect(() => assertSafeRestoreTarget("postgres")).toThrow(/must start with/);
    expect(() => assertSafeRestoreTarget("scratch_main")).toThrow(/must start with/);
    expect(() => assertSafeRestoreTarget("")).toThrow(UnsafeRestoreTarget);
  });

  it("refuses a name that is not a plain identifier", () => {
    expect(() => assertSafeRestoreTarget(`${RESTORE_PREFIX}a"; DROP DATABASE main; --`)).toThrow(
      /plain identifier/,
    );
  });

  it("allows a properly named throwaway", () => {
    expect(() => assertSafeRestoreTarget(`${RESTORE_PREFIX}main_20260930020000`)).not.toThrow();
  });
});

describe("naming the throwaway", () => {
  it("carries the prefix and a timestamp, so two runs cannot collide", () => {
    const a = scratchDatabaseName("main", new Date("2026-09-30T02:00:00Z"));
    const b = scratchDatabaseName("main", new Date("2026-09-30T03:00:00Z"));
    expect(a).toMatch(new RegExp(`^${RESTORE_PREFIX}main_\\d{14}$`));
    expect(a).not.toBe(b);
  });

  it("produces a name its own guard accepts", () => {
    for (const label of protectedDatabaseNames()) {
      expect(() => assertSafeRestoreTarget(scratchDatabaseName(label, new Date()))).not.toThrow();
    }
  });
});

describe("comparing what came back with what went in", () => {
  it("passes when every table restored with the count the manifest recorded", () => {
    const v = compareRestore(manifest(), {
      main: { donors: 14, donations: 21 },
      stories: { stories: 25 },
    });
    expect(v.pass).toBe(true);
    expect(v.tablesChecked).toBe(3);
    expect(v.rowsChecked).toBe(60);
    expect(v.discrepancies).toEqual([]);
  });

  it("fails on a row count that does not match", () => {
    const v = compareRestore(manifest(), {
      main: { donors: 14, donations: 20 },
      stories: { stories: 25 },
    });
    expect(v.pass).toBe(false);
    expect(v.discrepancies).toEqual([
      { database: "main", table: "donations", expected: 21, actual: 20 },
    ]);
  });

  // "No such table" and "a table with no rows" are different facts. A restore that quietly dropped
  // a table while every other count matched is exactly the failure this exists to catch, and
  // treating a missing table as zero would hide it whenever the table was empty anyway.
  it("fails on a table that did not come back at all, and does not call it zero", () => {
    const v = compareRestore(manifest(), { main: { donors: 14 }, stories: { stories: 25 } });
    expect(v.pass).toBe(false);
    expect(v.discrepancies[0]).toEqual({
      database: "main",
      table: "donations",
      expected: 21,
      actual: null,
    });
  });

  it("fails when a whole database did not come back", () => {
    const v = compareRestore(manifest(), { main: { donors: 14, donations: 21 } });
    expect(v.pass).toBe(false);
    expect(v.discrepancies).toHaveLength(1);
    expect(v.discrepancies[0].database).toBe("stories");
  });

  it("distinguishes a genuinely empty table from a missing one", () => {
    const empty = manifest({
      databases: [{ label: "main", dumpBytes: 1, tables: { donors: 0 } }],
    } as Partial<Manifest>);
    expect(compareRestore(empty, { main: { donors: 0 } }).pass).toBe(true);
    expect(compareRestore(empty, { main: {} }).discrepancies[0].actual).toBeNull();
  });

  // pg_restore recreates what the dump held; the manifest lists what the migrations define. A table
  // created outside migrations is a separate conversation from "can we restore".
  it("does not fail on an extra table the manifest did not list", () => {
    const v = compareRestore(manifest(), {
      main: { donors: 14, donations: 21, scratch_notes: 3 },
      stories: { stories: 25 },
    });
    expect(v.pass).toBe(true);
  });
});

describe("what it reports", () => {
  it("says plainly that it passed, with the numbers behind it", () => {
    const line = describeVerdict(compareRestore(manifest(), {
      main: { donors: 14, donations: 21 },
      stories: { stories: 25 },
    }));
    expect(line).toContain("RESTORE_OK");
    expect(line).toContain("tables=3");
    expect(line).toContain("rows=60");
  });

  it("names what disagreed, rather than only that something did", () => {
    const line = describeVerdict(compareRestore(manifest(), { main: { donors: 14 } }));
    expect(line).toContain("RESTORE_FAILED");
    expect(line).toContain("main.donations expected 21 got no such table");
  });
});
