import { hasPage, isValidSlug, pagePath, type FundraiserRecord } from "./model";

// TASK-512: a QR code of its own for every printed piece, so a scan says where it came from
// ("Sam's Santa Dash, A4 poster"). Pure: no pool, no clock.
//
//   the code on the piece   https://nbcc.scot/q/12-a4    the fundraiser's id and the piece's size.
//                           Short, so the code stays small and easy to scan, and it never has to
//                           change: it is looked up by the fundraiser's id, never its address, so a
//                           page whose address staff change is still found, for good.
//   where it goes           a 302 to the fundraiser's page as it is called now (or Get involved, for
//                           a listed event), with utm_medium=qr&utm_campaign=f12-a4 on it.
//   how it is counted       by the site's own visit counter (TASK-479), which counts utm_medium=qr
//                           as a QR code scan (TASK-492), so it shows in Admin > Analytics under QR
//                           codes, named "Sam's Santa Dash, A4 poster", and per piece in Admin >
//                           Fundraising. Nothing new is stored: like every visit, a scan is not
//                           counted for anyone whose browser asks not to be tracked, and it is kept
//                           for the 13 months Analytics keeps everything.
//
// The route is src/routes/fundraise-materials.ts (GET /q/:code).

/** The printed pieces with a QR code, and the size each one's code says. */
export const TRACKED = { poster: "a4", "poster-a3": "a3", leaflet: "a5" } as const;
export type TrackedPiece = keyof typeof TRACKED;
export type MaterialCode = (typeof TRACKED)[TrackedPiece];
export const TRACKED_PIECES = Object.keys(TRACKED) as TrackedPiece[];

export const CODE_NAMES: Record<MaterialCode, string> = { a4: "A4 poster", a3: "A3 poster", a5: "A5 leaflet" };

const CODES = new Set<string>(Object.values(TRACKED));
const isCode = (c: string): c is MaterialCode => CODES.has(c);

/** "12-a4": what follows /q/ on a piece. */
export function shortCode(id: number, piece: TrackedPiece): string {
  return `${id}-${TRACKED[piece]}`;
}

/** "/q/12-a4": the path a piece's QR code carries, on the public site's address. */
export function trackedPath(id: number, piece: TrackedPiece): string {
  return `/q/${shortCode(id, piece)}`;
}

function idOf(digits: string): number | null {
  const id = Number(digits);
  return Number.isSafeInteger(id) && id >= 1 && id <= 2147483647 ? id : null;
}

/** What a /q/ link names, or null when it is not one of ours. Capitals are fine (phones shout). */
export function parseShortCode(raw: unknown): { id: number; code: MaterialCode } | null {
  if (typeof raw !== "string") return null;
  const m = /^([1-9]\d{0,9})-(a[345])$/.exec(raw.toLowerCase());
  if (!m || !isCode(m[2])) return null;
  const id = idOf(m[1]);
  return id ? { id, code: m[2] } : null;
}

/** "f12-a4": the tag a scan carries into Analytics (utm_campaign). */
export function scanCampaign(id: number, code: MaterialCode): string {
  return `f${id}-${code}`;
}

export function parseScanCampaign(raw: unknown): { id: number; code: MaterialCode } | null {
  if (typeof raw !== "string") return null;
  const m = /^f([1-9]\d{0,9})-(a[345])$/.exec(raw);
  if (!m || !isCode(m[2])) return null;
  const id = idOf(m[1]);
  return id ? { id, code: m[2] } : null;
}

/**
 * Where a scan of this fundraiser's piece goes now: its page under its CURRENT address, or Get
 * involved for a listed event; null when there is nowhere to send anyone (declined, new, or not on
 * the website). Always a path on our own site: a stored address that is not a valid one goes
 * nowhere, so the link can never be turned into a way off the site.
 */
export function scanTarget(
  f: Pick<FundraiserRecord, "id" | "slug" | "path" | "public" | "status">,
  code: MaterialCode,
): string | null {
  const tag = `?utm_medium=qr&utm_campaign=${scanCampaign(f.id, code)}`;
  // Event pages: an event's page is /event/<short name> (pagePath). An event whose stored address is
  // not a valid one falls through to Get involved below, as before event pages (review fix).
  if (hasPage(f) && isValidSlug(f.slug)) return `${pagePath(f)}${tag}`;
  if (hasPage(f) && f.path !== "event") return null;
  if (f.path === "event" && f.public && (f.status === "approved" || f.status === "finished")) return `/get-involved${tag}`;
  return null;
}

/** "Sam's Santa Dash, A4 poster" for each fundraiser tag; other tags are left to the page list. */
export function labelScanCampaigns(campaigns: readonly (string | null)[], titles: ReadonlyMap<number, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of campaigns) {
    const parsed = parseScanCampaign(c);
    if (!parsed || c === null) continue;
    out.set(c, `${titles.get(parsed.id) ?? `Fundraiser ${parsed.id}`}, ${CODE_NAMES[parsed.code]}`);
  }
  return out;
}

export interface MaterialScanCount {
  piece: TrackedPiece;
  code: MaterialCode;
  label: string;
  scans: number;
}

/** One fundraiser's scans, every printed piece listed (none as 0), in the order the pieces come. */
export function materialScanCounts(id: number, rows: readonly { campaign: string | null; scans: number }[]): MaterialScanCount[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const parsed = parseScanCampaign(r.campaign);
    if (parsed && parsed.id === id) by.set(parsed.code, (by.get(parsed.code) ?? 0) + Number(r.scans || 0));
  }
  return TRACKED_PIECES.map((piece) => {
    const code = TRACKED[piece];
    return { piece, code, label: CODE_NAMES[code], scans: by.get(code) ?? 0 };
  });
}
