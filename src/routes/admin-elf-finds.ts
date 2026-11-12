import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import { can } from "../admin/permissions";
import { getElfSettings } from "../db/elf";
import { lastAlert } from "../db/elf-alerts";
import { doorCounts, finderOf, loadDoorRuns, loadPractice, type DoorRun } from "../db/elf-game";
import { dayIsOver } from "../elf/door-setup";
import { cluesOut, isOpen, type DoorState } from "../elf/doors";
import { longDayWords } from "../elf/words";
import type { Door } from "../elf/calendar";
import { decidePhoto, photoForStaff, photoLog, photoStep, photosWaiting, takeDownPhoto } from "../db/elf-photos";

// NBCC Elf Detective School in the admin, Head Elf HQ's Finds tab: the photo check and the photo log
// (docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md, "Head Elf HQ: the photo check"):
//
//   GET  /api/admin/elf/photos                 the photos waiting, the log, the last alert, and canEdit (elf: view)
//   GET  /api/admin/elf/photos/:id/picture     one photo's bytes, for a head elf's eyes only (view)
//   POST /api/admin/elf/photos/:id/approve     approve it (edit)
//   POST /api/admin/elf/photos/:id/decline     decline it, with a reason only head elves see (edit)
//   POST /api/admin/elf/photos/:id/take-down   take it down, with an optional reason (edit)
//   GET  /api/admin/elf/finds                  who found each door and when, tonight and before (view)
//
// Head elves see a family's full names here; nothing on these routes is ever shown to a family or the
// public, and an audit row never carries a place name or a photo. The screen is
// assets/js/admin/elf-hq.js. Unit tested in test/unit/admin-elf-finds.test.ts.

export const adminElfFindsRouter = Router();

/** One door on Tonight and before: its day, state, place (staff only), finder and counts. */
export interface FindRow {
  door: Door | 0;
  practice: boolean;
  day: string;
  state: DoorState;
  placeName: string | null;
  placeTown: string | null;
  found: { detectives: string[]; grownUpName: string; at: string } | null;
  cluesOut: 0 | 1 | 2 | 3;
  /** Once the place is shown; `families` is the families that have visited. */
  counts: { families: number; cracked: number } | null;
  /** Until midnight at the end of its day; never for the practice door. */
  canAddName: boolean;
}

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const NO_PHOTO = { error: "That photo is not there." };
const BAD_REQUEST = { error: "That request could not be read." };
const SAY_WHY = { error: "Say why in a few words. Only head elves see it." };
const ALREADY = "Someone has already checked this photo.";
/** The log's newest lines of photos that are not up. Every photo that is up is listed however old (photoLog),
 *  so each keeps its Take it down. */
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

async function findRow(run: DoorRun, now: Date): Promise<FindRow> {
  const practice = run.door === 0;
  const hasFinder = run.state === "found" || run.state === "found-hidden";
  const finder = hasFinder ? await finderOf(run.year, run.door) : null;
  const counts = isOpen(run.state) ? await doorCounts(run.year, run.door, now, run, false) : null;
  return {
    door: run.door,
    practice,
    day: practice ? "" : longDayWords(run.facts.clue1At),
    state: run.state,
    placeName: run.placeName,
    placeTown: run.placeTown,
    found: finder ? { detectives: finder.detectives, grownUpName: finder.grownUpName, at: finder.at.toISOString() } : null,
    cluesOut: cluesOut(run.facts, now),
    counts: counts ? { families: counts.visited, cracked: counts.cracked } : null,
    canAddName: !practice && !dayIsOver(run.year, run.door as Door, now),
  };
}

/** Who found each door and when: the practice door first while it runs, then today's door and back,
 *  only doors whose clue 1 is out. Head elves see full names; removed families are left out. */
export async function getAdminElfFinds(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "view");
  if (!claims) return;
  try {
    const now = new Date();
    const { year } = await getElfSettings();
    const [runs, practice] = await Promise.all([loadDoorRuns(year, now), loadPractice(now)]);
    const started = (r: DoorRun) => now.getTime() >= r.facts.clue1At.getTime();
    const shown = [...(practice && started(practice) ? [practice] : []), ...runs.filter(started).sort((a, b) => b.door - a.door)];
    const doors = await Promise.all(shown.map((r) => findRow(r, now)));
    return res.status(200).json({ doors });
  } catch (err) {
    console.error("admin elf finds failed:", err instanceof Error ? err.message : err);
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

adminElfFindsRouter.get("/api/admin/elf/finds", getAdminElfFinds);
adminElfFindsRouter.get("/api/admin/elf/photos", getAdminElfPhotos);
adminElfFindsRouter.get("/api/admin/elf/photos/:id/picture", getAdminElfPhotoPicture);
adminElfFindsRouter.post("/api/admin/elf/photos/:id/approve", postAdminElfPhotoApprove);
adminElfFindsRouter.post("/api/admin/elf/photos/:id/decline", postAdminElfPhotoDecline);
adminElfFindsRouter.post("/api/admin/elf/photos/:id/take-down", postAdminElfPhotoTakeDown);
