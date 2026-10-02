import { Router, type Request, type Response } from "express";
import { authorizeSection } from "./admin-authz";
import { fundraisingIsOn, getFundraiser } from "../db/fundraisers";
import { findSession } from "../db/fundraiser-sign-in";
import { SESSION_COOKIE, hashSessionId } from "../fundraising/sign-in";
import { fundraiserPageUrl, siteUrl } from "../fundraising/send";
import { readCookie } from "../ball/gate";
import { dateParts } from "../events/render";
import { londonToday } from "../events/model";
import type { FundraiserRecord, Meter } from "../fundraising/model";
import {
  MATERIALS,
  materialAllowed,
  materialAssets,
  materialFacts,
  materialsMessagePage,
  renderCertificate,
  renderPoster,
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
// :piece is poster, social, sponsor-form or certificate. Each answer is a whole HTML page.
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

function pieceOf(raw: unknown): MaterialPiece | null {
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
export function buildMaterial(piece: MaterialPiece, f: Loaded, who: Who, now: Date = new Date()): string {
  const facts = materialFacts(f, f.meter, { pageUrl: fundraiserPageUrl(f.slug), getInvolvedUrl: siteUrl("/get-involved") });
  const assets = materialAssets();
  switch (piece) {
    case "poster":
      return renderPoster(facts, assets);
    case "social":
      return renderSocial(facts, assets, socialScript());
    case "sponsor-form":
      return renderSponsorForm(facts, assets);
    case "certificate":
      return renderCertificate(facts, assets, { date: todayInWords(now), preview: who === "staff" && f.status !== "finished" });
  }
}

export async function getOrganiserMaterial(req: Request, res: Response): Promise<Response> {
  privatePage(res);
  try {
    if (!(await fundraisingIsOn())) return notThere(res);
    const piece = pieceOf(req.params.piece);
    const id = idOf(req.params.id);
    if (!piece || !id) return notThere(res);
    const raw = readCookie(req.headers.cookie, SESSION_COOKIE);
    const sessionId = raw && raw.length <= 100 && /^[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
    const session = sessionId ? await findSession(hashSessionId(sessionId)) : null;
    if (!session) {
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
    if (!f || f.email.trim().toLowerCase() !== session.email.trim().toLowerCase()) return notThere(res);
    if (!materialAllowed(piece, f.status, "organiser")) return notThere(res);
    return html(res, 200, buildMaterial(piece, f, "organiser"));
  } catch (err) {
    console.error("fundraising materials failed:", err instanceof Error ? err.message : err);
    return html(res, 500, materialsMessagePage("Sorry, something went wrong", "We could not make that just now. Please try again in a few minutes."));
  }
}

export async function getStaffMaterial(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  privatePage(res);
  try {
    const piece = pieceOf(req.params.piece);
    const id = idOf(req.params.id);
    if (!piece || !id) return notThere(res);
    const f = await getFundraiser(id);
    if (!f || !materialAllowed(piece, f.status, "staff")) return notThere(res);
    return html(res, 200, buildMaterial(piece, f, "staff"));
  } catch (err) {
    console.error("admin fundraising materials failed:", err instanceof Error ? err.message : err);
    return html(res, 500, materialsMessagePage("Sorry, something went wrong", "That could not be made just now. Please try again."));
  }
}

fundraiseMaterialsRouter.get("/api/fundraise/manage/fundraisers/:id/materials/:piece", getOrganiserMaterial);
fundraiseMaterialsRouter.get("/api/admin/fundraisers/:id/materials/:piece", getStaffMaterial);
