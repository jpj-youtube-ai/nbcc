// Fill a Red Bag against the Donate page: the pure rules behind the totals at the top of the
// Donations screen and the Overview's line. The read is sumGiftsBySource in
// src/db/overview-numbers.ts; the route is src/routes/admin-donation-sources.ts.

import { giftsWords, paymentsWords } from "./overview-numbers";

// "£412 from 19 gifts": whole pounds, as the Overview's numbers are, and worded in one place.
export { giftsWords, paymentsWords };

/** The Elf Detective School's payments in Admin > Donations: their source, and their filter's value.
 *  Not a donations.source (DONATION_SOURCES): they are elf_orders, listed beside the gifts. */
export const ELF_SOURCE = "elf_school";

/** Money received, in pence, and how many gifts (for the Elf Detective School, payments) it came from. */
export type GiftSum = { pence: number; gifts: number };
/** This UK month so far, and all time. */
export type SourceSums = { month: GiftSum; all: GiftSum };
export type SourceTotals = {
  redBag: SourceSums;
  ball: SourceSums;
  ballBags: SourceSums;
  invoices: SourceSums;
  elfSchool: SourceSums;
  donatePage: SourceSums;
  /** Gifts on a fundraiser's own page, and gifts tapped on the card reader at events (TASK-598). */
  fundraiser: SourceSums;
  cardReader: SourceSums;
  /** Every monthly payment, wherever it was set up (TASK-596): not a place, so each is in its place's too. */
  monthly: SourceSums;
};

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
// The Festive Ball's donate page (/ball/donate) labelled its gifts from the day it opened.
export const BALL_GIFTS_NOTE = "Festive Ball gifts are those made on the Ball's own donate page.";
// The red bag cards on the Festive Ball tables (/bag) are their own line, never part of the Ball's.
export const BALL_BAGS_NOTE = "Red bags at the Ball are gifts from the table cards at the Festive Ball.";
// The Elf Detective School's payments are entries, with any gift on top (Head Elf HQ).
// Monthly gifts are a kind of gift, not a place: each payment is in its own place's figures as well.
export const MONTHLY_NOTE = "Monthly gifts are every monthly payment, wherever it was set up, so each is in its place's figures too.";
export const ELF_PAYMENTS_NOTE = "Elf Detective School payments are entries to take part, with any gift on top. Entries are never claimed for Gift Aid.";

const none = (): SourceSums => ({ month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } });
const BUCKETS = ["redBag", "ball", "ballBags", "invoices", "elfSchool", "donatePage", "fundraiser", "cardReader", "monthly"] as const;
const isBucket = (b: string): b is keyof SourceTotals => (BUCKETS as readonly string[]).includes(b);

/** Every bucket, whatever came back: one with no gifts has no row, and is a real zero. */
export function sourceTotalsFrom(rows: readonly SourceTotalsRow[]): SourceTotals {
  const out: SourceTotals = { redBag: none(), ball: none(), ballBags: none(), invoices: none(), elfSchool: none(), donatePage: none(), fundraiser: none(), cardReader: none(), monthly: none() };
  for (const r of rows) {
    if (!isBucket(r.bucket)) continue;
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

/** The lines at the top of the Donations screen: Fill a Red Bag, the Festive Ball, the Ball's red bags,
 *  invoices, the Elf Detective School, the Donate page, fundraiser pages, the card reader, and then
 *  every monthly payment. */
export function sourceLines(t: SourceTotals): SourceLine[] {
  const line = (key: keyof SourceTotals, name: string, words: (s: GiftSum) => string = giftsWords): SourceLine => ({
    key,
    name,
    month: words(t[key].month),
    all: words(t[key].all),
  });
  return [
    line("redBag", "Fill a Red Bag"),
    line("ball", "Festive Ball"),
    line("ballBags", "Red bags at the Ball"),
    // Invoices for donations: gifts that paid an invoice sent from Admin > Giving > Invoices.
    line("invoices", "Invoices"),
    // Head Elf HQ: paid entries with any gift on top, counted as payments.
    line("elfSchool", "Elf Detective School", paymentsWords),
    line("donatePage", "Donate page"),
    // Gifts on a fundraiser's own page, and gifts taken in person on the card reader (TASK-598).
    line("fundraiser", "Fundraiser pages"),
    line("cardReader", "Card reader"),
    // Every monthly payment, wherever it was set up, counted as payments (TASK-596).
    line("monthly", "Monthly gifts", paymentsWords),
  ];
}
