import type { SitePage } from "./pages";
import { QR_BASE, qrRows, type QrGates } from "./qr";

// TASK-588: named QR codes (Jaimie, 3 November 2026). Staff make a code for each place one is
// printed or shown (a billboard, a business card, a table card), give it a name, and pick where it
// goes from a list, so no typed address can break a printed code. Each code counts its own scans.
//
//   the code on the piece   https://nbcc.scot/q/c12    short, so it scans easily even on a business
//                           card, and it never changes: staff can change where it goes, or fix a
//                           mistake, after it is printed.
//   where it goes           a 302 to the chosen page (with utm_medium=qr&utm_campaign=c12, so
//                           Admin > Analytics names the scan too), or to one of our sign up sites.
//   how it is counted       at the short link itself, as one number per code per day: nothing about
//                           the person scanning is kept. Counting there, not on the page it lands on,
//                           is what lets a code for drop.nbcc.scot count at all.
//
// Pure: no pool, no clock. The routes are src/routes/qr-codes.ts; the table is qr_codes.

/** Our three sign up sites: the other places a named code may go, besides the pages of nbcc.scot. */
export const SIGNUP_SITES: readonly { url: string; title: string }[] = [
  { url: "https://drop.nbcc.scot", title: "Drop-off points (drop.nbcc.scot)" },
  { url: "https://referrals.nbcc.scot", title: "Referrals (referrals.nbcc.scot)" },
  { url: "https://vol.nbcc.scot", title: "Volunteering (vol.nbcc.scot)" },
];

export type DestinationGroup = "page" | "signup";

export interface Destination {
  /** What is stored: a path on nbcc.scot ("/donate"), or a sign up site's address. */
  value: string;
  title: string;
  group: DestinationGroup;
  /** False for a page switched off for now (the Festive Ball before launch, say). */
  live: boolean;
}

/** Everything the "Goes to" list offers: every page of the site, then the sign up sites. */
export function qrDestinations(pages: readonly SitePage[], gates: QrGates): Destination[] {
  return [
    ...qrRows(pages, gates).map((r) => ({ value: r.path, title: r.title, group: "page" as const, live: r.live })),
    ...SIGNUP_SITES.map((s) => ({ value: s.url, title: s.title, group: "signup" as const, live: true })),
  ];
}

const ALL_OPEN: QrGates = { ballOpen: true, eventsOn: true, fundraisingOn: true };

/** Whether a "Goes to" sent to the server is one of the list's own, exactly. Nothing typed gets in. */
export function isDestination(value: unknown, pages: readonly SitePage[]): value is string {
  return typeof value === "string" && qrDestinations(pages, ALL_OPEN).some((d) => d.value === value);
}

/** A destination's name for the screen, or the stored value itself if it has left the list. */
export function destinationTitle(value: string, pages: readonly SitePage[]): string {
  return qrDestinations(pages, ALL_OPEN).find((d) => d.value === value)?.title ?? value;
}

/** "c12": what follows /q/ on a named code, and the tag its scans carry into Analytics. */
export function namedCampaign(id: number): string {
  return `c${id}`;
}

/** "/q/c12": the path a named code carries, on the public site's address. */
export function namedShortPath(id: number): string {
  return `/q/${namedCampaign(id)}`;
}

/** "https://nbcc.scot/q/c12": the link the code itself holds. */
export function namedShortLink(id: number): string {
  return `${QR_BASE}${namedShortPath(id)}`;
}

/** The code's id, when a /q/ link (or an Analytics tag) is one of ours; null when it is anything else. */
export function parseNamedCode(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  // Capitals are fine: some phones' cameras send the whole address in capitals.
  const m = /^c([1-9]\d{0,9})$/i.exec(raw);
  if (!m) return null;
  const id = Number(m[1]);
  return id <= 2147483647 ? id : null;
}

// The same rule as qrPath (src/site/qr.ts): a plain path on our own site, nothing else.
const PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/;

/**
 * Where a scan of code `id` goes now. A page gets its Analytics tags; a sign up site is sent as it
 * is. A stored value that is neither (it never should be) goes to the home page, so a printed code
 * can never be turned into a way off to somebody else's site.
 */
export function namedTarget(stored: string, id: number): string {
  if (SIGNUP_SITES.some((s) => s.url === stored)) return stored;
  const path = PATH.test(stored) ? stored : "/";
  return `${QR_BASE}${path}?utm_medium=qr&utm_campaign=${namedCampaign(id)}`;
}

export const NAME_MAX = 80;

/** A typed name, tidied (spaces trimmed and squeezed), or null when it is empty or too long. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  return name.length > 0 && name.length <= NAME_MAX ? name : null;
}

export interface ScanSummary {
  total: number;
  /** Today and the six days before it. */
  week: number;
  /** The last UK day with a scan, "2026-11-03", or null for none yet. */
  lastDay: string | null;
}

/** One code's scans, from its rows of one number per UK day. `today` is the UK date, "2026-11-03". */
export function scanSummary(rows: readonly { day: string; scans: number }[], today: string): ScanSummary {
  const weekStart = new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  let total = 0;
  let week = 0;
  let lastDay: string | null = null;
  for (const r of rows) {
    if (r.scans <= 0) continue;
    total += r.scans;
    if (r.day >= weekStart && r.day <= today) week += r.scans;
    if (lastDay === null || r.day > lastDay) lastDay = r.day;
  }
  return { total, week, lastDay };
}

/** Analytics' names for the named codes' tags among its QR rows: "c12" -> "Donate billboard". */
export function labelNamedScans(campaigns: readonly (string | null)[], names: ReadonlyMap<number, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of campaigns) {
    const id = parseNamedCode(c);
    if (id === null || c === null) continue;
    out.set(c, names.get(id) ?? `QR code ${id}`);
  }
  return out;
}
