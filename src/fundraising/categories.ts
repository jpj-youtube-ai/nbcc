import { z } from "zod";

// Fundraising categories: what someone is doing to raise money, or what kind of event it is. One
// category each, shown A to Z on the sign up form with Other last, and admins can add more,
// rename them, and hide them from the form (Admin > Fundraising, Categories).
//
// The list lives in the fundraising_categories table (migrations/1791200000160). fundraisers.kind
// holds a category's key. A key never changes and a category is never deleted, so every sign up's
// category always has a name: renaming changes the name everywhere at once, and hiding one only
// takes it off the form.
//
// Pure: no pool, no clock. The list read from the database is remembered here (rememberCategories,
// called by src/db/fundraising-categories.ts), so the sign up rules and every name shown can use it
// without a database. Until it has been read, the built in list below stands in for it.
//
// For other code: categoryLabel(key) is the name to show, and isKind(key, ...) asks "is it one of
// these?", matching an old category to the ones it was split into.

export interface Category {
  key: string;
  label: string;
  /** On the sign up form. False: no longer offered, but still named for the sign ups that chose it. */
  active: boolean;
  /** The sign up tidy: a sporting category (Run, Walk, Santa dash...). Someone raising money for a
   * sporting event sees only these, with Other; anyone else sees the rest, with Other. */
  sporty?: boolean;
  /** The sign up tidy: a way of giving in memory of someone ("Donations instead of flowers"),
   * offered only on the in memory path, and never on the others. */
  memoryOnly?: boolean;
  createdAt?: string | null;
  createdBy?: string | null;
  retiredAt?: string | null;
  /** How many sign ups have it (the admin's list only). */
  used?: number;
}

/** Other: always on the form, always last, with a box for what it is in their words. Once called
 * "Other"; the key is unchanged. */
export const OTHER_KIND = "other";

/** A key: small letters, digits and underscores, starting with a letter. Never shown to anyone. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const LABEL_MIN = 2;
export const LABEL_MAX = 40;

/** What the form offers to start with, as the migration seeds it. */
export const STARTING_CATEGORIES: readonly Category[] = [
  // "bake_sale" was "A bake sale or coffee morning", so a bake sale on its own takes a key of its own.
  { key: "bake_sale_2", label: "Bake sale", active: true, sporty: false },
  { key: "birthday", label: "Birthday", active: true, sporty: false },
  { key: "coffee_morning", label: "Coffee morning", active: true, sporty: false },
  { key: "party", label: "Party", active: true, sporty: false },
  { key: "quiz", label: "Quiz", active: true, sporty: false },
  { key: "run", label: "Run", active: true, sporty: true },
  { key: "santa_dash", label: "Santa dash", active: true, sporty: true },
  { key: "school_collection", label: "School collection", active: true, sporty: false },
  { key: "walk", label: "Walk", active: true, sporty: true },
  { key: "workplace_collection", label: "Workplace collection", active: true, sporty: false },
  { key: OTHER_KIND, label: "Other", active: true, sporty: false },
];

/**
 * The "this or that" categories from before, no longer offered. The sign ups that chose one keep it,
 * shown by its old name, until staff change it to one of the new ones.
 */
export const LEGACY_CATEGORIES: readonly Category[] = [
  { key: "run_walk", label: "Run or walk", active: false },
  { key: "bake_sale", label: "Bake sale or coffee morning", active: false },
  { key: "quiz_party", label: "Quiz or party", active: false },
  { key: "collection", label: "Workplace or school collection", active: false },
];

export const BUILT_IN_CATEGORIES: readonly Category[] = [...STARTING_CATEGORIES, ...LEGACY_CATEGORIES];

/**
 * The sign up tidy (Jaimie, 2026-10-03): "How will people be giving?", asked only in memory of
 * someone, in place of "What are you doing to raise money?". Seeded by
 * migrations/1791200000210_signup-tidy.js; Other ("Something else" on that path) is in both lists.
 */
export const MEMORY_CATEGORIES: readonly Category[] = [
  { key: "memory_flowers", label: "Donations instead of flowers", active: true, sporty: false, memoryOnly: true },
  { key: "memory_service", label: "A collection at the funeral or service", active: true, sporty: false, memoryOnly: true },
  { key: "memory_event", label: "A memorial walk, run or event", active: true, sporty: false, memoryOnly: true },
];

/** Every category the code knows before the database is read: the built in ones and the in memory ones. */
export const ALL_BUILT_IN_CATEGORIES: readonly Category[] = [...BUILT_IN_CATEGORIES, ...MEMORY_CATEGORIES];

