import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import { can } from "../admin/permissions";
import { qrPng } from "../fundraising/qr-png";
import { namedShortLink } from "../site/qr-named";
import {
  findOrCreateSleighCode,
  getSleighSettings,
  listNights,
  readSleighTotalsNow,
  saveNight,
  saveSleighSettings,
} from "../db/sleigh";

// Admin > Giving > Santa Sleigh (docs/superpowers/specs/2026-11-10-santa-sleigh-design.md). No
// permission of its own (that is costly): view of Donations sees it, edit of Donations changes it. The
// screen is assets/js/admin/sleigh.js.
//
//   GET   /api/admin/sleigh                 the nights, the settings and the totals          donations view
//   PATCH /api/admin/sleigh/nights/:id      { areas?, startsAt?, endsAt?, bucketPence? }     donations edit
//   PATCH /api/admin/sleigh/settings        { offOn }                                        donations edit
//   GET   /api/admin/sleigh/qr-handout      the hand-out QR code, a PNG to save              donations view
//
// Every save is in audit_log with the change, and a night's save re-sorts the card machine taps
// (src/db/sleigh.ts).

export const adminSleighRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
export const SLEIGH_MESSAGES = {
  areas: "Write the areas the sleigh goes round, up to 120 letters.",
  time: "Write each time as hours and minutes, like 18:00, or leave it empty.",
  bucket: "Write the bucket cash in pounds and pence, like 152.40.",
  order: "The finish time must be after the start time.",
  nothing: "There was nothing to save.",
  missing: "That night is not there any more. Reload the page.",
  offOn: "Choose the day the page switches off.",
} as const;

/** The name of the code the hand-outs carry, in Admin > QR codes. */
export const SLEIGH_HANDOUT_CODE = "Santa Sleigh hand-outs";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = z.string().regex(HHMM, SLEIGH_MESSAGES.time).nullable().optional();

const nightBody = z
  .object({
    areas: z.string({ invalid_type_error: SLEIGH_MESSAGES.areas }).trim().min(1, SLEIGH_MESSAGES.areas).max(120, SLEIGH_MESSAGES.areas).optional(),
    startsAt: time,
    endsAt: time,
    bucketPence: z
      .number({ invalid_type_error: SLEIGH_MESSAGES.bucket })
      .int(SLEIGH_MESSAGES.bucket)
      .min(0, SLEIGH_MESSAGES.bucket)
      .max(10_000_000, SLEIGH_MESSAGES.bucket)
      .optional(),
  })
  .strict(SLEIGH_MESSAGES.nothing)
  .refine((b) => Object.keys(b).length > 0, SLEIGH_MESSAGES.nothing)
  .refine((b) => !b.startsAt || !b.endsAt || b.endsAt > b.startsAt, SLEIGH_MESSAGES.order);

/** A real calendar day written YYYY-MM-DD. */
const realDay = (v: string): boolean => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const settingsBody = z.object({ offOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDay) });

async function state(sub: number): Promise<Record<string, unknown>> {
  const [nights, settings, totals, perms] = await Promise.all([listNights(), getSleighSettings(), readSleighTotalsNow(), loadEffectivePermissions(sub)]);
  return { nights, settings, totals, mayEdit: !!perms && can(perms, "donations", "edit") };
}

export async function getAdminSleigh(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "view");
  if (!claims) return;
  try {
    return res.status(200).json(await state(claims.sub));
  } catch (err) {
    console.error("admin sleigh: reading failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function patchSleighNight(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: SLEIGH_MESSAGES.missing });
  const parsed = nightBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? SLEIGH_MESSAGES.nothing });
  try {
    const saved = await saveNight(id, parsed.data, actorOf(claims));
    if (!saved) return res.status(404).json({ error: SLEIGH_MESSAGES.missing });
    return res.status(200).json(await state(claims.sub));
  } catch (err) {
    console.error("admin sleigh: saving a night failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function patchSleighSettings(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "edit");
  if (!claims) return;
  const parsed = settingsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: SLEIGH_MESSAGES.offOn });
  try {
    await saveSleighSettings(parsed.data, actorOf(claims));
    return res.status(200).json(await state(claims.sub));
  } catch (err) {
    console.error("admin sleigh: saving the settings failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** The hand-out QR code: its own named code going to /sleigh, so Admin > QR codes counts its scans. */
export async function getSleighQrHandout(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "donations", "view");
  if (!claims) return;
  try {
    const id = await findOrCreateSleighCode(SLEIGH_HANDOUT_CODE, actorOf(claims));
    const png = qrPng(namedShortLink(id));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", 'attachment; filename="santa-sleigh-qr.png"');
    res.type("image/png");
    return res.send(png);
  } catch (err) {
    console.error("admin sleigh: the hand-out code failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

adminSleighRouter.get("/api/admin/sleigh", getAdminSleigh);
adminSleighRouter.patch("/api/admin/sleigh/nights/:id", patchSleighNight);
adminSleighRouter.patch("/api/admin/sleigh/settings", patchSleighSettings);
adminSleighRouter.get("/api/admin/sleigh/qr-handout", getSleighQrHandout);
