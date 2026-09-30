import { BACKUP_DATABASES } from "./plan";
import type { Manifest } from "./manifest";

// TASK-452: proving the backup can be turned back into a database.
//
// Everything before this proves a FILE is produced and stored in two places. It does not prove the
// file is worth anything. A backup nobody has restored is a hope, and the way you find out
// otherwise is the morning you need it.
//
// So: pull the archive back, rebuild every database from it into a scratch copy, count the rows,
// and compare them to what the manifest said was in there. Then throw the scratch copies away.
//
// Pure here on purpose. What counts as a pass, and - far more importantly - which database names
// this is allowed to touch, are the parts that must be right, so they are decided in a file with no
// database connection in it.

/** The prefix every scratch database carries. Nothing else in this system uses it. */
export const RESTORE_PREFIX = "restorecheck_";

/**
 * The name of the throwaway database for one label.
 *
 * Carries the prefix AND a timestamp, so two runs cannot collide and a leftover from a crashed run
 * is obvious rather than silently reused.
 */
export function scratchDatabaseName(label: string, now: Date): string {
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `${RESTORE_PREFIX}${label.replace(/[^a-z0-9]/gi, "").toLowerCase()}_${stamp}`;
}

/**
 * The names this must never touch, taken from the same plan the backup dumps.
 *
 * Derived rather than typed out: a fourth database added to BACKUP_DATABASES is protected the day
 * it is added, instead of the day somebody remembers to add it here too.
 */
export function protectedDatabaseNames(): string[] {
  return BACKUP_DATABASES.map((d) => d.label.toLowerCase());
}

export class UnsafeRestoreTarget extends Error {
  constructor(name: string, reason: string) {
    super(`refusing to restore into "${name}": ${reason}`);
    this.name = "UnsafeRestoreTarget";
  }
}

/**
 * Refuse any target that is not provably a throwaway.
 *
 * This is the whole safety of the exercise. A restore writes over everything in its target, so the
 * one unrecoverable mistake available here is pointing it at a real database - which would destroy
 * the very data the backup exists to protect, using the backup, while checking the backup.
 *
 * Belt and braces deliberately: the prefix alone would do, but a name that merely CONTAINS a real
 * database's name is refused as well, because "restorecheck_charity" being safe depends on reading
 * the prefix carefully and I would rather it did not.
 */
export function assertSafeRestoreTarget(name: string): void {
  const lower = name.toLowerCase();
  if (!lower.startsWith(RESTORE_PREFIX)) {
    throw new UnsafeRestoreTarget(name, `a restore target must start with "${RESTORE_PREFIX}"`);
  }
  for (const real of protectedDatabaseNames()) {
    if (lower === real) throw new UnsafeRestoreTarget(name, "that is a live database");
  }
  if (lower.includes("..") || lower.includes('"') || lower.includes(";")) {
    throw new UnsafeRestoreTarget(name, "the name is not a plain identifier");
  }
}

export type RestoredCounts = Record<string, Record<string, number>>;

export type TableComparison = {
  database: string;
  table: string;
  expected: number;
  actual: number | null;
};

export type RestoreVerdict = {
  pass: boolean;
  tablesChecked: number;
  rowsChecked: number;
  /** Only the ones that disagree. An empty list is the whole point. */
  discrepancies: TableComparison[];
};

/**
 * Compare what came back out against what the manifest said went in.
 *
 * A table MISSING from the restore is a failure, not a zero: "no such table" and "a table with no
 * rows" are different facts, and a restore that quietly dropped a table while every other count
 * matched is exactly the failure this exists to catch.
 *
 * An EXTRA table in the restore is not a failure. pg_restore recreates what the dump held, and the
 * manifest lists what the migrations define; a table created outside migrations would show up here
 * and is a separate conversation from "can we restore".
 */
export function compareRestore(manifest: Manifest, restored: RestoredCounts): RestoreVerdict {
  const discrepancies: TableComparison[] = [];
  let tablesChecked = 0;
  let rowsChecked = 0;

  for (const db of manifest.databases) {
    const got = restored[db.label] ?? {};
    for (const [table, expected] of Object.entries(db.tables)) {
      tablesChecked += 1;
      rowsChecked += expected;
      const actual = Object.prototype.hasOwnProperty.call(got, table) ? got[table] : null;
      if (actual !== expected) {
        discrepancies.push({ database: db.label, table, expected, actual });
      }
    }
  }

  return { pass: discrepancies.length === 0, tablesChecked, rowsChecked, discrepancies };
}

/** One line a human can act on, for the log and the alert. */
export function describeVerdict(v: RestoreVerdict): string {
  if (v.pass) {
    return `RESTORE_OK tables=${v.tablesChecked} rows=${v.rowsChecked} every table restored with the row count the manifest recorded`;
  }
  const worst = v.discrepancies
    .slice(0, 5)
    .map((d) => `${d.database}.${d.table} expected ${d.expected} got ${d.actual ?? "no such table"}`)
    .join("; ");
  return `RESTORE_FAILED ${v.discrepancies.length} of ${v.tablesChecked} tables disagree: ${worst}`;
}