/** Each old category, and the ones it was split into. */
export const KIND_SPLITS: Readonly<Record<string, readonly string[]>> = {
  run_walk: ["run", "walk"],
  bake_sale: ["bake_sale_2", "coffee_morning"],
  quiz_party: ["quiz", "party"],
  collection: ["school_collection", "workplace_collection"],
};

// --- the order -----------------------------------------------------------------------------------

const collator = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** A to Z by name, whatever the case, with Other always last. A new list; the old is untouched. */
export function sortCategories<T extends Pick<Category, "key" | "label">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.key === OTHER_KIND || b.key === OTHER_KIND) return a.key === OTHER_KIND ? (b.key === OTHER_KIND ? 0 : 1) : -1;
    return collator.compare(a.label, b.label) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });
}

// --- the list as last read -----------------------------------------------------------------------

let known: Map<string, Category> = new Map(ALL_BUILT_IN_CATEGORIES.map((c) => [c.key, c]));

/** The list as read from the database. Every name and every check below uses it from then on. */
export function rememberCategories(list: readonly Category[]): void {
  known = new Map(list.map((c) => [c.key, c]));
}

/** Every category as last read, A to Z, Other last. */
export function knownCategories(): Category[] {
  return sortCategories([...known.values()]);
}

/** What the sign up form offers: the categories on offer, A to Z, Other last. Never the in memory ones. */
export function formCategories(list: readonly Category[] = [...known.values()]): Category[] {
  return sortCategories(list.filter((c) => c.active && !c.memoryOnly));
}

/** The sign up tidy: the ways of giving in memory of someone on offer, A to Z, then Other. */
export function memoryCategories(list: readonly Category[] = [...known.values()]): Category[] {
  return sortCategories(list.filter((c) => c.active && (c.memoryOnly || c.key === OTHER_KIND)));
}

/** Is this one of the in memory ways of giving? */
export function isMemoryCategory(key: unknown): boolean {
  return typeof key === "string" && known.get(key)?.memoryOnly === true;
}

/** Is this a category the list knows, on the form or not (an old one, or one staff have hidden)? */
export function isKnownCategory(key: unknown): key is string {
  return typeof key === "string" && known.has(key);
}

/** Is this a category a sign up may choose now? */
export function isActiveCategory(key: unknown): key is string {
  return typeof key === "string" && known.get(key)?.active === true;
}

const BUILT_IN_LABELS: ReadonlyMap<string, string> = new Map(ALL_BUILT_IN_CATEGORIES.map((c) => [c.key, c.label]));

/**
 * The name to show for a category: the stored one, else the built in one, else the key made readable
 * ("sponsored_silence" -> "Sponsored silence"), so a sign up's category is never shown as nothing.
 */
export function categoryLabel(key: string | null | undefined): string {
  const k = String(key ?? "");
  const label = known.get(k)?.label ?? BUILT_IN_LABELS.get(k);
  if (label) return label;
  const words = k.replace(/_\d+$/, "").replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Other";
}

/**
 * Is this category one of these? True for the key itself, and across a split: an old category
 * matches the ones it was split into, and they match it. So isKind(f.kind, "bake_sale") is true for
 * an old "bake sale or coffee morning" sign up and for a new Bake sale or Coffee morning one, and
 * isKind(f.kind, "run") is true for a Run and for an old "run or walk".
 */
export function isKind(key: string | null | undefined, ...kinds: string[]): boolean {
  if (!key) return false;
  return kinds.some((k) => k === key || (KIND_SPLITS[k] ?? []).includes(key) || (KIND_SPLITS[key] ?? []).includes(k));
}

// --- adding one ----------------------------------------------------------------------------------

/** A new category's key, made from its name, never one already used (old ones included). */
export function categoryKeyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "category";
  if (!/^[a-z]/.test(base)) base = `k_${base}`;
  base = base.slice(0, 34).replace(/_+$/, "");
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}_${n}`;
    if (!used.has(key)) return key;
  }
}

/** The name staff type: tidied (trimmed, single spaced, a capital first), letters and numbers. */
export const categoryLabelSchema = z
  .string({ invalid_type_error: "Give the category a name." })
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(LABEL_MIN, "Give the category a name, like Sponsored silence.")
      .max(LABEL_MAX, `Keep the name to ${LABEL_MAX} characters or fewer.`)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} '’&.,()-]*$/u, "Use letters, numbers and spaces in the name."),
  )
  .transform((v) => v.charAt(0).toUpperCase() + v.slice(1));
