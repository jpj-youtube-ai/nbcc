import { z } from "zod";

// What gifts could do (Jaimie, 2026-10-03): one shared list of examples, like "£25 could help buy a
// pair of school shoes", kept in the impact_examples table (migrations/1791200000200) and edited in
// Admin > Fundraising. Fundraiser, event and team pages show them under the give amounts and the
// meter (src/fundraising/impact-render.ts); a Fill a Red Bag page will read the same list later, so
// nothing here is about fundraising.
//
// The wording is OSCR-safe: it always says "could", and never "will buy" or "will pay for", so a gift
// never becomes a restricted fund. Every page that shows an example also shows IMPACT_FOOTNOTE.
//
// Pure: no pool, no clock. src/db/impact-examples.ts reads and writes the list.

/** The two examples the line under the meter counts with: Red Bags, and, for big totals, uniforms. */
export type MeterLineKey = "red_bags" | "uniforms";
export const METER_LINE_KEYS: readonly MeterLineKey[] = ["red_bags", "uniforms"];

export interface ImpactExample {
  id: number;
  amountPence: number;
  /** Starts "could ...": shown after the amount, "£25 could help buy a pair of school shoes". */
  wording: string;
  /** Switched on. Off: shown nowhere, kept for later. */
  active: boolean;
  /** The list's order (the admin's card, and a page that lists them all). */
  sortOrder: number;
  /** Shown under the give amounts. False: for big totals only (the £40 uniform). */
  onGiveForm: boolean;
  /** The line under the meter counts with this one. Set by the migration, not by staff. */
  meterLine: MeterLineKey | null;
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export const IMPACT_FOOTNOTE = "These show what gifts could do. Every gift goes where it's needed most.";

/** From this total, the line under the meter adds the school uniforms. */
export const BIG_TOTAL_PENCE = 40000;

export const AMOUNT_MIN_PENCE = 100;
export const AMOUNT_MAX_PENCE = 1_000_000;
export const WORDING_MIN = 10;
export const WORDING_MAX = 160;

/** What the list starts with, as the migration seeds it (Jaimie approved these, 2026-10-03). */
export const STARTING_EXAMPLES: readonly Omit<ImpactExample, "id">[] = [
  { amountPence: 500, wording: "could help put a cosy pair of pyjamas in a Red Bag", active: true, sortOrder: 10, onGiveForm: true, meterLine: null },
  { amountPence: 1000, wording: "could help put pyjamas, socks, a hat and gloves in a Red Bag", active: true, sortOrder: 20, onGiveForm: true, meterLine: null },
  { amountPence: 2500, wording: "could help buy a pair of school shoes", active: true, sortOrder: 30, onGiveForm: true, meterLine: null },
  { amountPence: 5000, wording: "could help fill a whole Red Bag Full of Joy", active: true, sortOrder: 40, onGiveForm: true, meterLine: "red_bags" },
  { amountPence: 4000, wording: "could help a child start school in a uniform that fits", active: true, sortOrder: 50, onGiveForm: false, meterLine: "uniforms" },
];

/** The list's order: by sort order, then the one added first. A new list; the old is untouched. */
export function sortExamples<T extends Pick<ImpactExample, "id" | "sortOrder">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** The examples for the give form: switched on and meant for it, smallest first, one per amount. */
export function giveFormExamples(list: readonly ImpactExample[]): ImpactExample[] {
  const seen = new Set<number>();
  return sortExamples(list.filter((e) => e.active && e.onGiveForm))
    .filter((e) => (seen.has(e.amountPence) ? false : (seen.add(e.amountPence), true)))
    .sort((a, b) => a.amountPence - b.amountPence);
}

/** The give form's example for exactly this amount (a preset), or null. */
export function exampleExactly(pence: number, list: readonly ImpactExample[]): ImpactExample | null {
  return giveFormExamples(list).find((e) => e.amountPence === pence) ?? null;
}

/** For an amount typed: the give form's example with the largest amount at or below it, or null. */
export function exampleAtOrBelow(pence: number, list: readonly ImpactExample[]): ImpactExample | null {
  const fits = giveFormExamples(list).filter((e) => e.amountPence <= pence);
  return fits.length ? fits[fits.length - 1] : null;
}

const meterExample = (key: MeterLineKey, list: readonly ImpactExample[]) =>
  sortExamples(list.filter((e) => e.active && e.meterLine === key && e.amountPence > 0))[0] ?? null;

/**
 * The line under the meter, from the Red Bag example (and, from £400, the uniform one): "Every pound
 * could help fill a Red Bag Full of Joy" below one bag's worth, then "What's been raised so far could fill
 * around N Red Bags Full of Joy", adding ", or help N children start school in a uniform that fits".
 * Null when the Red Bag example is switched off; the uniforms drop out when theirs is.
 */
export function meterImpactLine(raisedPence: number, list: readonly ImpactExample[]): string | null {
  const bag = meterExample("red_bags", list);
  if (!bag) return null;
  const raised = Math.max(0, Math.floor(raisedPence));
  if (raised < bag.amountPence) return "Every pound could help fill a Red Bag Full of Joy";
  const bags = Math.floor(raised / bag.amountPence);
  const line = `What's been raised so far could fill around ${bags} ${bags === 1 ? "Red Bag" : "Red Bags"} Full of Joy`;
  const uniform = meterExample("uniforms", list);
  // Never "help 0 children": only a big total that covers at least one uniform.
  if (!uniform || raised < Math.max(BIG_TOTAL_PENCE, uniform.amountPence)) return line;
  const children = Math.floor(raised / uniform.amountPence);
  return `${line}, or help ${children} ${children === 1 ? "child" : "children"} start school in a uniform that fits`;
}

// --- what staff type --------------------------------------------------------------------------------

const STARTS_COULD = /^could\b/i;
/** Words that promise what a gift buys. migrations/1791200000200 holds the table to the same list. */
const PROMISES = /\b(will\s+(buy|pay\s+for|cover|fund|provide)|pays\s+for|buys)\b/i;

export const WORDING_PROMISE_MESSAGE =
  "Say could, never will buy, will pay for, will cover, will fund, will provide, pays for or buys: every gift goes where it's needed most.";
export const WORDING_START_MESSAGE = "Start with could, like could help buy a pair of school shoes.";

/** The wording: tidied, starting "could", never a promise (OSCR: a gift must never become restricted). */
export const impactWordingSchema = z
  .string({ invalid_type_error: "Type what a gift could do." })
  .transform((v) => v.replace(/\s+/g, " ").trim().replace(/^could\b/i, "could"))
  .superRefine((v, ctx) => {
    const say = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (v.length < WORDING_MIN) return say("Type what a gift could do, like could help buy a pair of school shoes.");
    if (v.length > WORDING_MAX) return say(`Keep it to ${WORDING_MAX} characters or fewer.`);
    if (PROMISES.test(v)) return say(WORDING_PROMISE_MESSAGE);
    if (!STARTS_COULD.test(v)) return say(WORDING_START_MESSAGE);
  });

/** The amount, in whole pence: £1 to £10,000. */
export const impactAmountSchema = z
  .number({ invalid_type_error: "Give the amount in pounds, like 25." })
  .int("Give the amount in pounds, like 25.")
  .min(AMOUNT_MIN_PENCE, "Give an amount of £1 or more.")
  .max(AMOUNT_MAX_PENCE, "Give an amount of £10,000 or less.");
