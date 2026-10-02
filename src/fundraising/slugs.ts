import { RESERVED_SLUGS } from "./model";

// TASK-511: short page links, as Jaimie chose. A new sign up's page is nbcc.scot/fundraise/<the
// initials of its name>: "Sam's Santa Dash" is /fundraise/ssd. Kept simple: the first letter (or
// number) of each word, in lower case, nothing else. Under two letters, the first word is used
// instead ("Bakeathon" is /fundraise/bakeathon). A clash takes a number (ssd2, ssd3); a reserved
// address (a page of its own, like /fundraise/help) is never used; and the caller counts every
// address a page has EVER had as taken, so an old link, or a QR code printed with one, can never
// lead to someone else's page. Existing pages keep the address they have. Staff can still change any
// page's address in the admin; the old one then answers with a 301 to the new one.
// Pure: the SQL that reads what is taken is in src/db/fundraisers.ts.

export const SLUG_MAX = 30;
const FALLBACK = "fundraiser";

/** The words of a title, as plain lower case letters and numbers: accents dropped, apostrophes too. */
function words(title: string): string[] {
  return String(title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** "Sam's Santa Dash" -> "ssd"; "Bakeathon" -> "bakeathon"; nothing usable -> "fundraiser". */
export function initialsSlug(title: string): string {
  const w = words(title);
  const initials = w.map((word) => word.charAt(0)).join("").slice(0, SLUG_MAX);
  if (initials.length >= 2) return initials;
  const first = (w[0] ?? "").slice(0, SLUG_MAX);
  return first.length >= 2 ? first : FALLBACK;
}

/**
 * The address to use: the base when free, else base2, base3 and so on. `taken` holds every address in
 * use now and every one a page has had before; reserved ones are never used.
 */
export function freeSlugFrom(base: string, taken: ReadonlySet<string>): string {
  const free = (s: string) => !taken.has(s) && !RESERVED_SLUGS.has(s);
  if (free(base)) return base;
  let n = 2;
  while (!free(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}
