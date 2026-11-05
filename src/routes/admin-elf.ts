import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import { actorOf } from "./admin";
import { config } from "../config";
import { getElfSettings, setElfPreview, setElfSettings, type ElfSettings } from "../db/elf";
import {
  changeElfDetective,
  changeElfFamily,
  elfFamilySheet,
  elfHqNumbers,
  elfRecruits,
  listElfFamilies,
  noteSignInCodeSent,
  removeElfFamily,
  restoreElfFamily,
  type FamilySheetRow,
  type FamilySummaryRow,
} from "../db/elf-admin";
import { familyFilter, parseDetectiveChange, parseFamilyChange } from "../elf/admin-families";
import { daysUntil, questsFor, tileFor } from "../elf/admin-hq";
import { sendSignInCodeTo } from "../elf/sign-in-code";
import { badgeWords } from "../elf/emails";
import { FESTIVE_SURNAMES } from "../elf/names";
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

// ---- Families: the list, a family's sheet, and what a head elf may change ----

const BAD_ID = { error: "That did not look right. Reload the page and try again." };
const NO_FAMILY = { error: "We could not find that family." };
/** How many families a page of the list holds. */
const FAMILIES_PAGE = 50;

/** The :id in the address, if it is a whole number above 0. */
function idOf(req: Request): number | null {
  const s = String((req.params as Record<string, unknown> | undefined)?.id ?? "");
  return /^[1-9]\d{0,9}$/.test(s) ? Number(s) : null;
}
const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);
const badgeOf = (n: number | null): string | null => (n === null ? null : badgeWords(n));

function summaryForAdmin(f: FamilySummaryRow) {
  return {
    id: f.id,
    grownUpName: f.grownUpName,
    email: f.email,
    enrolledAt: iso(f.enrolledAt),
    removed: f.removed,
    namesToCheck: f.detectives.filter((d) => !d.approved).length,
    detectives: f.detectives.map((d) => ({ id: d.id, firstName: d.firstName, badge: badgeOf(d.badgeNumber), approved: d.approved, tile: tileFor(d.look) })),
  };
}

function sheetForAdmin(f: FamilySheetRow) {
  return {
    id: f.id,
    grownUpName: f.grownUpName,
    email: f.email,
    newsletter: f.newsletter,
    enrolledAt: iso(f.enrolledAt),
    removedAt: iso(f.removedAt),
    removedBy: f.removedBy,
    detectives: f.detectives.map((d) => ({ id: d.id, firstName: d.firstName, surname: d.surname, badge: badgeOf(d.badgeNumber), approved: d.approved, tile: tileFor(d.look) })),
    payments: f.payments.map((p) => ({ reference: p.reference, status: p.status, paidAt: iso(p.paidAt), entryPence: p.entryPence, giftPence: p.giftPence, giftAid: p.giftAid })),
  };
}

