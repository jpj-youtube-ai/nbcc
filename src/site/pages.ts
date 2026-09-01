// The public page registry (site-pages feature): the single source the /sitemap tree, the
// sitemap.xml feed, the admin "Site pages" panel and the alias validators all read, so a page
// added here appears everywhere at once and nothing can go stale independently. Pure — no DB,
// no config, no fs — so every rule is unit-tested directly.

export interface SitePage {
  path: string;
  title: string;
  // Should search engines list this page by DEFAULT? Admins can override per page (the
  // site_page_seo table); hard-excluded paths never reach that choice at all.
  listedByDefault: boolean;
  // Only meaningful for the ball pages: include them nowhere until the gate is open, so the
  // sitemap cannot leak an unannounced event.
  ballGated?: boolean;
  children?: SitePage[];
}

// The tree the /sitemap page renders. Paths are the CANONICAL clean URLs from _redirects.
// /donate/thank-you and /donor-portal are real public pages (so the tree shows them) but are
// unlisted by default: one is a post-payment landing, the other a personal-access entry —
// neither is a search destination.
export const SITE_PAGES: SitePage[] = [
  { path: "/", title: "Home", listedByDefault: true },
  { path: "/about-us", title: "About us", listedByDefault: true },
  {
    path: "/donate",
    title: "Donate",
    listedByDefault: true,
    children: [{ path: "/donate/thank-you", title: "Thank you", listedByDefault: false }],
  },
  { path: "/my-story", title: "Share your story", listedByDefault: true },
  { path: "/supporters", title: "Supporters", listedByDefault: true },
  { path: "/hub", title: "Hub", listedByDefault: true },
  { path: "/contact", title: "Contact", listedByDefault: true },
  { path: "/privacy", title: "Privacy notice", listedByDefault: true },
  { path: "/donor-portal", title: "Donor portal", listedByDefault: false },
  {
    path: "/ball",
    title: "Festive Ball",
    listedByDefault: true,
    ballGated: true,
    children: [{ path: "/ball/terms", title: "Ticket terms", listedByDefault: true, ballGated: true }],
  },
];

// Paths (and prefixes) that must never appear on the sitemap page, in sitemap.xml, or as an
// alias target/source: admin surfaces, token-addressed pages, machine endpoints. An alias may
// not shadow any of these either — routing order would make some shadows silently dead and
// others live, and neither is acceptable.
export const RESERVED_PREFIXES: string[] = [
  "/admin",
  "/api",
  "/assets",
  "/ball",
  "/business",
  "/donate",
  "/donor-portal",
  "/g",
  "/gift-aid",
  "/health",
  "/hub",
  "/invite",
  "/media",
  "/my-story",
  "/newsletter",
  "/portal/access",
  "/privacy",
  "/reset",
  "/sitemap",
  "/supporters",
  "/thank-you",
  "/unsubscribe",
  "/about-us",
  "/contact",
  "/festive-ball",
  "/a-night-to-remember",
  "/set-password",
];

const PATH_SHAPE = /^\/[a-z0-9-]+(\/[a-z0-9-]+)?$/;

function flatten(pages: SitePage[]): SitePage[] {
  return pages.flatMap((p) => [p, ...flatten(p.children ?? [])]);
}

export const ALL_PAGES: SitePage[] = flatten(SITE_PAGES);

export function isKnownPage(path: string): boolean {
  return ALL_PAGES.some((p) => p.path === path);
}

/**
 * May `from` become a spare address? Lowercase clean-URL shape, one or two segments, and it
 * must not equal or sit under anything reserved — a spare address that shadowed a real page
 * or a system route would be silently dead (or worse, live). Returns the refusal reason, or
 * null when the path is acceptable.
 */
export function aliasFromProblem(from: string): string | null {
  if (!PATH_SHAPE.test(from)) {
    return "A spare address is a short lowercase path like /give or /old/page (letters, numbers and hyphens).";
  }
  const shadowed = RESERVED_PREFIXES.find((r) => from === r || from.startsWith(`${r}/`));
  if (shadowed) return `That address is already in use by the site (${shadowed}).`;
  return null;
}

/** May `to` be an alias destination? Only a canonical page from the registry. */
export function aliasToProblem(to: string): string | null {
  if (to === "/") return null;
  if (!isKnownPage(to)) return "The destination must be one of the site's real pages.";
  return null;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The /sitemap page's tree: nested lists of links, filtered by the ball gate. Pure so the
// shape is testable; the route drops this into sitemap.html's .sitemap-tree placeholder.
export function renderSitemapTree(pages: SitePage[], ballOpen: boolean): string {
  const items = pages
    .filter((p) => !p.ballGated || ballOpen)
    .map((p) => {
      const kids = p.children ? renderSitemapTree(p.children, ballOpen) : "";
      return `<li><a href="${escapeHtml(p.path)}">${escapeHtml(p.title)}</a>${kids}</li>`;
    })
    .join("");
  return items ? `<ul>${items}</ul>` : "";
}

// sitemap.xml: the registry, minus ball-gated pages while the gate is shut, minus anything the
// admin unticked (overrides) or that is unlisted by default without an admin tick. Absolute
// URLs on the production origin, as the protocol requires.
export function renderSitemapXml(
  pages: SitePage[],
  origin: string,
  overrides: Map<string, boolean>,
  ballOpen: boolean,
): string {
  const urls = flatten(pages)
    .filter((p) => !p.ballGated || ballOpen)
    .filter((p) => overrides.get(p.path) ?? p.listedByDefault)
    .map((p) => `  <url><loc>${origin}${p.path === "/" ? "/" : escapeHtml(p.path)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// The day-one spare addresses (approved 2026-09-01): the two the commissioners named plus the
// common guesses people type. Seeded by the migration; from then on the admin panel owns them.
export const DEFAULT_ALIASES: { from: string; to: string }[] = [
  { from: "/about", to: "/about-us" },
  { from: "/mystory", to: "/my-story" },
  { from: "/contact-us", to: "/contact" },
  { from: "/donations", to: "/donate" },
  { from: "/give", to: "/donate" },
  { from: "/portal", to: "/donor-portal" },
  { from: "/privacy-policy", to: "/privacy" },
  { from: "/supporter", to: "/supporters" },
  { from: "/story", to: "/my-story" },
  { from: "/stories", to: "/my-story" },
];
