import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import type { AdminSessionClaims } from "../admin/session";
import { fromOurOwnPage, ownFundraiser, signedIn } from "./fundraise";
import { createRateLimiter } from "../portal/request-limiter";
import { fundraisingIsOn, getFundraiser, listForOrganiser } from "../db/fundraisers";
import {
  countSentToday,
  decidePicture,
  deletePicture,
  listPictures,
  pendingPicturesByFundraiser,
  pictureForOwner,
  pictureForStaff,
  publicProfilePhoto,
  sendPicture,
  PictureError,
  type PictureDecision,
} from "../db/fundraiser-pictures";
import {
  canSendPictures,
  checkPictureUpload,
  decodeBase64,
  organiserPictureView,
  pictureLimitReached,
  pictureStatusWords,
  pictureUploadSchema,
  profilePhotoAllowed,
  type PictureRow,
} from "../fundraising/pictures";
import { processPicture } from "../fundraising/picture-process";
import { shortName } from "../fundraising/model";
import { isInMemory } from "../fundraising/in-memory";

// Profile pictures (Jaimie, 2026-10-03): the page's main photo and the organiser's round profile
// photo, sent from the private area, checked by staff. The rules are in src/fundraising/pictures.ts,
// the processing in src/fundraising/picture-process.ts and the SQL in src/db/fundraiser-pictures.ts.
//
// The organiser, in their private area (signed in with the emailed code; the session, ownership and
// same origin checks are src/routes/fundraise.ts's, as news updates use them):
//   GET  /api/fundraise/manage/pictures                     their fundraisers, each with its pictures
//   POST /api/fundraise/manage/fundraisers/:id/pictures     { kind, mime, dataBase64 }: it waits
//   GET  /api/fundraise/manage/pictures/:pictureId/photo    their own picture, whatever its status
//
// The public:
//   GET  /media/fundraiser-profile/:photoId                 a profile photo, only once approved
//   (an approved main photo becomes the page's photo at /media/events/:id, like a staff upload)
//
// Staff, Admin > Fundraising (section "fundraising": view to look, edit to decide):
//   GET  /api/admin/fundraising/pictures-waiting                 how many wait on each sign up  view
//   GET  /api/admin/fundraisers/:id/pictures                     a sign up's pictures           view
//   GET  /api/admin/fundraisers/:id/pictures/:pictureId/photo    a picture, waiting included    view
//   POST /api/admin/fundraisers/:id/pictures/:pictureId/approve|decline|remove  { reason? }      edit
//   POST /api/admin/fundraisers/:id/pictures/:pictureId/delete   delete for good          admin only
//
// What keeps a waiting picture private: it has no public address until it is approved (the public
// route asks the database for an approved profile photo only, on a page that is up, while fundraising
// is on); the organiser's copy is behind their session and their own email; staff's behind the
// admin's bearer token. Every picture is served with its type and nosniff. Each is made again on the
// server before it is stored, so nothing from the camera is kept. The body parser for the post allows
// a little over 2 MB of picture as base64, and is only reached with a session cookie the shape of one
// of ours (newsBodyGuard in src/routes/fundraiser-news.ts, mounted in src/app.ts).
//
// The one 512 MB task is protected before a picture is opened: every try is counted (20 a session and
// 60 an address in any 24 hours, failed ones too), then the database says whether ten were sent today;
// only a JPEG is taken (the private area always sends one); and the processing makes one picture at a
// time with a few waiting, answering 503 past that (src/fundraising/picture-process.ts).

export const fundraiserPicturesRouter = Router();

export const PICTURE_POST_PATH = "/api/fundraise/manage/fundraisers/:id/pictures";
/** 2 MB of picture is about 2.7 MB as base64. */
export const PICTURE_JSON_BODY_LIMIT = "4mb";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOOK_AGAIN = "Your picture needs another look";
const PHOTO_TYPE = "That picture is not one we can use. Try a JPG, PNG or WebP photo.";
const PHOTO_SIZE = "That picture is too big. Try a smaller one.";
const PHOTO_READ = "We could not open that picture. Please try a different photo.";
const NOT_RUNNING = { error: "Pictures are for a fundraiser that is running with its own page. To change yours, email events@nbcc.scot." };
const LIMIT = { error: "You have sent 10 pictures in the last day. Please try again tomorrow." };
const TRY_LATER = { error: "We could not send your picture just now. Please try again in a few minutes." };
const TOO_MANY_TRIES = { error: "You have tried to send a lot of photos today. Please try again tomorrow." };
const BUSY = { error: "Lots of photos arriving just now. Please try again in a minute." };
const MEMORY_NO_ROUND = { error: "A page in memory of someone shows their photo, not a round photo of the organiser." };

