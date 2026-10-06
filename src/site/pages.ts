// The public page registry (site-pages feature): the single source the /sitemap tree, the
// sitemap.xml feed, the admin "Site pages" panel and the alias validators all read, so a page
// added here appears everywhere at once and nothing can go stale independently. Pure — no DB,
// no config, no fs — so every rule is unit-tested directly.
import { RED_BAG_LIVE } from "../red-bag/switch";

export interface SitePage {
  path: string;
  title: string;
  // Should search engines list this page by DEFAULT? Admins can override per page (the
  // site_page_seo table); hard-excluded paths never reach that choice at all.
  listedByDefault: boolean;
  // Only meaningful for the ball pages: include them nowhere until the gate is open, so the
  // sitemap cannot leak an unannounced event.
  ballGated?: boolean;
  // TASK-453: the same for the Events page, which an admin switches on and off. Off, /events is a
  // 404, so listing it would offer search engines and visitors a dead link.
  eventsGated?: boolean;
  // TASK-494: the fundraising sign up, listed only while fundraising is switched on.
  fundraisingGated?: boolean;
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
  // Fill a Red Bag: listed for search engines while its switch is on (src/red-bag/switch.ts), so it
  // is on the site map; it is still linked from no menu, no footer and no page. Switched off the
  // address is a 404, so it is on no map. Its thank you, /fill/thank-you, is never here.
  ...(RED_BAG_LIVE ? [{ path: "/fill", title: "Fill a Red Bag", listedByDefault: true }] : []),
  { path: "/my-story", title: "Share your story", listedByDefault: true },
  { path: "/supporters", title: "Supporters", listedByDefault: true },
  { path: "/hub", title: "Hub", listedByDefault: true },
  // TASK-494: the Events page renamed; /events redirects here.
  { path: "/get-involved", title: "Get involved", listedByDefault: true, eventsGated: true },
  {
    path: "/fundraise",
    title: "Fundraise for us",
    listedByDefault: true,
    fundraisingGated: true,
    // TASK-498: gated itself too, since sitemap.xml lists every page flat, children included.
    children: [
      { path: "/fundraise/help", title: "Fundraising help", listedByDefault: true, fundraisingGated: true },
      // TASK-504: the logo pack, gated like the help page.
      { path: "/fundraise/logos", title: "Our logo, for fundraisers", listedByDefault: true, fundraisingGated: true },
    ],
  },
  { path: "/contact", title: "Contact", listedByDefault: true },
  // Joining the mailing list: the footer sign up form on a page of its own (newsletter.html).
  { path: "/newsletter", title: "Join our mailing list", listedByDefault: true },
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

/**
 * How a page is reached. Only "public" pages belong on /sitemap and in sitemap.xml.
 */
export type PageReach = "unlisted" | "link-only" | "staff";

export interface PrivatePage {
  path: string;
  title: string;
  reach: PageReach;
  /** Plain English, for a volunteer who has never seen this page. */
  note: string;
}

/**
 * Pages that exist but are NOT on the public map (TASK-402).
 *
 * Kept deliberately apart from SITE_PAGES, because that list feeds /sitemap and sitemap.xml and
 * none of these belong in either. This one exists for a different job: so the admin's page list
 * is COMPLETE. The point is not navigation, it is memory - a page nobody has opened in a year is
 * still somebody's responsibility, and the only way to keep it current is to be able to see that
 * it exists.
 */
export const PRIVATE_PAGES: PrivatePage[] = [
  {
    path: "/sitemap",
    title: "Site map",
    reach: "unlisted",
    note: "The public list of pages. Nothing links to it and search engines are told to skip it.",
  },
  {
    path: "/business/thank-you",
    title: "Business thank you",
    reach: "link-only",
    note: "Where a business chooses how it would like to be thanked. Opened from the link in its own thank-you email, and fillable once.",
  },
  {
    path: "/gift-aid/declare",
    title: "Gift Aid declaration",
    reach: "link-only",
    note: "The Gift Aid form a donor reaches from the link or QR code in their receipt. The page is built for that one donor.",
  },
  {
    path: "/portal/access",
    title: "Ask for a donor portal link",
    reach: "link-only",
    note: "A donor puts in their email address and we send them their own portal link.",
  },
  {
    path: "/invite",
    title: "Accept a staff invitation",
    reach: "link-only",
    note: "Where a new volunteer sets their password, from the link in their invitation email.",
  },
  {
    path: "/reset",
    title: "Reset a password",
    reach: "link-only",
    note: "Where a volunteer who has forgotten their password sets a new one.",
  },
  {
    path: "/fill/thank-you",
    title: "Fill a Red Bag: thank you",
    reach: "link-only",
    note: "Where a donor lands after giving on Fill a Red Bag. Nothing links to it and search engines are told to skip it.",
  },
  {
    path: "/admin",
    title: "Admin",
    reach: "staff",
    note: "This tool. Staff only, and behind a password and a code.",
  },
];

// Paths (and prefixes) that must never appear on the sitemap page// Paths (and prefixes) that must never appear on the sitemap page, in sitemap.xml, or as an
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
  // TASK-453: a real page (switched on and off from the admin), so no spare address may shadow it.
  // TASK-494 renamed it /get-involved; the old address stays reserved because it redirects there.
  "/events",
  "/get-involved",
  // TASK-496: the ways people type Get involved from a poster; both redirect there.
  "/getinvolved",
  "/involved",
  // TASK-494: the fundraising sign up, each fundraiser's page and the manage page.
  "/fundraise",
  // Event pages: each approved public event's own page, /event/<short name>.
  "/event",
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
  // Fill a Red Bag: a real page at /fill, with its thank you under it (/fill/thank-you), so no
  // spare address may shadow either. Reserving "/fill" takes /fill and what sits under it, not
  // every address that begins "fill".
  "/fill",
  // The address it first had, and the other way people type it: both redirect to /fill
  // (src/routes/red-bag.ts).
  "/fill-a-red-bag",
  "/fill-a-bag",
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

// TASK-568: a spare address may also forward to one of NBCC's own subdomains (nbcc.scot/drop to
// drop.nbcc.scot). Only ours: if a staff login were misused, an nbcc.scot link still could not be
// pointed at somebody else's website. The host is read by the URL parser, never by a pattern on what
// was typed, so a lookalike (nbcc.scot.example.com, drop.nbcc.scot@example.com) is seen for what it
// is. www.nbcc.scot and bare nbcc.scot are THIS site: a forward to them could send a visitor round
// in a circle, and the page list is the way to point at a page here.
const FORWARD_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+nbcc\.scot$/;
const FORWARD_PATH = /^(?:\/[A-Za-z0-9._~-]+)*\/?$/;
const LOOP_HOSTS = ["www.nbcc.scot"];
export const FORWARD_HELP =
  "Type an NBCC subdomain, like drop.nbcc.scot or drop.nbcc.scot/collect. It must end in .nbcc.scot.";

/**
 * What staff typed as a subdomain destination, in the form it is stored and sent: always https,
 * host lowercased, no trailing slash. Null when it is not an NBCC subdomain, or carries a port, a
 * user name, a query or a fragment.
 */
export function forwardTarget(typed: string): string | null {
  const raw = typed.trim();
  if (!raw || raw.length > 200 || /[\s\\<>"'?#]/.test(raw)) return null;
  let address = raw;
  if (!/^https?:\/\//i.test(raw)) {
    if (raw.includes("://") || raw.startsWith("/")) return null;
    address = `https://${raw}`;
  }
  // What is stored is what was typed: after the scheme, only plain letters, numbers and . / _ ~ -.
  // That refuses every port and user name outright (the parser quietly drops a default port and an
  // empty user name), and anything the parser would rewrite: %-codes, accents, lookalike letters.
  if (!/^[A-Za-z0-9._~/-]+$/.test(address.replace(/^https?:\/\//i, ""))) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!FORWARD_HOST.test(host) || LOOP_HOSTS.includes(host)) return null;
  if (!FORWARD_PATH.test(url.pathname)) return null;
  return `https://${host}${url.pathname.replace(/\/$/, "")}`;
}

/** Is this stored destination a forward to a subdomain (rather than one of the site's pages)? */
export function isForward(to: string): boolean {
  return to.startsWith("https://");
}

/** May `to` be an alias destination? A canonical page from the registry, or an NBCC subdomain in
 *  its stored form (see forwardTarget). */
export function aliasToProblem(to: string): string | null {
  if (to === "/") return null;
  if (isForward(to)) return forwardTarget(to) === to ? null : FORWARD_HELP;
  if (!isKnownPage(to)) return "The destination must be one of the site's real pages.";
  return null;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The /sitemap page's tree: nested lists of links, filtered by the ball gate, the Get involved page
// switch and the fundraising switch. Pure so the shape is testable; the route drops this into sitemap.html's .sitemap-tree
// placeholder.
export function renderSitemapTree(pages: SitePage[], ballOpen: boolean, eventsOn = false, fundraisingOn = false): string {
  const items = pages
    .filter((p) => !p.ballGated || ballOpen)
    .filter((p) => !p.eventsGated || eventsOn)
    .filter((p) => !p.fundraisingGated || fundraisingOn)
    .map((p) => {
      const kids = p.children ? renderSitemapTree(p.children, ballOpen, eventsOn, fundraisingOn) : "";
      return `<li><a href="${escapeHtml(p.path)}">${escapeHtml(p.title)}</a>${kids}</li>`;
    })
    .join("");
  return items ? `<ul>${items}</ul>` : "";
}

// sitemap.xml: the registry, minus ball-gated pages while the gate is shut, minus the Events page
// while it is switched off, minus anything the admin unticked (overrides) or that is unlisted by
// default without an admin tick. Absolute URLs on the production origin, as the protocol requires.
export function renderSitemapXml(
  pages: SitePage[],
  origin: string,
  overrides: Map<string, boolean>,
  ballOpen: boolean,
  eventsOn = false,
  fundraisingOn = false,
): string {
  const urls = flatten(pages)
    .filter((p) => !p.ballGated || ballOpen)
    .filter((p) => !p.eventsGated || eventsOn)
    .filter((p) => !p.fundraisingGated || fundraisingOn)
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
