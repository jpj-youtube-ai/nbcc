import { describe, it, expect } from "vitest";
import {
  buildManifest,
  verifyAgainstPrevious,
  type Manifest,
  type DatabaseManifest,
} from "../../src/backup/manifest";

// TASK-423. The manifest is what turns "a file appeared on Google Drive" into "a backup happened".
//
// The failure mode this guards against is not dramatic. pg_dump dies partway through, the archive
// still gets written, and a small broken file replaces a good one. Repeat nightly and within a
// month every copy is broken, which is discovered on the day it matters. Comparing each run with
// the last is the cheapest way to notice.

const dbs: DatabaseManifest[] = [
  { label: "main", tables: { donors: 120, donations: 340, declarations: 88 }, dumpBytes: 900_000 },
  { label: "stories", tables: { stories: 12 }, dumpBytes: 4_000 },
  { label: "contact", tables: { contact_enquiries: 30 }, dumpBytes: 6_000 },
];

const base: Manifest = buildManifest({
  takenAt: "2026-09-22T02:00:00.000Z",
  commit: "abc1234",
  databases: dbs,
  archiveBytes: 500_000,
});

describe("the manifest records what was actually captured", () => {
  it("counts tables across every database, not just the main one", () => {
    expect(base.tableCount).toBe(5);
    expect(base.databases).toHaveLength(3);
  });

  it("totals the rows, so a restore has a number to check itself against", () => {
    expect(base.rowCount).toBe(120 + 340 + 88 + 12 + 30);
  });
});

describe("a backup that suddenly shrank is a failure, not a success", () => {
  it("passes when the archive is stable or growing", () => {
    expect(verifyAgainstPrevious({ ...base, archiveBytes: 520_000 }, base).ok).toBe(true);
  });

  it("fails when the archive loses more than a quarter of its size", () => {
    const r = verifyAgainstPrevious({ ...base, archiveBytes: 300_000 }, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/smaller/i);
  });

  // The precise near miss from Task 1, caught a second way: if the stories and contact databases
  // ever stop being dumped, the archive shrinks only slightly (they are tiny), so size alone would
  // not notice. Losing a database is therefore checked by name.
  it("fails when a whole database has vanished, even though the size barely moved", () => {
    const lost = buildManifest({
      takenAt: base.takenAt,
      commit: base.commit,
      databases: dbs.slice(0, 1),
      archiveBytes: 495_000,
    });
    const r = verifyAgainstPrevious(lost, base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/stories/);
      expect(r.reason).toMatch(/contact/);
    }
  });

  it("fails when a table disappears from a database it still dumps", () => {
    const thinner = buildManifest({
      takenAt: base.takenAt,
      commit: base.commit,
      databases: [{ ...dbs[0], tables: { donors: 120, donations: 340 } }, dbs[1], dbs[2]],
      archiveBytes: 500_000,
    });
    const r = verifyAgainstPrevious(thinner, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/declarations/);
  });

  it("has nothing to compare against on the first ever run, and says so rather than failing", () => {
    expect(verifyAgainstPrevious(base, null).ok).toBe(true);
  });

  // Real data does shrink: an erasure request, a purged send queue. An alert that cries wolf gets
  // ignored, which is worse than no alert at all.
  it("tolerates ordinary shrinkage without crying wolf", () => {
    expect(verifyAgainstPrevious({ ...base, archiveBytes: 460_000 }, base).ok).toBe(true);
  });
});
