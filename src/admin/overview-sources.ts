import { can, type PermissionMap, type Section } from "./permissions";
import type { NeedCounts } from "./overview";

// TASK-508: gathering "Needs you". Each source counts one screen's waiting items and carries the
// gate that screen uses, so the Overview never shows (or even asks for) something a person cannot
// open. The sources run at once and on their own: one that fails is named in `failed`, by its
// screen's name, and the rest still count. The real sources are in src/routes/admin-overview.ts.

export interface NeedSource {
  /** The screen's name, as the menu shows it: what "Could not check" says when it fails. */
  name: string;
  section: Section;
  level: "view" | "edit";
  read: () => Promise<NeedCounts>;
}

// The main database pool takes 5 connections at a time (src/db/pool.ts). One Overview asking all of
// its sources at once would take every one, and a donor's checkout would wait behind it; three at a
// time leaves room.
export const MAX_AT_ONCE = 3;

async function settleInTurn<T>(jobs: ReadonlyArray<() => Promise<T>>, atOnce: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await jobs[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(atOnce, jobs.length) }, worker));
  return results;
}

export async function gatherNeeds(
  perms: PermissionMap,
  sources: readonly NeedSource[],
): Promise<{ counts: NeedCounts; failed: string[] }> {
  const allowed = sources.filter((s) => can(perms, s.section, s.level));
  const results = await settleInTurn(allowed.map((s) => () => s.read()), MAX_AT_ONCE);
  const counts: NeedCounts = {};
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      Object.assign(counts, r.value);
      return;
    }
    const name = allowed[i].name;
    console.error(`admin overview: ${name} could not be checked:`, r.reason instanceof Error ? r.reason.message : r.reason);
    if (!failed.includes(name)) failed.push(name);
  });
  return { counts, failed };
}
