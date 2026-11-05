import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import { config } from "../config";
import { getElfSettings, listElfSignups, setElfPreview, setElfSettings, type ElfSettings } from "../db/elf";
import { hashElfToken, newElfToken } from "../elf/session";

/** The settings as the admin sees them: whether there is a preview link, never its code's hash. */
function forAdmin(s: ElfSettings) {
  const rest: Partial<ElfSettings> = { ...s };
  delete rest.previewHash;
  return { ...rest, previewOn: !!s.previewHash };
}

// NBCC Elf Detective School in the admin (wave 1 plan, Task 9), in Admin > Get involved > Settings:
//
//   GET   /api/admin/elf/settings   the switch and the pay what you can amounts (Get involved: view)
//   PATCH /api/admin/elf/settings   change them (admins only: switching the school on puts it live)
//   GET   /api/admin/elf/signups    paid sign ups: how many families and detectives, the money, and
//                                   the newest 50 (Get involved: view)
//
// The school belongs to the "fundraising" permission section, like the rest of Get involved, so it
// needs no permissions migration. The screen is assets/js/admin/elf.js. Unit tested in
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
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    return res.status(200).json({ settings: forAdmin(await getElfSettings()) });
  } catch (err) {
    console.error("admin elf settings failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function patchAdminElfSettings(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
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

export async function getAdminElfSignups(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    return res.status(200).json(await listElfSignups());
  } catch (err) {
    console.error("admin elf sign ups failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A new private preview link (admins only). Any earlier link stops working. The code is shown
 *  once, here; only its sha256 is kept. */
export async function postAdminElfPreview(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
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
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
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
adminElfRouter.get("/api/admin/elf/signups", getAdminElfSignups);
