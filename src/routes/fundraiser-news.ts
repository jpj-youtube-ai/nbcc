import { Router, type NextFunction, type Request, type Response } from "express";
import { z, type ZodIssue } from "zod";
import { authorizeSection } from "./admin-authz";
import type { AdminSessionClaims } from "../admin/session";
import { fromOurOwnPage, ownFundraiser, signedIn } from "./fundraise";
import { readCookie } from "../ball/gate";
import { SESSION_COOKIE } from "../fundraising/sign-in";
import { canPostNews, checkNewsPhoto, newsPostSchema, newsStatusWords, type NewsRow } from "../fundraising/news";
import { fundraisingIsOn, getFundraiser, listForOrganiser } from "../db/fundraisers";
import {
  decideUpdate,
  listUpdates,
  pendingByFundraiser,
  photoForOwner,
  photoForStaff,
  postUpdate,
  publicPhoto,
  NewsError,
  type NewsDecision,
} from "../db/fundraiser-updates";
import { sendNewsDecisionEmail } from "../fundraising/send";

// TASK-506: news updates on a fundraiser's page. The rules are in src/fundraising/news.ts and the SQL
// in src/db/fundraiser-updates.ts.
//
// The organiser, in their private area (signed in with the emailed code, as in src/routes/fundraise.ts,
// whose session, ownership and same origin checks these reuse; the session cookie is scoped to
// /api/fundraise/manage, so everything of theirs lives under it):
//   GET  /api/fundraise/manage/news                       their fundraisers, each with its updates
//   POST /api/fundraise/manage/fundraisers/:id/news       { text, photo?: { mime, dataBase64 } }: waits
//   GET  /api/fundraise/manage/news/:updateId/photo       their own photo, whatever its status
//
// The public:
//   GET  /media/fundraiser-news/:photoId                  a photo, only once its update is approved
//
// Staff, Admin > Fundraising (section "fundraising": view to look, edit to decide):
//   GET  /api/admin/fundraising/news-waiting              how many wait on each sign up      view
//   GET  /api/admin/fundraisers/:id/news                  a sign up's updates                view
//   GET  /api/admin/fundraisers/:id/news/:updateId/photo  a photo, waiting ones included     view
//   POST /api/admin/fundraisers/:id/news/:updateId/approve|reject|hide|show  { reason? }      edit
//
// What keeps a waiting photo private: it has no public address until it is approved (the public
// route asks the database for an approved update only, on a page that is up, while fundraising is
// on); the organiser's copy is behind their session and their own email; staff's behind the admin's
// bearer token. Every photo is served with its checked type and nosniff, so it can only ever be read
// as the picture it is. A photo arrives shrunk in the browser first, like a staff upload; the body
// parser for the post allows a little over 2 MB of picture as base64, and is only reached with a
// session cookie (newsBodyGuard), so nobody else can make the server read a big body.
//
// Approving or not using an update emails the organiser ("Your news update is live", "About your
// news update"), after the decision has committed, best effort. Hiding one does not. Request and
// response shapes: README.md, "Fundraiser pages: countdown and news (TASK-506)".

export const fundraiserNewsRouter = Router();

export const NEWS_POST_PATH = "/api/fundraise/manage/fundraisers/:id/news";
/** 2 MB of picture is about 2.7 MB as base64, with the words on top. */
export const NEWS_JSON_BODY_LIMIT = "4mb";

/**
 * Before the bigger body parser on the post: no session cookie, no reading the body. The session
 * itself is checked properly by the route.
 */
export function newsBodyGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "POST") return next();
  const id = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!id) {
    res.status(401).json({ error: "Please sign in again." });
    return;
  }
  next();
}

function fieldErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function positiveId(value: unknown): number | null {
  const s = String(value ?? "");
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  const n = Number(s);
  return n <= 2147483647 ? n : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const PHOTO_TYPE = "That photo is not one we can use. Try a JPG or PNG.";
const PHOTO_SIZE = "That photo is too big. Try a smaller one.";
const NOT_RUNNING = { error: "News updates are for a fundraiser that is running with its own page. To share news, email events@nbcc.scot." };
const LIMIT = { error: "You have posted 5 updates in the last day. Please try again tomorrow." };
const TRY_LATER = { error: "We could not send your update just now. Please try again in a few minutes." };

function sendPhoto(res: Response, photo: { mime: string; bytes: Buffer }, cache: string): Response {
  res.setHeader("Content-Type", photo.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", cache);
  return res.send(photo.bytes);
}

// --- the organiser --------------------------------------------------------------------------------

/** An update as its organiser sees it: never the internal reason, or who decided. */
function forOrganiser(u: NewsRow) {
  return {
    id: u.id,
    text: u.text,
    status: u.status,
    statusWords: newsStatusWords(u.status),
    createdAt: u.createdAt,
    photoUrl: u.photoId ? `/api/fundraise/manage/news/${u.id}/photo` : null,
  };
}

export async function getOrganiserNews(req: Request, res: Response): Promise<Response | void> {
  try {
    const s = await signedIn(req, res);
    if (!s) return;
    const mine = await listForOrganiser(s.email);
    const rows = await listUpdates(mine.map((f) => f.id));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      fundraisers: mine.map((f) => ({
        id: f.id,
        canPost: canPostNews(f),
        updates: rows.filter((u) => u.fundraiserId === f.id).map(forOrganiser),
      })),
    });
  } catch (err) {
    console.error("fundraiser news read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "This is temporarily unavailable" });
  }
}

export async function postOrganiserNews(req: Request, res: Response): Promise<Response | void> {
  try {
    if (!fromOurOwnPage(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    const s = await signedIn(req, res);
    if (!s) return;
    const f = await ownFundraiser(req, res, s);
    if (!f) return;
    if (!canPostNews(f)) return res.status(410).json(NOT_RUNNING);
    const parsed = newsPostSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Your update needs another look", fields: fieldErrors(parsed.error.issues) });
    }
    let photo: { mime: "image/jpeg" | "image/png" | "image/webp"; bytes: Buffer } | null = null;
    if (parsed.data.photo) {
      const b64 = parsed.data.photo.dataBase64.replace(/\s+/g, "");
      const bytes = BASE64_RE.test(b64) ? Buffer.from(b64, "base64") : Buffer.alloc(0);
      const check = checkNewsPhoto(parsed.data.photo.mime, bytes);
      if (!check.ok) {
        const size = check.reason === "size";
        return res.status(size ? 413 : 400).json({ error: "Your update needs another look", fields: { photo: size ? PHOTO_SIZE : PHOTO_TYPE } });
      }
      photo = { mime: check.mime, bytes };
    }
    const out = await postUpdate(f.id, s.email, { text: parsed.data.text, photo });
    if (out.verdict === "limit") return res.status(429).json(LIMIT);
    return res.status(202).json({ status: "waiting", update: forOrganiser(out.update) });
  } catch (err) {
    if (err instanceof NewsError && err.reason === "not_found") return res.status(404).json({ error: "Not found" });
    if (err instanceof NewsError && err.reason === "bad_status") return res.status(410).json(NOT_RUNNING);
    console.error("fundraiser news post failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(TRY_LATER);
  }
}

export async function getOrganiserNewsPhoto(req: Request, res: Response): Promise<Response | void> {
  try {
    const s = await signedIn(req, res);
    if (!s) return;
    const id = positiveId(req.params.updateId);
    const photo = id ? await photoForOwner(id, s.email) : null;
    if (!photo) return res.status(404).json({ error: "Not found" });
    return sendPhoto(res, photo, "private, no-store");
  } catch (err) {
    console.error("fundraiser news photo failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "This is temporarily unavailable" });
  }
}

// --- the public -------------------------------------------------------------------------------------

export async function getPublicNewsPhoto(req: Request, res: Response): Promise<Response | void> {
  const id = String(req.params.photoId ?? "");
  if (!UUID_RE.test(id)) return res.status(404).type("text/plain").send("Not found");
  try {
    if (!(await fundraisingIsOn())) return res.status(404).type("text/plain").send("Not found");
    const photo = await publicPhoto(id);
    if (!photo) return res.status(404).type("text/plain").send("Not found");
    // Short: once staff hide an update, its photo stops being served within minutes.
    return sendPhoto(res, photo, "public, max-age=300");
  } catch (err) {
    console.error("fundraiser news public photo failed:", err instanceof Error ? err.message : err);
    return res.status(500).type("text/plain").send("Error");
  }
}

// --- staff --------------------------------------------------------------------------------------------

function forStaff(fundraiserId: number, u: NewsRow) {
  return {
    ...forOrganiser(u),
    decidedAt: u.decidedAt,
    decidedBy: u.decidedBy,
    rejectReason: u.rejectReason,
    photoUrl: u.photoId ? `/api/admin/fundraisers/${fundraiserId}/news/${u.id}/photo` : null,
  };
}

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

// Who did it, in the audit log: exactly as actorOf in ./admin writes it. Not imported from there, as
// that module loads the Stripe client and all the admin routes with it.
const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;

export async function getNewsWaiting(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    return res.status(200).json({ counts: await pendingByFundraiser() });
  } catch (err) {
    console.error("admin fundraiser news count failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function getAdminNews(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    return res.status(200).json({ updates: (await listUpdates([id])).map((u) => forStaff(id, u)) });
  } catch (err) {
    console.error("admin fundraiser news read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function getAdminNewsPhoto(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const id = positiveId(req.params.id);
  const updateId = positiveId(req.params.updateId);
  if (!id || !updateId) return res.status(400).json({ error: "Invalid id" });
  try {
    const photo = await photoForStaff(id, updateId);
    if (!photo) return res.status(404).json({ error: "That no longer exists" });
    return sendPhoto(res, photo, "private, no-store");
  } catch (err) {
    console.error("admin fundraiser news photo failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

function decision(which: NewsDecision) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    const claims = await authorizeSection(req, res, "fundraising", "edit");
    if (!claims) return;
    const id = positiveId(req.params.id);
    const updateId = positiveId(req.params.updateId);
    if (!id || !updateId) return res.status(400).json({ error: "Invalid id" });
    let reason: string | null = null;
    if (which === "reject") {
      const parsed = reasonSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "Keep the reason to 500 characters or fewer" });
      reason = parsed.data.reason ? parsed.data.reason : null;
    }
    let update: NewsRow;
    try {
      update = await decideUpdate(id, updateId, which, actorOf(claims), reason);
    } catch (err) {
      if (err instanceof NewsError && err.reason === "not_found") return res.status(404).json({ error: "That no longer exists" });
      if (err instanceof NewsError) return res.status(409).json({ error: "That update has already been dealt with. Look again." });
      console.error(`admin fundraiser news ${which} failed:`, err instanceof Error ? err.message : err);
      return res.status(500).json(UNAVAILABLE);
    }
    // "Your news update is live" or "About your news update", after the decision has committed. Best
    // effort: the decision stands whether or not the email goes. Hiding or showing emails nobody.
    if (which === "approve" || which === "reject") {
      try {
        const f = await getFundraiser(id);
        if (f) await sendNewsDecisionEmail(f, which === "approve", await fundraisingIsOn());
      } catch (err) {
        console.error("admin fundraiser news email failed:", err instanceof Error ? err.message : err);
      }
    }
    return res.status(200).json({ update: forStaff(id, update) });
  };
}

export const postApproveNews = decision("approve");
export const postRejectNews = decision("reject");
export const postHideNews = decision("hide");
export const postShowNews = decision("show");

fundraiserNewsRouter.get("/api/fundraise/manage/news", getOrganiserNews);
fundraiserNewsRouter.post(NEWS_POST_PATH, postOrganiserNews);
fundraiserNewsRouter.get("/api/fundraise/manage/news/:updateId/photo", getOrganiserNewsPhoto);
fundraiserNewsRouter.get("/media/fundraiser-news/:photoId", getPublicNewsPhoto);
fundraiserNewsRouter.get("/api/admin/fundraising/news-waiting", getNewsWaiting);
fundraiserNewsRouter.get("/api/admin/fundraisers/:id/news", getAdminNews);
fundraiserNewsRouter.get("/api/admin/fundraisers/:id/news/:updateId/photo", getAdminNewsPhoto);
fundraiserNewsRouter.post("/api/admin/fundraisers/:id/news/:updateId/approve", postApproveNews);
fundraiserNewsRouter.post("/api/admin/fundraisers/:id/news/:updateId/reject", postRejectNews);
fundraiserNewsRouter.post("/api/admin/fundraisers/:id/news/:updateId/hide", postHideNews);
fundraiserNewsRouter.post("/api/admin/fundraisers/:id/news/:updateId/show", postShowNews);