/** The families a search and a filter find, a page at a time (elf: view). */
export async function getAdminElfFamilies(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  if (!(await authorizeSection(req, res, "elf", "view"))) return;
  const query = (req.query ?? {}) as Record<string, unknown>;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const offset = typeof query.offset === "string" && /^\d{1,6}$/.test(query.offset) ? Number(query.offset) : 0;
  try {
    const found = await listElfFamilies({ q, filter: familyFilter(query.filter), offset, limit: FAMILIES_PAGE, now: new Date() });
    return res.status(200).json({ families: found.rows.map(summaryForAdmin), total: found.total, counts: found.counts });
  } catch (err) {
    console.error("admin elf families failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A family's sheet (elf: view). */
export async function getAdminElfFamily(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  if (!(await authorizeSection(req, res, "elf", "view"))) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json(BAD_ID);
  try {
    const sheet = await elfFamilySheet(id);
    // The festive surnames come too, for the rename form: a surname must be one of them.
    return sheet ? res.status(200).json({ family: sheetForAdmin(sheet), surnames: [...FESTIVE_SURNAMES] }) : res.status(404).json(NO_FAMILY);
  } catch (err) {
    console.error("admin elf family failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A head elf ticks a detective's name, or changes it (elf: edit). */
export async function patchAdminElfDetective(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json(BAD_ID);
  const parsed = parseDetectiveChange(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const d = await changeElfDetective(id, parsed.change, actorOf(claims));
    if (!d) return res.status(404).json({ error: "We could not find that detective." });
    return res.status(200).json({ detective: { id: d.id, familyId: d.familyId, firstName: d.firstName, surname: d.surname, badge: badgeOf(d.badgeNumber), approved: d.approved, tile: tileFor(d.look) } });
  } catch (err) {
    console.error("admin elf detective change failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A head elf changes a family's grown up name or email (elf: edit). */
export async function patchAdminElfFamily(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json(BAD_ID);
  const parsed = parseFamilyChange(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const f = await changeElfFamily(id, parsed.change, actorOf(claims));
    if (f === "email-taken") return res.status(409).json({ error: "Another family already uses that email." });
    return f ? res.status(200).json({ family: sheetForAdmin(f) }) : res.status(404).json(NO_FAMILY);
  } catch (err) {
    console.error("admin elf family change failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A head elf sends a family who cannot sign in a code to their own email (elf: edit). */
export async function postAdminElfSignInCode(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json(BAD_ID);
  try {
    const f = await elfFamilySheet(id);
    if (!f) return res.status(404).json(NO_FAMILY);
    if (f.removedAt) return res.status(409).json({ error: "This family is removed. Put it back first." });
    await sendSignInCodeTo(f.email);
    await noteSignInCodeSent(f.id, actorOf(claims));
    return res.status(200).json({ sent: true, email: f.email });
  } catch (err) {
    console.error("admin elf sign in code failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A head elf removes a family (a test sign up, or one refunded in Stripe), or puts it back (elf: edit). */
function familyMark(change: (id: number, actor: string) => Promise<FamilySheetRow | null>, what: string) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    res.setHeader("Cache-Control", "no-store");
    const claims = await authorizeSection(req, res, "elf", "edit");
    if (!claims) return;
    const id = idOf(req);
    if (id === null) return res.status(400).json(BAD_ID);
    try {
      const f = await change(id, actorOf(claims));
      return f ? res.status(200).json({ family: sheetForAdmin(f) }) : res.status(404).json(NO_FAMILY);
    } catch (err) {
      console.error(`admin elf family ${what} failed:`, err instanceof Error ? err.message : err);
      return res.status(500).json(UNAVAILABLE);
    }
  };
}
export const postAdminElfFamilyRemove = familyMark((id, actor) => removeElfFamily(id, actor), "remove");
export const postAdminElfFamilyRestore = familyMark((id, actor) => restoreElfFamily(id, actor), "restore");

adminElfRouter.post("/api/admin/elf/preview", postAdminElfPreview);
adminElfRouter.delete("/api/admin/elf/preview", deleteAdminElfPreview);
adminElfRouter.get("/api/admin/elf/settings", getAdminElfSettings);
adminElfRouter.patch("/api/admin/elf/settings", patchAdminElfSettings);
adminElfRouter.get("/api/admin/elf/hq", getAdminElfHq);
adminElfRouter.get("/api/admin/elf/families", getAdminElfFamilies);
adminElfRouter.get("/api/admin/elf/families/:id", getAdminElfFamily);
adminElfRouter.patch("/api/admin/elf/families/:id", patchAdminElfFamily);
adminElfRouter.post("/api/admin/elf/families/:id/sign-in-code", postAdminElfSignInCode);
adminElfRouter.post("/api/admin/elf/families/:id/remove", postAdminElfFamilyRemove);
adminElfRouter.post("/api/admin/elf/families/:id/restore", postAdminElfFamilyRestore);
adminElfRouter.patch("/api/admin/elf/detectives/:id", patchAdminElfDetective);
