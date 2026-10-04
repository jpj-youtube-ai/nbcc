import { createRequire } from "node:module";
import { resolve } from "node:path";

// Fill a Red Bag: the server's way in to the ONE module that holds the list, the themes, the £50
// bag value and the sums: assets/js/red-bag-catalogue.js. The page loads that file in the browser;
// the server reads the same file here (it ships with the app, as the Signed by list does in
// src/fundraising/signers.ts), so what is drawn into the page and what the page's script adds up
// can never drift apart. This file only gives it types.

export interface RedBagItem {
  key: string;
  name: string;
  pence: number;
}

export interface RedBagGroup {
  key: string;
  /** The printed sheet's own heading. */
  heading: string;
  items: RedBagItem[];
}

export interface RedBagExample {
  key: string;
  pence: number;
  /** Follows the amount, and always starts "could": "could help with a pair of school shoes". */
  words: string;
}

export interface RedBagTheme {
  key: string;
  title: string;
  sub: string;
  examples: RedBagExample[];
}

export interface RedBagBags {
  /** Whole bags the total reaches. */
  full: number;
  /** How full each bag drawn is, 0 to 1: five at most. */
  drawn: number[];
  /** Whole bags not drawn ("and N more"). */
  more: number;
}

export interface RedBagRoundUpOffer {
  /** The milestone it rounds up to, in pence. */
  target: number;
  /** What pressing it adds to the total shown, in pence. */
  add: number;
  /** The button's words: "Round up to half a bag". */
  words: string;
}

export interface RedBagCatalogue {
  BAG_VALUE_PENCE: number;
  MIN_PENCE: number;
  MAX_QUANTITY: number;
  MAX_BAGS_DRAWN: number;
  GROUPS: RedBagGroup[];
  THEMES: RedBagTheme[];
  /** The first milestone a round-up offers: half a bag. */
  HALF_BAG_PENCE: number;
  WORDS: { elves: string; audience: string; empty: string; nudge: string; another: string; roundUp: string };
  items(): RedBagItem[];
  examples(): RedBagExample[];
  clampQuantity(value: unknown): number;
  totalPence(quantities: Record<string, unknown>, exampleKeys: readonly string[]): number;
  bags(pence: number): RedBagBags;
  statusLine(pence: number): string;
  /** The next milestone above a total: half a bag, a full bag, then each whole bag. 0 for nothing. */
  nextMilestone(pence: number): number;
  milestoneWords(targetPence: number): string;
  /** The round-up on offer for the total shown, or null for an empty bag. */
  roundUpOffer(pence: number): RedBagRoundUpOffer | null;
  /** What a round-up adds: the gap between the donor's own items and the target they chose. */
  roundUpPence(ownPence: number, targetPence: number): number;
  pounds(pence: number): string;
}

// This file compiles to dist/red-bag/catalogue.js, so ../.. is the app root (as ./signers.ts).
const MODULE = resolve(__dirname, "../../assets/js/red-bag-catalogue.js");
let cached: RedBagCatalogue | null = null;

/** The catalogue, read once and kept. Throws if the file is missing (callers answer with the 404). */
export function redBag(): RedBagCatalogue {
  if (!cached) cached = createRequire(MODULE)(MODULE) as RedBagCatalogue;
  return cached;
}