// Every try, before anything is opened: per signed in session and per address, in any 24 hours.
const DAY_MS = 24 * 60 * 60 * 1000;
let sessionTries = createRateLimiter({ max: 20, windowMs: DAY_MS });
let addressTries = createRateLimiter({ max: 60, windowMs: DAY_MS });
/** For tests: a fresh count. */
export function pictureLimitersReset(): void {
  sessionTries = createRateLimiter({ max: 20, windowMs: DAY_MS });
  addressTries = createRateLimiter({ max: 60, windowMs: DAY_MS });
}
const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

function positiveId(value: unknown): number | null {
  const s = String(value ?? "");
  if (!/^[1-9]\d{0,9}$/.test(s)) return null;
  const n = Number(s);
  return n <= 2147483647 ? n : null;
}

function sendBytes(res: Response, photo: { mime: string; bytes: Buffer }, cache: string): Response {
  res.setHeader("Content-Type", photo.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", cache);
  return res.send(photo.bytes);
}

// --- the organiser --------------------------------------------------------------------------------

/** A picture as its organiser sees it: never who decided. The note is only on one not used. */
function forOrganiser(p: PictureRow) {
  return {
    id: p.id,
    kind: p.kind,
    status: p.status,
    statusWords: pictureStatusWords(p.status),
    createdAt: p.createdAt,
    photoUrl: p.hasPhoto ? `/api/fundraise/manage/pictures/${p.id}/photo` : null,
    note: p.status === "declined" ? p.declineReason : null,
  };
}

function viewFor(rows: PictureRow[], kind: "main" | "profile") {
  const v = organiserPictureView(rows, kind);
  return { inUse: v.inUse ? forOrganiser(v.inUse) : null, latest: v.latest ? forOrganiser(v.latest) : null };
}

export async function getOrganiserPictures(req: Request, res: Response): Promise<Response | void> {
  try {
    const s = await signedIn(req, res);
    if (!s) return;
    const mine = await listForOrganiser(s.email);
    const rows = await listPictures(mine.map((f) => f.id));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      fundraisers: mine.map((f) => {
        const own = rows.filter((p) => p.fundraiserId === f.id);
        return {
          id: f.id,
          canSend: canSendPictures(f),
          profileAllowed: profilePhotoAllowed(f),
          // In memory of someone: the main photo is of the person remembered, and worded so.
          inMemory: isInMemory(f),
          // As their page names them, for the preview: "Organised by Robin O.".
          name: shortName(f.name),
          title: f.title,
          path: f.path,
          isTeam: Boolean(f.isTeam),
          // A team, or a member page still on its team: the round photo shows on the team's page too.
          inTeam: Boolean(f.isTeam || (f.teamId && !f.teamLeftAt)),
          // The photo on their page now (public already), for the preview.
          pageImageSrc: f.imageSrc ?? null,
          main: viewFor(own, "main"),
          profile: viewFor(own, "profile"),
        };
      }),
    });
  } catch (err) {
    console.error("fundraiser pictures read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "This is temporarily unavailable" });
  }
}

