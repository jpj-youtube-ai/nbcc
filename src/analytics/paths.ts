// TASK-479: which page a view was of. Only the site's own pages are kept, by their canonical clean
// address from the site map (src/site/pages.ts); anything else is "other". The query string and
// anything after it are thrown away first, so a token in an address can never reach a table.
import { ALL_PAGES } from "../site/pages";

// Public pages that carry pulse.js but are deliberately not on the site map.
const UNLISTED_PUBLIC = ["/sitemap", "/business/thank-you", "/gift-aid/declare"];

const KNOWN = new Set<string>([...ALL_PAGES.map((p) => p.path), ...UNLISTED_PUBLIC]);

// Pages whose address carries a token: every one is filed under a single path, never the token.
const TOKEN_PREFIXES: [string, string][] = [["/api/gift-aid/", "/gift-aid/declare"]];

export function canonicalPath(raw: string): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "other";
  let path = raw.replace(/[?#].*$/, "").toLowerCase();
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "") path = "/";
  if (KNOWN.has(path)) return path;
  for (const [prefix, canonical] of TOKEN_PREFIXES) {
    if (path.startsWith(prefix)) return canonical;
  }
  return "other";
}
