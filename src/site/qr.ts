import QRCode from "qrcode";
import type { SitePage } from "./pages";

// TASK-492: QR codes for the pages of nbcc.scot, made in the admin for posters, leaflets and
// slides. The rules here are pure: which pages get a code, the link a code carries, and which
// typed addresses are allowed. The pages come from the site's one page list (SITE_PAGES), which
// also feeds /sitemap and Admin > Site pages, so a page added there gets its code with no more
// work. Drawing the codes is drawQr, below; the routes are src/routes/admin-qr.ts.

/** Where every code points. Always the public site, whichever host the admin is opened on. */
export const QR_BASE = "https://nbcc.scot";

/** A page's short name: in its code's tag and its download's file name. "/" is "home". */
export function qrSlug(path: string): string {
  const slug = path.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
  return slug || "home";
}

/**
 * The link a page's code carries. `utm_medium=qr` is how Admin > Analytics counts a scan apart
 * from a typed address (src/analytics/channel.ts), and the campaign says which page's code it was.
 */
export function qrLink(path: string): string {
  return `${QR_BASE}${path}?utm_medium=qr&utm_campaign=${qrSlug(path)}`;
}

// Letters, numbers, - and _ between single slashes: a path on our own site and nothing else, so a
// code can never be made for somebody else's address, and no query or fragment can be slipped in.
const PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/;

/** A typed address, tidied, when it is a path on nbcc.scot; null when it is anything else. */
export function qrPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim();
  if (path.length === 0 || path.length > 200 || !PATH.test(path)) return null;
  return path;
}

export interface QrRow {
  path: string;
  title: string;
  /** False for a page switched off (the Festive Ball before launch, Events while off). */
  live: boolean;
  link: string;
}

/** Every page in the list, children after their parent, in order. */
export function qrRows(
  pages: readonly SitePage[],
  gates: { ballOpen: boolean; eventsOn: boolean },
  parentLive = true,
): QrRow[] {
  return pages.flatMap((p) => {
    const live =
      parentLive && (!p.ballGated || gates.ballOpen) && (!p.eventsGated || gates.eventsOn);
    return [
      { path: p.path, title: p.title, live, link: qrLink(p.path) },
      ...qrRows(p.children ?? [], gates, live),
    ];
  });
}

/**
 * Admin > Analytics counts scans by the tag each code carries (its campaign); staff read them as
 * page names. A tag not in the page list (a code made for another address) shows as that address.
 */
export function labelQrScans(
  rows: readonly { campaign: string | null; visits: number }[],
  pages: readonly SitePage[],
): { label: string; visits: number }[] {
  const titles = new Map(qrRows(pages, { ballOpen: true, eventsOn: true }).map((r) => [qrSlug(r.path), r.title]));
  return rows.map((r) => ({
    label: r.campaign === null ? "Not named" : (titles.get(r.campaign) ?? `/${r.campaign}`),
    visits: r.visits,
  }));
}

// Black on white with the standard four-module margin, and error correction M (15%): the most
// reliable to scan in print, from a poster across a room or a leaflet in poor light.
const DRAW = { errorCorrectionLevel: "M" as const, margin: 4, color: { dark: "#000000", light: "#ffffff" } };

export type QrFormat = "svg" | "png";

/** The code for a link: an SVG (text) for printing at any size, or a 1200 pixel PNG. */
export async function drawQr(link: string, format: QrFormat): Promise<string | Buffer> {
  if (format === "svg") return QRCode.toString(link, { ...DRAW, type: "svg" });
  return QRCode.toBuffer(link, { ...DRAW, type: "png", width: 1200 });
}