export async function postOrganiserPicture(req: Request, res: Response): Promise<Response | void> {
  try {
    if (!fromOurOwnPage(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    const s = await signedIn(req, res);
    if (!s) return;
    const f = await ownFundraiser(req, res, s);
    if (!f) return;
    if (!canSendPictures(f)) return res.status(410).json(NOT_RUNNING);
    const parsed = pictureUploadSchema.safeParse(req.body ?? {});
    if (parsed.success && parsed.data.kind === "profile" && !profilePhotoAllowed(f)) return res.status(410).json(NOT_RUNNING);
    // Counted before anything is opened, failed tries too.
    const now = Date.now();
    const tries = [sessionTries.allow(s.sessionHash, now), addressTries.allow(req.ip ?? "unknown", now)];
    if (!tries.every(Boolean)) return res.status(429).json(TOO_MANY_TRIES);
    if (pictureLimitReached(await countSentToday(f.id))) return res.status(429).json(LIMIT);
    if (!parsed.success) return res.status(400).json({ error: LOOK_AGAIN, fields: { photo: PHOTO_TYPE } });
    const bytes = decodeBase64(parsed.data.dataBase64);
    const check = checkPictureUpload(parsed.data.mime, bytes);
    if (!check.ok || check.mime !== "image/jpeg") {
      const size = !check.ok && check.reason === "size";
      return res.status(size ? 413 : 400).json({ error: LOOK_AGAIN, fields: { photo: size ? PHOTO_SIZE : PHOTO_TYPE } });
    }
    const made = await processPicture(parsed.data.kind, bytes);
    if (!made.ok && made.reason === "busy") return res.status(503).json(BUSY);
    if (!made.ok && made.reason === "size") return res.status(413).json({ error: LOOK_AGAIN, fields: { photo: PHOTO_SIZE } });
    if (!made.ok) return res.status(400).json({ error: LOOK_AGAIN, fields: { photo: PHOTO_READ } });
    const out = await sendPicture(f.id, s.email, parsed.data.kind, { mime: made.mime, bytes: made.bytes, width: made.width, height: made.height });
    if (out.verdict === "limit") return res.status(429).json(LIMIT);
    return res.status(202).json({ status: "waiting", picture: forOrganiser(out.picture) });
  } catch (err) {
    if (err instanceof PictureError && err.reason === "not_found") return res.status(404).json({ error: "Not found" });
    if (err instanceof PictureError && err.reason === "bad_status") return res.status(410).json(NOT_RUNNING);
    console.error("fundraiser picture send failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(TRY_LATER);
  }
}

export async function getOrganiserPicturePhoto(req: Request, res: Response): Promise<Response | void> {
  try {
    const s = await signedIn(req, res);
    if (!s) return;
    const id = positiveId(req.params.pictureId);
    const photo = id ? await pictureForOwner(id, s.email) : null;
    if (!photo) return res.status(404).json({ error: "Not found" });
    return sendBytes(res, photo, "private, no-store");
  } catch (err) {
    console.error("fundraiser picture photo failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "This is temporarily unavailable" });
  }
}

// --- the public -------------------------------------------------------------------------------------

export async function getPublicProfilePhoto(req: Request, res: Response): Promise<Response | void> {
  const id = String(req.params.photoId ?? "");
  if (!UUID_RE.test(id)) return res.status(404).type("text/plain").send("Not found");
  try {
    if (!(await fundraisingIsOn())) return res.status(404).type("text/plain").send("Not found");
    const photo = await publicProfilePhoto(id);
    if (!photo) return res.status(404).type("text/plain").send("Not found");
    // Short: once staff take a photo off, it stops being served within minutes.
    return sendBytes(res, photo, "public, max-age=300");
  } catch (err) {
    console.error("fundraiser profile photo failed:", err instanceof Error ? err.message : err);
    return res.status(500).type("text/plain").send("Error");
  }
}

// --- staff --------------------------------------------------------------------------------------------

function forStaff(fundraiserId: number, p: PictureRow) {
  return {
    ...forOrganiser(p),
    note: p.declineReason,
    width: p.width,
    height: p.height,
    decidedAt: p.decidedAt,
    decidedBy: p.decidedBy,
    photoUrl: p.hasPhoto ? `/api/admin/fundraisers/${fundraiserId}/pictures/${p.id}/photo` : null,
  };
}

// Who did it, in the audit log: exactly as actorOf in ./admin writes it (not imported from there, as
// that module loads the Stripe client and all the admin routes with it).
const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;

export async function getPicturesWaiting(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    return res.status(200).json({ counts: await pendingPicturesByFundraiser() });
  } catch (err) {
    console.error("admin fundraiser pictures count failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function getAdminPictures(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const [rows, f] = await Promise.all([listPictures([id]), getFundraiser(id)]);
    return res.status(200).json({
      pictures: rows.map((p) => forStaff(id, p)),
      // For the preview: the page's title and the name it shows ("Organised by Robin O.").
      title: f?.title ?? null,
      organisedBy: f ? shortName(f.name) : null,
    });
  } catch (err) {
    console.error("admin fundraiser pictures read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function getAdminPicturePhoto(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  const id = positiveId(req.params.id);
  const pictureId = positiveId(req.params.pictureId);
  if (!id || !pictureId) return res.status(400).json({ error: "Invalid id" });
  try {
    const photo = await pictureForStaff(id, pictureId);
    if (!photo) return res.status(404).json({ error: "That no longer exists" });
    return sendBytes(res, photo, "private, no-store");
  } catch (err) {
    console.error("admin fundraiser picture photo failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

function decision(which: PictureDecision) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    const claims = await authorizeSection(req, res, "fundraising", "edit");
    if (!claims) return;
    const id = positiveId(req.params.id);
    const pictureId = positiveId(req.params.pictureId);
    if (!id || !pictureId) return res.status(400).json({ error: "Invalid id" });
    let reason: string | null = null;
    if (which === "decline") {
      const parsed = reasonSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "Keep the note to 500 characters or fewer" });
      reason = parsed.data.reason ? parsed.data.reason : null;
    }
    try {
      const picture = await decidePicture(id, pictureId, which, actorOf(claims), { reason, adminId: claims.sub });
      return res.status(200).json({ picture: forStaff(id, picture) });
    } catch (err) {
      if (err instanceof PictureError && err.reason === "not_found") return res.status(404).json({ error: "That no longer exists" });
      if (err instanceof PictureError && err.reason === "not_allowed") return res.status(409).json(MEMORY_NO_ROUND);
      if (err instanceof PictureError) return res.status(409).json({ error: "That picture has already been dealt with. Look again." });
      console.error(`admin fundraiser picture ${which} failed:`, err instanceof Error ? err.message : err);
      return res.status(500).json(UNAVAILABLE);
    }
  };
}

/** An admin deletes a picture for good: the row, its bytes and any copy on the page. Audited. */
export async function postDeletePicture(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const id = positiveId(req.params.id);
  const pictureId = positiveId(req.params.pictureId);
  if (!id || !pictureId) return res.status(400).json({ error: "Invalid id" });
  try {
    await deletePicture(id, pictureId, actorOf(claims));
    return res.status(200).json({ deleted: true });
  } catch (err) {
    if (err instanceof PictureError && err.reason === "not_found") return res.status(404).json({ error: "That no longer exists" });
    console.error("admin fundraiser picture delete failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export const postApprovePicture = decision("approve");
export const postDeclinePicture = decision("decline");
export const postRemovePicture = decision("remove");

fundraiserPicturesRouter.get("/api/fundraise/manage/pictures", getOrganiserPictures);
fundraiserPicturesRouter.post(PICTURE_POST_PATH, postOrganiserPicture);
fundraiserPicturesRouter.get("/api/fundraise/manage/pictures/:pictureId/photo", getOrganiserPicturePhoto);
fundraiserPicturesRouter.get("/media/fundraiser-profile/:photoId", getPublicProfilePhoto);
fundraiserPicturesRouter.get("/api/admin/fundraising/pictures-waiting", getPicturesWaiting);
fundraiserPicturesRouter.get("/api/admin/fundraisers/:id/pictures", getAdminPictures);
fundraiserPicturesRouter.get("/api/admin/fundraisers/:id/pictures/:pictureId/photo", getAdminPicturePhoto);
fundraiserPicturesRouter.post("/api/admin/fundraisers/:id/pictures/:pictureId/approve", postApprovePicture);
fundraiserPicturesRouter.post("/api/admin/fundraisers/:id/pictures/:pictureId/decline", postDeclinePicture);
fundraiserPicturesRouter.post("/api/admin/fundraisers/:id/pictures/:pictureId/remove", postRemovePicture);
fundraiserPicturesRouter.post("/api/admin/fundraisers/:id/pictures/:pictureId/delete", postDeletePicture);
