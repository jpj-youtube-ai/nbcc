// TASK-423: the manifest is what turns "a file appeared on Google Drive" into "a backup happened".
//
// It records what was captured, so a restore can be checked against it rather than eyeballed, and
// so the next run can notice a collapse. The failure this exists for is undramatic: pg_dump dies
// partway, the archive is still written, and a small broken file replaces a good one. Repeat
// nightly and within a month every copy is broken, discovered on the day it matters.

export type DatabaseManifest = {
  label: string;
  /** Table name to row count. */
  tables: Record<string, number>;
  dumpBytes: number;
};

export type Manifest = {
  takenAt: string;
  commit: string;
  databases: DatabaseManifest[];
  archiveBytes: number;
  /** Derived, so the restore rehearsal has a single number to assert on. */
  tableCount: number;
  rowCount: number;
};

export function buildManifest(
  input: Omit<Manifest, "tableCount" | "rowCount">,
): Manifest {
  let tableCount = 0;
  let rowCount = 0;
  for (const db of input.databases) {
    for (const rows of Object.values(db.tables)) {
      tableCount += 1;
      rowCount += rows;
    }
  }
  return { ...input, tableCount, rowCount };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Compare a fresh manifest against the previous one and decide whether to trust it.
 *
 * Size alone is not enough. The stories and contact databases hold two small tables between them,
 * so losing both would shrink the archive by about one percent while destroying every public story
 * submission and every contact enquiry. Missing databases and missing tables are therefore checked
 * by name, and size is only the backstop.
 */
export function verifyAgainstPrevious(now: Manifest, previous: Manifest | null): VerifyResult {
  if (!previous) return { ok: true }; // first ever run: nothing to compare with

  const nowLabels = new Set(now.databases.map((d) => d.label));
  const lostDbs = previous.databases.map((d) => d.label).filter((l) => !nowLabels.has(l));
  if (lostDbs.length) {
    return { ok: false, reason: `databases missing from this backup: ${lostDbs.join(", ")}` };
  }

  const nowTables = new Set(
    now.databases.flatMap((d) => Object.keys(d.tables).map((t) => `${d.label}.${t}`)),
  );
  const lostTables = previous.databases
    .flatMap((d) => Object.keys(d.tables).map((t) => `${d.label}.${t}`))
    .filter((t) => !nowTables.has(t));
  if (lostTables.length) {
    return { ok: false, reason: `tables missing from this backup: ${lostTables.join(", ")}` };
  }

  // A quarter is deliberately loose. Real data shrinks: an erasure request, a purged send queue.
  // An alert that cries wolf gets ignored, which is worse than no alert at all.
  if (now.archiveBytes < previous.archiveBytes * 0.75) {
    return {
      ok: false,
      reason: `archive is ${now.archiveBytes} bytes, materially smaller than the previous ${previous.archiveBytes}`,
    };
  }

  return { ok: true };
}
