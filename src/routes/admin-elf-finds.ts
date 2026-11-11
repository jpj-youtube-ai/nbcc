import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import { can } from "../admin/permissions";
import { lastAlert } from "../db/elf-alerts";
import { decidePhoto, photoForStaff, photoLog, photoStep, photosWaiting, takeDownPhoto } from "../db/elf-photos";

// NBCC Elf Detective School in the admin, Head Elf HQ's Finds tab: the photo check and the photo log
// (docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md, "Head Elf HQ: the photo check"):
//
//   GET  /api/admin/elf/photos                 the photos waiting, the log, the last alert, and canEdit (elf: view)
//   GET  /api/admin/elf/photos/:id/picture     one photo's bytes, for a head elf's eyes only (view)
//   POST /api/admin/elf/photos/:id/approve     approve it (edit)
//   POST /api/admin/elf/photos/:id/decline     decline it, with a reason only head elves see (edit)
//   POST /api/admin/elf/photos/:id/take-down   take it down, with an optional reason (edit)
//
// Head elves see a family's full names here; nothing on these routes is ever shown to a family or the
// public, and an audit row never carries a place name or a photo. The screen is
// assets/js/admin/elf-hq.js. Unit tested in test/unit/admin-elf-finds.test.ts.

export const adminElfFindsRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const NO_PHOTO = { error: "That photo is not there." };
const BAD_REQUEST = { error: "That request could not be read." };
const SAY_WHY = { error: "Say why in a few words. Only head elves see it." };
const ALREADY = "Someone has already checked this photo.";
const LOG_LINES = 200;

const idOf = (req: Request): number | null => {
  const raw = String((req.params as Record<string, unknown> | undefined)?.id ?? "");
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
};

const reasonSchema = z.string().trim().min(1).max(200);
const declineSchema = z.object({ reason: reasonSchema }).strict();
const takeDownSchema = z.object({ reason: reasonSchema.optional() }).strict();

/** The photos waiting, the log and the last alert, in one answer. */
export async function getAdminElfPhotos(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "view");
  if (!claims) return;
  try {
    const [waiting, log, last, perms] = await Promise.all([
      photosWaiting(new Date()),
      photoLog(LOG_LINES),
      lastAlert("photo"),
      loadEffectivePermissions(claims.sub),
    ]);
    return res.status(200).json({ waiting, log, lastAlert: last, canEdit: !!perms && can(perms, "elf", "edit") });
  } catch (err) {
    console.error("admin elf photos failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** One photo's bytes, never kept by a browser or an index. */
export async function getAdminElfPhotoPicture(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "view");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json(BAD_REQUEST);
  try {
    const found = await photoForStaff(id);
    if (!found) return res.status(404).json(NO_PHOTO);
    res.setHeader("Content-Type", found.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return res.status(200).send(found.bytes);
  } catch (err) {
    console.error("admin elf photo picture failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** Answers a decision: done, a photo that is not there, or someone else's decision first (409, with that
 *  photo's newest step, so the head elf sees who and when). */
async function decided(res: Response, id: number, outcome: "done" | "already" | null): Promise<Response> {
  if (outcome === null) return res.status(404).json(NO_PHOTO);
  if (outcome === "already") return res.status(409).json({ error: ALREADY, step: await photoStep(id) });
  return res.status(200).json({ ok: true });
}

export async function postAdminElfPhotoApprove(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json(BAD_REQUEST);
  try {
    return await decided(res, id, await decidePhoto(id, "approved", actorOf(claims), null));
  } catch (err) {
    console.error("admin elf photo approve failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function postAdminElfPhotoDecline(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json(BAD_REQUEST);
  const parsed = declineSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json(SAY_WHY);
  try {
    return await decided(res, id, await decidePhoto(id, "declined", actorOf(claims), parsed.data.reason));
  } catch (err) {
    console.error("admin elf photo decline failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function postAdminElfPhotoTakeDown(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json(BAD_REQUEST);
  const parsed = takeDownSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json(SAY_WHY);
  try {
    const done = await takeDownPhoto(id, actorOf(claims), parsed.data.reason ?? null);
    if (done === null) return res.status(404).json(NO_PHOTO);
    if (!done) return res.status(409).json({ error: "That photo is not up, so there is nothing to take down.", step: await photoStep(id) });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("admin elf photo take down failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

adminElfFindsRouter.get("/api/admin/elf/photos", getAdminElfPhotos);
adminElfFindsRouter.get("/api/admin/elf/photos/:id/picture", getAdminElfPhotoPicture);
adminElfFindsRouter.post("/api/admin/elf/photos/:id/approve", postAdminElfPhotoApprove);
adminElfFindsRouter.post("/api/admin/elf/photos/:id/decline", postAdminElfPhotoDecline);
adminElfFindsRouter.post("/api/admin/elf/photos/:id/take-down", postAdminElfPhotoTakeDown);
