// Fill a Red Bag against the Donate page: the pure rules behind the totals at the top of the
// Donations screen and the Overview's line. The read is sumGiftsBySource in
// src/db/overview-numbers.ts; the route is src/routes/admin-donation-sources.ts.

import { giftsWords } from "./overview-numbers";

// "£412 from 19 gifts": whole pounds, as the Overview's numbers are, and worded in one place.
export { giftsWords };

/** Money received, in pence, and how many gifts it came from. */
export type GiftSum = { pence: number; gifts: number };
/** This UK month so far, and all time. */
export type SourceSums = { month: GiftSum; all: GiftSum };
export type SourceTotals = { redBag: SourceSums; donatePage: SourceSums };

/** One row of the grouped read. Postgres hands SUM and COUNT back as strings. */
export interface SourceTotalsRow {
  bucket: string;
  month_pence: string | number;
  month_gifts: string | number;
  all_pence: string | number;
  all_gifts: string | number;
}

// donations.source has only been written since TASK-555 went live. Earlier Fill a Red Bag gifts
// were left unlabelled on purpose, so they sit in the Donate page's figures.
export const RED_BAG_COUNTED_FROM_NOTE = "Fill a Red Bag gifts are counted from 5 October 2026.";

const none = (): SourceSums => ({ month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } });

/** Both buckets, whatever came back: one with no gifts has no row, and is a real zero. */
export function sourceTotalsFrom(rows: readonly SourceTotalsRow[]): SourceTotals {
  const out: SourceTotals = { redBag: none(), donatePage: none() };
  for (const r of rows) {
    if (r.bucket !== "redBag" && r.bucket !== "donatePage") continue;
    out[r.bucket] = {
      month: { pence: Number(r.month_pence), gifts: Number(r.month_gifts) },
      all: { pence: Number(r.all_pence), gifts: Number(r.all_gifts) },
    };
  }
  return out;
}

export interface SourceLine {
  key: keyof SourceTotals;
  name: string;
  month: string;
  all: string;
}

/** The two lines at the top of the Donations screen, Fill a Red Bag first. */
export function sourceLines(t: SourceTotals): SourceLine[] {
  const line = (key: keyof SourceTotals, name: string): SourceLine => ({
    key,
    name,
    month: giftsWords(t[key].month),
    all: giftsWords(t[key].all),
  });
  return [line("redBag", "Fill a Red Bag"), line("donatePage", "Donate page")];
}
