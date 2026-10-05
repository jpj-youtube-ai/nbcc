import { createRequire } from "node:module";
import { resolve } from "node:path";

// Fill a Red Bag: the server's way in to the ONE module that holds the rules for the list staff can
// edit: assets/js/red-bag-list.js. The admin screen loads that file in the browser to check as
// staff type; the server reads the same file here (as ./catalogue.ts reads the catalogue) to check
// every save and every publish, so the two can never disagree. This file only gives it types.

export interface RedBagListItem {
  /** Stable for ever: a built-in item's own key, or "n-..." for one staff added. */
  key: string;
  name: string;
  pence: number;
  /** The key of one of the four headings: home, play, books, clothing. */
  group: string;
  /** The key of one of the catalogue's drawings. */
  art: string;
  hidden: boolean;
}

export interface RedBagListExample {
  key: string;
  /** The key of one of the three themes: crisis, school, hand. */
  theme: string;
  pence: number;
  /** Follows the amount, and always begins "could help". */
  words: string;
  art: string;
  hidden: boolean;
}

/** A whole list, as it is stored (red_bag_lists.data) and as the admin screen edits it. */
export interface RedBagList {
  v: 1;
  items: RedBagListItem[];
  examples: RedBagListExample[];
}

export interface RedBagListProblem {
  kind: "item" | "example" | "list";
  key: string;
  field: string;
  message: string;
}

export interface RedBagListChange {
  kind: string;
  text: string;
}

/** The list as the page's catalogue reads it: what is showing, under each heading and theme. */
export interface RedBagListForPage {
  groups: Array<{ key: string; items: Array<{ key: string; name: string; pence: number; art: string }> }>;
  themes: Array<{ key: string; examples: Array<{ key: string; pence: number; words: string; art: string }> }>;
}

export interface RedBagListRules {
  LIMITS: Record<string, number>;
  PRESENT: string;
  COULD_HELP: string;
  MESSAGES: Record<string, string>;
  headingOf(key: string): string;
  titleOf(key: string): string;
  artKeys(): string[];
  /** The list written in the catalogue ("The original list"). A fresh copy every time. */
  builtIn(): RedBagList;
  /** What was sent, as a list and nothing more; null if it is not the shape of one. */
  clean(raw: unknown): RedBagList | null;
  same(a: unknown, b: unknown): boolean;
  wordingProblem(text: string): string;
  /** Everything wrong with a list. Empty: it may be saved and published. */
  validate(raw: unknown): RedBagListProblem[];
  newKey(name: string, taken: readonly string[], random?: () => number): string;
  parsePounds(typed: string): number | null;
  poundsBox(pence: number): string;
  /** What differs between the website's list and the draft, in plain words. */
  diff(website: unknown, draft: unknown): RedBagListChange[];
  countLine(n: number): string;
  changesWords(n: number): string;
  summary(lines: readonly RedBagListChange[]): string;
  toCatalogue(list: unknown): RedBagListForPage;
}

// This file compiles to dist/red-bag/list.js, so ../.. is the app root (as ./catalogue.ts).
const MODULE = resolve(__dirname, "../../assets/js/red-bag-list.js");
let cached: RedBagListRules | null = null;

/** The rules, read once and kept. Throws if the file is missing. */
export function redBagList(): RedBagListRules {
  if (!cached) cached = createRequire(MODULE)(MODULE) as RedBagListRules;
  return cached;
}
