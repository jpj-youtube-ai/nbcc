import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import { config } from "../config";
import { getElfSettings, setElfPreview, setElfSettings, type ElfSettings } from "../db/elf";
import { elfHqNumbers, elfRecruits } from "../db/elf-admin";
import { daysUntil, questsFor, tileFor } from "../elf/admin-hq";
import { badgeWords } from "../elf/emails";
import { hashElfToken, newElfToken } from "../elf/session";
import { firstClueAt } from "../elf/views";

/** The settings as the admin sees them: whether there is a preview link, never its code's hash. */
function forAdmin(s: ElfSettings) {
  const rest: Partial<ElfSettings> = { ...s };
  delete rest.previewHash;
  return { ...rest, previewOn: !!s.previewHash };
}

// NBCC Elf Detective School in the admin: Head Elf HQ, its own section (Admin > Content > Elf Detective
// School; docs/superpowers/specs/2026-11-05-elf-admin-design.md):
//
//   GET   /api/admin/elf/settings   the switch and the pay what you can amounts (elf: view)
//   PATCH /api/admin/elf/settings   change them (admins only: switching the school on puts it live)
//   GET   /api/admin/elf/hq         HQ: the settings, the numbers, Needs you, the newest recruits and
//                                   the days to the first clue (elf: view)
//
// The school has its own permission section, "elf" (src/admin/permissions.ts): admins by role, a head
// elf given it from the Team matrix. The screen is assets/js/admin/elf-hq.js. Unit tested in
// test/unit/admin-elf.test.ts.

export const adminElfRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

const patchSchema = z
  .object({
    schoolOn: z.boolean().optional(),
    entryFromPence: z.number().int().min(100, "The least a family pays must be at least £1 for each detective.").max(1000, "The least a family pays can be at most £10 for each detective.").optional(),
    entrySuggestedPence: z.number().int().min(100, "The suggested amount must be at least £1 for each detective.").max(5000, "The suggested amount can be at most £50 for each detective.").optional(),
  })
  .strict();

export async function getAdminElfSettings(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  if (!(await authorizeSection(req, res, "elf", "view"))) return;
  try {
    return res.status(200).json({ settings: forAdmin(await getElfSettings()) });
  } catch (err) {
    console.error("admin elf settings failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function patchAdminElfSettings(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSectionAsAdmin(req, res, "elf");
  if (!claims) return;
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const words = first?.message && /^[A-Z]/.test(first.message) ? first.message : "That did not look right. Reload the page and try again.";
    return res.status(400).json({ error: words });
  }
  try {
    const now = await getElfSettings();
    const from = parsed.data.entryFromPence ?? now.entryFromPence;
    const suggested = parsed.data.entrySuggestedPence ?? now.entrySuggestedPence;
    if (suggested < from) return res.status(400).json({ error: "The suggested amount cannot be less than the least a family pays." });
    return res.status(200).json({ settings: forAdmin(await setElfSettings(parsed.data, actorOf(claims))) });
  } catch (err) {
    console.error("admin elf settings change failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** How many newest recruits HQ shows. */
const RECRUITS = 8;

/** HQ: everything its first screen draws, in one answer. */
export async function getAdminElfHq(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "view");
  if (!claims) return;
  try {
    const now = new Date();
    const [settings, numbers, recruits] = await Promise.all([getElfSettings(), elfHqNumbers(now), elfRecruits(RECRUITS)]);
    const clue = firstClueAt(settings.year);
    return res.status(200).json({
      settings: forAdmin(settings),
      // Whether the lever is drawn to be pulled. The token's role is enough for that: the switch
      // itself is PATCH /api/admin/elf/settings, which checks the role in the database.
      canSwitch: claims.role === "admin",
      numbers,
      quests: questsFor(numbers, !!settings.previewHash),
      recruits: recruits.map((d) => ({
        detectiveId: d.detectiveId,
        familyId: d.familyId,
        name: `${d.firstName} ${d.surname}`,
        badge: d.badgeNumber === null ? null : badgeWords(d.badgeNumber),
        approved: d.approved,
        tile: tileFor(d.look),
      })),
      firstClueAt: clue.toISOString(),
      daysToFirstClue: daysUntil(now, clue),
    });
  } catch (err) {
    console.error("admin elf hq failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A new private preview link (admins only). Any earlier link stops working. The code is shown
 *  once, here; only its sha256 is kept. */
export async function postAdminElfPreview(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSectionAsAdmin(req, res, "elf");
  if (!claims) return;
  try {
    const token = newElfToken();
    await setElfPreview(hashElfToken(token), actorOf(claims));
    return res.status(200).json({ url: `${String(config.PORTAL_BASE_URL ?? "").replace(/\/+$/, "")}/elf/preview/${token}` });
  } catch (err) {
    console.error("admin elf preview failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** End the private preview link (admins only). */
export async function deleteAdminElfPreview(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSectionAsAdmin(req, res, "elf");
  if (!claims) return;
  try {
    await setElfPreview(null, actorOf(claims));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("admin elf preview end failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

adminElfRouter.post("/api/admin/elf/preview", postAdminElfPreview);
adminElfRouter.delete("/api/admin/elf/preview", deleteAdminElfPreview);
adminElfRouter.get("/api/admin/elf/settings", getAdminElfSettings);
adminElfRouter.patch("/api/admin/elf/settings", patchAdminElfSettings);
adminElfRouter.get("/api/admin/elf/hq", getAdminElfHq);
