import { Router, type NextFunction, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import { qrGates } from "./admin-qr";
import { SITE_PAGES } from "../site/pages";
import { drawQr } from "../site/qr";
import {
  cleanName,
  destinationTitle,
  isDestination,
  namedShortLink,
  namedTarget,
  parseNamedCode,
  qrDestinations,
  scanSummary,
  NAME_MAX,
} from "../site/qr-named";
import { countScan, createQrCode, listQrCodes, listScanDays, qrCodeTarget, updateQrCode, type QrCodeChange } from "../db/qr-codes";
import { isBot } from "../analytics/user-agent";
import { ukDay } from "../analytics/visitor";

// TASK-588: named QR codes (src/site/qr-named.ts), each with its own scans.
//
//   GET   /api/admin/qr-codes/named                 the codes, their scans, and the Goes to list   site: view
//   POST  /api/admin/qr-codes/named                 make one: { name, target }                     site: edit
//   PATCH /api/admin/qr-codes/named/:id             rename, change where it goes, hide or show     site: edit
//   GET   /api/admin/qr-codes/named/:id/image       one code to download, ?format=svg|png          site: view
//   GET   /q/c<id>                                  a scan: counted, then a 302 to where it goes   public
//
// The target is only ever a value from the Goes to list (isDestination), so a typed address can never
// break a printed code. A scan is answered first and counted after, so a slow or failed count never
// holds anyone up; bots and link previews are not counted.

const BAD_NAME = `Give the code a name, up to ${NAME_MAX} letters, so you know which one it is.`;
const BAD_TARGET = "Choose where the code goes from the list.";
const NOT_FOUND = "That QR code is not there. It may have been made on another screen: reload the page.";

function idOf(raw: unknown): number | null {
  const s = String(raw ?? "");
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  const id = Number(s);
  return id <= 2147483647 ? id : null;
}

export async function getNamedCodes(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "site", "view"))) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const [codes, days, gates] = await Promise.all([listQrCodes(), listScanDays(), qrGates()]);
    const today = ukDay(new Date());
    const destinations = qrDestinations(SITE_PAGES, gates);
    const live = new Map(destinations.map((d) => [d.value, d.live]));
    const out = await Promise.all(
      codes.map(async (c) => ({
        id: c.id,
        name: c.name,
        target: c.target,
        targetTitle: destinationTitle(c.target, SITE_PAGES),
        targetLive: live.get(c.target) ?? true,
        hidden: c.hidden,
        link: namedShortLink(c.id),
        createdAt: c.createdAt,
        scans: scanSummary(days.filter((d) => d.codeId === c.id), today),
        svg: (await drawQr(namedShortLink(c.id), "svg")) as string,
      })),
    );
    return res.status(200).json({ codes: out, destinations });
  } catch (err) {
    console.error("admin named qr codes: listing failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "The named QR codes could not load. Please try again." });
  }
}

export async function postNamedCode(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "site", "edit");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = cleanName(body.name);
  if (!name) return res.status(400).json({ error: BAD_NAME, field: "name" });
  if (!isDestination(body.target, SITE_PAGES)) return res.status(400).json({ error: BAD_TARGET, field: "target" });
  try {
    const code = await createQrCode(name, body.target, `admin:${claims.email}`);
    return res.status(201).json({ id: code.id, link: namedShortLink(code.id) });
  } catch (err) {
    console.error("admin named qr codes: making one failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "That QR code could not be made. Please try again." });
  }
}

export async function patchNamedCode(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "site", "edit");
  if (!claims) return;
  res.setHeader("Cache-Control", "no-store");
  const id = idOf(req.params.id);
  if (!id) return res.status(404).json({ error: NOT_FOUND });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const change: QrCodeChange = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return res.status(400).json({ error: BAD_NAME, field: "name" });
    change.name = name;
  }
  if (body.target !== undefined) {
    if (!isDestination(body.target, SITE_PAGES)) return res.status(400).json({ error: BAD_TARGET, field: "target" });
    change.target = body.target;
  }
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== "boolean") return res.status(400).json({ error: "Say whether to hide the code." });
    change.hidden = body.hidden;
  }
  if (Object.keys(change).length === 0) return res.status(400).json({ error: "Nothing to change." });
  try {
    const code = await updateQrCode(id, change, `admin:${claims.email}`);
    if (!code) return res.status(404).json({ error: NOT_FOUND });
    return res.status(200).json({ id: code.id });
  } catch (err) {
    console.error("admin named qr codes: changing one failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "That change could not be saved. Please try again." });
  }
}

export async function getNamedCodeImage(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "site", "view"))) return;
  const id = idOf(req.params.id);
  const format = req.query.format;
  if (!id) return res.status(404).json({ error: NOT_FOUND });
  if (format !== "svg" && format !== "png") return res.status(400).json({ error: "Choose SVG or PNG." });
  try {
    if ((await qrCodeTarget(id)) === null) return res.status(404).json({ error: NOT_FOUND });
    const image = await drawQr(namedShortLink(id), format);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="nbcc-qr-c${id}.${format}"`);
    res.type(format === "svg" ? "image/svg+xml" : "image/png");
    return res.send(image);
  } catch (err) {
    console.error("admin named qr codes: drawing failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "That QR code could not be made. Please try again." });
  }
}

/** A scan. Anything that is not one of our named codes falls through (to the fundraisers' /q/ links, then the 404 page). */
export async function getNamedScan(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = parseNamedCode(req.params.code);
  if (id === null) return next();
  let target: string | null;
  try {
    target = await qrCodeTarget(id);
  } catch (err) {
    console.error("named qr code: lookup failed:", err instanceof Error ? err.message : err);
    return next();
  }
  if (target === null) return next();
  // Never kept by a browser or a proxy, so a change of where it goes is followed at once.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.redirect(302, namedTarget(target, id));
  const ua = req.headers["user-agent"];
  if (req.method === "GET" && !isBot(Array.isArray(ua) ? (ua[0] ?? "") : (ua ?? ""))) {
    countScan(id, ukDay(new Date())).catch((err) => {
      console.error("named qr code: counting a scan failed:", err instanceof Error ? err.message : err);
    });
  }
}

export const qrCodesRouter = Router();
qrCodesRouter.get("/api/admin/qr-codes/named", getNamedCodes);
qrCodesRouter.post("/api/admin/qr-codes/named", postNamedCode);
qrCodesRouter.patch("/api/admin/qr-codes/named/:id", patchNamedCode);
qrCodesRouter.get("/api/admin/qr-codes/named/:id/image", getNamedCodeImage);
qrCodesRouter.get("/q/:code", getNamedScan);
