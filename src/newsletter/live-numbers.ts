// TASK-646: where a Live total's number comes from.
//
//   readLiveNumberNow  the send's read, once, on its first tick: UNCACHED, and it may throw, so the send
//                      can tell a failure from a zero (the cached Red Bag reader turns a failure into
//                      zero). The worker catches it and freezes "no number".
//   liveNumbersCached  the preview's, the test send's and the checks' read: the public pages' own cached
//                      numbers (a minute old at most, given up on after a moment, never a throw), and
//                      only for the sources the newsletter uses.
//
// The numbers are the pages' own: bags filled as the Workshop's sign counts them (one for every £50 given
// through Fill a Red Bag since 1 November), and the sleigh's total in pence as /sleigh shows it.
import { readRedBagWorkshopTotalsNow, redBagWorkshopTotals } from "../db/red-bag-workshops";
import { readSleighTotalsNow, sleighTotals } from "../db/sleigh";
import { workshopView } from "../red-bag/workshop";
import type { LiveNumbers } from "./theme";
import type { ReadSource } from "./live-blocks";

const bags = (pence: number): number => workshopView(pence, "everyone").bags;

export async function readLiveNumberNow(source: ReadSource): Promise<number> {
  if (source === "sleigh") return (await readSleighTotalsNow()).totalPence;
  return bags((await readRedBagWorkshopTotalsNow()).everyonePence);
}

export async function liveNumbersCached(sources: readonly ReadSource[]): Promise<LiveNumbers> {
  const out: LiveNumbers = {};
  await Promise.all(
    sources.map(async (source) => {
      if (source === "sleigh") {
        const t = await sleighTotals();
        out.sleigh = t ? t.totalPence : null;
      } else {
        out.redBag = bags((await redBagWorkshopTotals()).everyonePence);
      }
    }),
  );
  return out;
}
