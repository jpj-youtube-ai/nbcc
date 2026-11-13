import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import { can } from "../admin/permissions";
import { getElfSettings, setElfSettings, type ElfSettings } from "../db/elf";
import { loadDoorRun, type DoorRun } from "../db/elf-game";
import { CHRISTMAS_EVE, doorInstant, isClockTime } from "../elf/calendar";
import { doorSeason } from "../elf/door-setup";
import { closingRefusal, door24Warning, grandPrizeClosesAt } from "../elf/grand-prize";
import { londonMinute } from "../tickets/model";

// NBCC Elf Detective School in the admin: Head Elf HQ's side of the grand prize (Plan 2c-2; design:
// docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md, part 2):
//
//   GET  /api/admin/elf/grand-prize/settings   when the entries close on Christmas Eve, door 24's warning,
//                                              and the graduates' video (elf: view)
//   PUT  /api/admin/elf/grand-prize/settings   change the time, the link, or both (elf: edit)
//
// The entries close at 5pm on Christmas Eve unless a head elf saves another time, never earlier than an
// hour after door 24's place can be shown (closingRefusal, src/elf/grand-prize.ts). A change saves only
// what was sent (ruling F6), through setElfSettings, which writes the audit row: a time and a link, never
// a child's name, a picture or a mobile. The screen is Settings > The grand prize in
// assets/js/admin/elf-hq.js. Unit tested in test/unit/admin-elf-prize.test.ts.

export const adminElfPrizeRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const BAD_REQUEST = "That did not look right. Reload the page and try again.";
const TIME_WORDS = "Type a time like 17:00.";
const VIDEO_WORDS = "The video link must start with https:// and be no longer than 300 letters.";
/** The longest video link elf_settings keeps (its CHECK, migrations/1791200000490_elf-grand-prize.js). */
const VIDEO_MAX = 300;

/** Blank words are no link. */
const blankIsNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** A link a browser can follow, so graduates never meet a dead "Watch the graduates' video": one that URL
 *  reads, https, with a host that has a dot, and no space or control character anywhere in it. */
function followable(link: string): boolean {
  if (/[\s\p{Cc}]/u.test(link)) return false;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

const putSchema = z
  .object({
    time: z.string().refine(isClockTime).optional(),
    // As the table's CHECK has it: https:// first, exactly so (the CHECK reads capitals as different).
    videoUrl: z.preprocess(blankIsNull, z.string().trim().max(VIDEO_MAX).startsWith("https://").refine(followable).nullable().optional()),
  })
  .strict();

/** The sentence for whatever made the body fail: the field's own, or a request this screen never sends. */
function refusalOf(issue: z.ZodIssue | undefined): string {
  if (issue?.path[0] === "time") return TIME_WORDS;
  if (issue?.path[0] === "videoUrl") return VIDEO_WORDS;
  return BAD_REQUEST;
}

/** What Settings > The grand prize shows: when the entries close (the moment, and its "HH:MM" in London),
 *  whether that is the default 5pm because no time of this year is saved, door 24's warning as it is now,
 *  and the graduates' video. */
function prizeAnswer(settings: ElfSettings, door24: DoorRun, canEdit: boolean) {
  const closesAt = grandPrizeClosesAt(settings);
  const stored = settings.grandPrizeClosesAt;
  return {
    closesAt: closesAt.toISOString(),
    time: londonMinute(closesAt).slice(11, 16),
    isDefault: !(stored instanceof Date && stored.getTime() === closesAt.getTime()),
    warning: door24Warning({ closesAt, door24 }),
    videoUrl: settings.graduateVideoUrl ?? null,
    canEdit,
  };
}

export async function getAdminElfPrizeSettings(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "view");
  if (!claims) return;
  try {
    const settings = await getElfSettings();
    const [door24, perms] = await Promise.all([loadDoorRun(settings.year, CHRISTMAS_EVE, new Date()), loadEffectivePermissions(claims.sub)]);
    return res.status(200).json(prizeAnswer(settings, door24, !!perms && can(perms, "elf", "edit")));
  } catch (err) {
    console.error("admin elf grand prize settings failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

export async function putAdminElfPrizeSettings(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const parsed = putSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: refusalOf(parsed.error.issues[0]) });
  try {
    const settings = await getElfSettings();
    const now = new Date();
    const door24 = await loadDoorRun(settings.year, CHRISTMAS_EVE, now);
    // Only what was sent changes (ruling F6): saving the link leaves the closing time as it is.
    const patch: Partial<Pick<ElfSettings, "grandPrizeClosesAt" | "graduateVideoUrl">> = {};
    if (parsed.data.time !== undefined) {
      const closesAt = doorInstant(doorSeason(settings.year), CHRISTMAS_EVE, parsed.data.time);
      if (!closesAt) return res.status(400).json({ error: TIME_WORDS });
      const refusal = closingRefusal({ closesAt, door24 });
      if (refusal) return res.status(409).json({ error: refusal });
      patch.grandPrizeClosesAt = closesAt;
    }
    if (parsed.data.videoUrl !== undefined) patch.graduateVideoUrl = parsed.data.videoUrl;
    // Nothing sent: write nothing, audit nothing, and answer as the read does.
    const saved = Object.keys(patch).length > 0 ? await setElfSettings(patch, actorOf(claims)) : settings;
    return res.status(200).json(prizeAnswer(saved, door24, true));
  } catch (err) {
    console.error("admin elf grand prize settings change failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

adminElfPrizeRouter.get("/api/admin/elf/grand-prize/settings", getAdminElfPrizeSettings);
adminElfPrizeRouter.put("/api/admin/elf/grand-prize/settings", putAdminElfPrizeSettings);
