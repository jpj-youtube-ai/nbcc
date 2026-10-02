import { Router, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import { SITE_PAGES } from "../site/pages";
import { drawQr, qrLink, qrPath, qrRows, qrSlug } from "../site/qr";

// TASK-492: QR codes for the pages of nbcc.scot, in the admin.
//
//   GET /api/admin/qr-codes                                every page, its link, and its code    site: view
//   GET /api/admin/qr-codes/image?path=/ball&format=svg    one code to download, SVG or PNG     site: view
//
// The pages come from the site's one page list (src/site/pages.ts), so a new page there gets its
// code here with no more work. The codes only ever point at public pages of nbcc.scot: an address
// for somebody else's site is refused (qrPath). Anyone who can view Site pages may use them.

const BAD_PATH = "Give an address on nbcc.scot, starting with /";

// Whether the Festive Ball and Events pages are up. A switch that cannot be read counts as off:
// better "not live yet" on a row than a poster pointing at a page that is not there.
async function gates(): Promise<{ ballOpen: boolean; eventsOn: boolean }> {
  const ballOpen = (async () => {
    const [{ getSettings }, { isGateOpen }] = await Promise.all([import("../db/ball"), import("../ball/gate")]);
    return isGateOpen(await getSettings(), new Date());
  })().catch(() => false);
  const eventsOn = (async () => {
    const { getEventsSettings } = await import("../db/events");
    return (await getEventsSettings()).pageOn;
  })().catch(() => false);
  return { ballOpen: await ballOpen, eventsOn: await eventsOn };
}

export async function getQrCodes(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "site", "view"))) return;
  try {
    const rows = qrRows(SITE_PAGES, await gates());
    // Each code drawn as an SVG for its preview: a few kilobytes a page, and no second round trip.
    const pages = await Promise.all(rows.map(async (r) => ({ ...r, svg: (await drawQr(r.link, "svg")) as string })));
    return res.status(200).json({ pages });
  } catch (err) {
    console.error("admin qr codes: listing failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "The QR codes could not be made. Please try again." });
  }
}

export async function getQrImage(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "site", "view"))) return;
  const path = qrPath(req.query.path);
  const format = req.query.format;
  if (!path || (format !== "svg" && format !== "png")) return res.status(400).json({ error: BAD_PATH });
  try {
    const image = await drawQr(qrLink(path), format);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="nbcc-qr-${qrSlug(path)}.${format}"`);
    res.type(format === "svg" ? "image/svg+xml" : "image/png");
    return res.send(image);
  } catch (err) {
    console.error("admin qr codes: drawing failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "That QR code could not be made. Please try again." });
  }
}

export const adminQrRouter = Router();
adminQrRouter.get("/api/admin/qr-codes", getQrCodes);
adminQrRouter.get("/api/admin/qr-codes/image", getQrImage);
