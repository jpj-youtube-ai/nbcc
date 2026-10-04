import { Router, type NextFunction, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import { fundraisingIsOn, getFundraiser } from "../db/fundraisers";
import { findSession } from "../db/fundraiser-sign-in";
import { askToPrint, lastPrintAsks, materialScans, PrintAskError } from "../db/fundraiser-materials";
import { listRequestRowsFor } from "../db/fundraising-requests";
import { SESSION_COOKIE, hashSessionId, sentFromOurOwnPage } from "../fundraising/sign-in";
import { siteUrl } from "../fundraising/send";
import { pageUrlFor } from "../fundraising/page-url";
import { readCookie } from "../ball/gate";
import { dateParts } from "../events/render";
import { londonToday } from "../events/model";
import { createRateLimiter } from "../portal/request-limiter";
import type { FundraiserRecord, Meter } from "../fundraising/model";
import { materialScanCounts, parseShortCode, scanTarget, trackedPath } from "../fundraising/material-codes";
import { printAskSchema, printStatus, type PrintStatus } from "../fundraising/print-requests";
import { parseWants, type RequestRow } from "../fundraising/requests";
import {
  MATERIALS,
  QR_SHEET,
  materialAllowed,
  materialAssets,
  materialFacts,
  materialsMessagePage,
  renderCertificate,
  renderEverything,
  renderPoster,
  renderQrSheet,
  renderSocial,
  renderSponsorForm,
  socialScript,
  type MaterialPiece,
} from "../fundraising/materials";

// TASK-504: a fundraiser's materials (src/fundraising/materials.ts), for the two people who may
// have them.
//
//   GET /api/fundraise/manage/fundraisers/:id/materials/:piece   the signed in organiser, their own
//   GET /api/admin/fundraisers/:id/materials/:piece              staff with fundraising: view
//
// :piece is poster, poster-a3, leaflet (TASK-512), social, sponsor-form or certificate. Each answer
// is a whole HTML page. Staff also have `everything` (TASK-512): every printed piece on one page.
// Both also have qr-code: the page's QR code on one A4 page to print, for one that has a page.
//
// The organiser's address sits under /api/fundraise/manage because that is where their session
// cookie goes (src/fundraising/sign-in.ts scopes it there), so a plain link from the private area
// carries it. Their rules, as for the rest of the private area (src/routes/fundraise.ts):
// fundraising switched off is a 404; no session asks them to sign in again; anyone else's
// fundraiser, a sign up that is not approved, and a certificate before the fundraiser is finished
// all read as not there.
//
// Staff use their bearer session like every admin call: the admin fetches the page and shows it in
// its own tab. Staff see any approved or finished fundraiser's pieces whether or not fundraising is
// switched on, and the certificate as a marked preview before it is finished.
//
// Every piece is drawn from the stored record, which is the APPROVED version: a change an organiser
// has asked for waits in fundraiser_edits and is never read here. Never kept, never indexed, and
// never handed to another website as a referrer.
//
// TASK-512, round two, also here:
//
//   GET  /q/:code                                               a printed piece's own QR code
//   GET  /api/admin/fundraisers/:id/scans                       its scans per printed piece (staff, view)
//   POST /api/fundraise/manage/fundraisers/:id/print-request    "Ask us to print these" (the organiser)
//
// /q/<id>-<size> (src/fundraising/material-codes.ts) answers with a 302 to wherever the fundraiser
// is now, found by its id, so it keeps working for good, whatever its page's address becomes. Never
// kept by a browser, so a change of address is followed at once. Anything that is not one of ours,
// or a fundraiser with nowhere to show, falls through to the site's own 404 page. The scan is counted
// by the visit counter on the page it lands on (the utm tags the link adds), as every QR code is.

export const fundraiseMaterialsRouter = Router();

type Who = "organiser" | "staff";
type Loaded = FundraiserRecord & { meter: Meter };

function privatePage(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function html(res: Response, status: number, body: string): Response {
  return res.status(status).type("html").send(body);
}

const notThere = (res: Response) =>
  html(res, 404, materialsMessagePage("Not found", "We could not find that. It may not be ready yet.", { href: "/fundraise/manage", text: "Go to your fundraising area" }));

type Piece = MaterialPiece | "everything" | typeof QR_SHEET;

/** One of the pieces; the QR code to print; `everything` too, for staff. */
function pieceOf(raw: unknown, who: Who): Piece | null {
  if (who === "staff" && raw === "everything") return "everything";
  if (raw === QR_SHEET) return QR_SHEET;
  return (MATERIALS as readonly string[]).includes(String(raw)) ? (raw as MaterialPiece) : null;
}

function idOf(raw: unknown): number | null {
  const s = String(raw ?? "");
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  const id = Number(s);
  return id <= 2147483647 ? id : null;
}

/** "12 December 2026", today in the UK: the date on a certificate. */
function todayInWords(now: Date): string {
  const p = dateParts(londonToday(now));
  return `${p.day} ${p.month} ${p.year}`;
}

/** Draw one piece of one fundraiser. */
export function buildMaterial(piece: MaterialPiece | "everything", f: Loaded, who: Who, now?: Date): string;
/** The QR code to print is null for one with no page of its own. */
export function buildMaterial(piece: Piece, f: Loaded, who: Who, now?: Date): string | null;
export function buildMaterial(piece: Piece, f: Loaded, who: Who, now: Date = new Date()): string | null {
  // Event pages: an event's pieces carry its own page, /event/<short name>.
  const facts = materialFacts(f, f.meter, { pageUrl: pageUrlFor(f), getInvolvedUrl: siteUrl("/get-involved") });
  const assets = materialAssets();
  switch (piece) {
    case "poster":
      return renderPoster(facts, assets, "a4");
    case "poster-a3":
      return renderPoster(facts, assets, "a3");
    case "leaflet":
      return renderPoster(facts, assets, "a5");
    case "social":
      return renderSocial(facts, assets, socialScript());
    case "sponsor-form":
      return renderSponsorForm(facts, assets);
    case "certificate":
      return renderCertificate(facts, assets, { date: todayInWords(now), preview: who === "staff" && f.status !== "finished" });
    case "everything":
      return renderEverything(facts, assets, { date: todayInWords(now), script: socialScript() });
    case QR_SHEET:
      return renderQrSheet(facts, assets);
  }
}

/** The signed in organiser's email, from their session cookie, or null. */
async function organiserEmail(req: Request): Promise<string | null> {
  const raw = readCookie(req.headers.cookie, SESSION_COOKIE);
  const sessionId = raw && raw.length <= 100 && /^[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
  const session = sessionId ? await findSession(hashSessionId(sessionId)) : null;
  return session ? session.email.trim().toLowerCase() : null;
}

export async function getOrganiserMaterial(req: Request, res: Response): Promise<Response> {
  privatePage(res);
  try {
    if (!(await fundraisingIsOn())) return notThere(res);
    const piece = pieceOf(req.params.piece, "organiser");
    const id = idOf(req.params.id);
    if (!piece || piece === "everything" || !id) return notThere(res);
    const email = await organiserEmail(req);
    if (!email) {
      return html(
        res,
        401,
        materialsMessagePage("Please sign in again", "For your privacy, your fundraising area signs you out after a while. Sign in again with a code we email you, then open this from there.", {
          href: "/fundraise/manage",
          text: "Sign in to your fundraising area",
        }),
      );
    }
    const f = await getFundraiser(id);
    if (!f || f.email.trim().toLowerCase() !== email) return notThere(res);
    // The QR code to print follows the poster's rule, and needs a page to scan to.
    if (!materialAllowed(piece === QR_SHEET ? "poster" : piece, f.status, "organiser")) return notThere(res);
    const page = buildMaterial(piece, f, "organiser");
    return page ? html(res, 200, page) : notThere(res);
  } catch (err) {
    console.error("fundraising materials failed:", err instanceof Error ? err.message : err);
    return html(res, 500, materialsMessagePage("Sorry, something went wrong", "We could not make that just now. Please try again in a few minutes."));
  }
}

export async function getStaffMaterial(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  privatePage(res);
  try {
    const piece = pieceOf(req.params.piece, "staff");
    const id = idOf(req.params.id);
    if (!piece || !id) return notThere(res);
    const f = await getFundraiser(id);
    // Everything follows the poster's rule: approved or finished. The certificate inside it only
    // once finished (renderEverything).
    if (!f || !materialAllowed(piece === "everything" || piece === QR_SHEET ? "poster" : piece, f.status, "staff")) return notThere(res);
    const page = buildMaterial(piece, f, "staff");
    return page ? html(res, 200, page) : notThere(res);
  } catch (err) {
    console.error("admin fundraising materials failed:", err instanceof Error ? err.message : err);
    return html(res, 500, materialsMessagePage("Sorry, something went wrong", "That could not be made just now. Please try again."));
  }
}

// --- a printed piece's own QR code (TASK-512) ---------------------------------------------------------

export async function getShortLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = parseShortCode(req.params.code);
    if (!parsed || !(await fundraisingIsOn())) return next();
    const f = await getFundraiser(parsed.id);
    const target = f ? scanTarget(f, parsed.code) : null;
    if (!target) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.redirect(302, target);
  } catch (err) {
    console.error("fundraising short link failed:", err instanceof Error ? err.message : err);
    next();
  }
}

// --- scans per printed piece, for staff (TASK-512) -------------------------------------------------

export async function getMaterialScans(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const id = idOf(req.params.id);
    const f = id ? await getFundraiser(id) : null;
    if (!id || !f) return res.status(404).json({ error: "Not found" });
    const scans = materialScanCounts(id, await materialScans(id)).map((s) => ({ ...s, link: siteUrl(trackedPath(id, s.piece)) }));
    return res.status(200).json({ scans, total: scans.reduce((n, s) => n + s.scans, 0) });
  } catch (err) {
    console.error("admin fundraising scans failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "The scans could not load just now." });
  }
}

// --- "Ask us to print these", for the organiser (TASK-512) --------------------------------------------

// 10 asks an hour for one signed in organiser: room to change their mind, never a flood. Not lifted
// for requests from the box itself: nothing in the BDD suite asks more than a couple of times.
const printAskLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60_000 });

