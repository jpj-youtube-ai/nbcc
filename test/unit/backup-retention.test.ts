import { describe, it, expect } from "vitest";
import { selectForDeletion, type StoredBackup } from "../../src/backup/retention";

// TASK-423. Pruning is the only part of the backup that DELETES things, so it is the only part
// that can destroy what the feature exists to protect. An off-by-one here does not fail loudly at
// 2am; it quietly removes the copy you needed.
//
// The rule: keep the 30 most recent, and keep the newest backup from each of the last 12 months.
// Everything else goes.

const day = (iso: string, name = `nbcc-backup-${iso.slice(0, 10)}.7z`): StoredBackup => ({
  id: iso,
  name,
  createdTime: `${iso}T02:00:00.000Z`,
});

/** `count` consecutive days, ending the day before `endExclusive`. */
function dailyRun(endExclusive: string, count: number): StoredBackup[] {
  const out: StoredBackup[] = [];
  const end = Date.parse(`${endExclusive}T02:00:00.000Z`);
  for (let i = 1; i <= count; i += 1) {
    out.push(day(new Date(end - i * 86_400_000).toISOString().slice(0, 10)));
  }
  return out;
}

const NOW = new Date("2026-09-22T03:00:00.000Z");

describe("keeping the recent ones", () => {
  it("deletes nothing when there is less than a month of history", () => {
    expect(selectForDeletion(dailyRun("2026-09-22", 10), NOW)).toEqual([]);
  });

  it("keeps all 30 when there are exactly 30", () => {
    expect(selectForDeletion(dailyRun("2026-09-22", 30), NOW)).toEqual([]);
  });

  // The 31st is older than the daily window, but it is also the only backup from its month so
  // far back, so the monthly rule may still save it. This asserts the combination, which is where
  // a naive "slice(30)" gets it wrong.
  it("keeps one backup per month once they fall outside the daily window", () => {
    const files = dailyRun("2026-09-22", 90);
    const doomed = selectForDeletion(files, NOW).map((f) => f.id);

    // Everything in the last 30 days survives.
    for (const f of dailyRun("2026-09-22", 30)) expect(doomed).not.toContain(f.id);

    // Older months keep exactly one each, not zero and not all of them.
    const survivors = files.filter((f) => !doomed.includes(f.id));
    const byMonth = new Map<string, number>();
    for (const s of survivors) {
      const m = s.createdTime.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    }
    // July is entirely outside the 30-day window here, so it should retain one and only one.
    expect(byMonth.get("2026-07")).toBe(1);
  });

  it("keeps the NEWEST backup of an old month, not the oldest", () => {
    const files = dailyRun("2026-09-22", 90);
    const doomed = new Set(selectForDeletion(files, NOW).map((f) => f.id));
    const july = files.filter((f) => f.createdTime.startsWith("2026-07")).map((f) => f.id).sort();
    const keptJuly = july.filter((id) => !doomed.has(id));
    expect(keptJuly).toEqual([july[july.length - 1]]);
  });
});

describe("the safety rails on a delete", () => {
  // If a listing came back empty or partial because of a transient API error, deleting "everything
  // not matching the rule" would be catastrophic. Nothing to do is always a valid answer.
  it("deletes nothing when handed an empty list", () => {
    expect(selectForDeletion([], NOW)).toEqual([]);
  });

  // The folder is the charity's. If someone drops a document in it, the backup job is not
  // entitled to tidy it away.
  it("never touches a file that is not one of our backups", () => {
    const files = [...dailyRun("2026-09-22", 60), { id: "x", name: "Trustee minutes.docx", createdTime: "2020-01-01T00:00:00.000Z" }];
    const doomed = selectForDeletion(files, NOW).map((f) => f.id);
    expect(doomed).not.toContain("x");
  });

  it("never proposes deleting every backup it can see", () => {
    const files = dailyRun("2026-09-22", 400);
    const doomed = selectForDeletion(files, NOW);
    expect(doomed.length).toBeLessThan(files.length);
  });
});