/** Where their posters and leaflets are up to, for their private area. Best effort: null on a failure. */
export async function printStatusFor(
  f: FundraiserRecord,
  today: string,
  read: Promise<RequestRow[]> = listRequestRowsFor(f.id),
): Promise<PrintStatus | null> {
  try {
    const [rows, last] = await Promise.all([read, lastPrintAsks(f.id)]);
    // As stored, old keys and odd values read as none (parseWants), as the requests read them.
    return printStatus({ ...f, wants: parseWants(f.wants) }, rows, last, today);
  } catch (err) {
    console.error("fundraise print status read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

type Headers = Record<string, string | string[] | undefined>;
const header = (req: Request, name: string): string | undefined => {
  const v = (req.headers as Headers)[name];
  return Array.isArray(v) ? v[0] : v;
};

function fieldErrors(issues: { path: (string | number)[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export async function postPrintRequest(req: Request, res: Response): Promise<Response> {
  res.setHeader("Cache-Control", "no-store");
  if (!sentFromOurOwnPage({ secFetchSite: header(req, "sec-fetch-site"), origin: header(req, "origin") }, header(req, "host") ?? "")) {
    return res.status(403).json({ error: "Please use the form on our website." });
  }
  try {
    if (!(await fundraisingIsOn())) return res.status(404).json({ error: "Not found" });
    const email = await organiserEmail(req);
    if (!email) return res.status(401).json({ error: "Please sign in again." });
    const id = idOf(req.params.id);
    const f = id ? await getFundraiser(id) : null;
    if (!id || !f || f.email.trim().toLowerCase() !== email) return res.status(404).json({ error: "Not found" });
    if (!printAskLimiter.allow(email, Date.now())) {
      return res.status(429).json({ error: "You have asked a lot of times just now. Please wait a while, or give us a call on 01292 811 015." });
    }
    const parsed = printAskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Please check how many you would like.", fields: fieldErrors(parsed.error.issues) });
    const today = londonToday(new Date());
    // Recorded as every other organiser action is: "organiser", the fundraiser says who.
    await askToPrint(id, parsed.data, "organiser", today);
    const fresh = (await getFundraiser(id)) ?? f;
    return res.status(200).json({ status: "asked", print: await printStatusFor(fresh, today) });
  } catch (err) {
    if (err instanceof PrintAskError) return res.status(409).json({ error: err.message });
    console.error("fundraise print request failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not take that just now. Please try again in a few minutes." });
  }
}

fundraiseMaterialsRouter.get("/api/fundraise/manage/fundraisers/:id/materials/:piece", getOrganiserMaterial);
fundraiseMaterialsRouter.get("/api/admin/fundraisers/:id/materials/:piece", getStaffMaterial);
fundraiseMaterialsRouter.get("/api/admin/fundraisers/:id/scans", getMaterialScans);
fundraiseMaterialsRouter.post("/api/fundraise/manage/fundraisers/:id/print-request", postPrintRequest);
fundraiseMaterialsRouter.get("/q/:code", getShortLink);
