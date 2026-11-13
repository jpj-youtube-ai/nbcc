import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import { can } from "../admin/permissions";
import { getElfSettings, setElfSettings, type ElfSettings } from "../db/elf";
import { loadDoorRun, type DoorRun } from "../db/elf-game";
import { listEntries, markWinner, staffEntryPicture, WinnerTaken, type StaffEntry } from "../db/elf-grand-prize";
import { CHRISTMAS_EVE, doorInstant, isClockTime } from "../elf/calendar";
import { doorSeason } from "../elf/door-setup";
import { closingRefusal, door24Warning, grandPrizeClosesAt, WINNER_TAKEN_WORDS } from "../elf/grand-prize";
import { londonMinute } from "../tickets/model";

// NBCC Elf Detective School in the admin: Head Elf HQ's side of the grand prize (Plan 2c-2; design:
// docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md, part 2):
//
//   GET  /api/admin/elf/grand-prize/settings      when the entries close on Christmas Eve, door 24's warning,
//                                                 and the graduates' video (elf: view)
//   PUT  /api/admin/elf/grand-prize/settings      change the time, the link, or both (elf: edit)
//   GET  /api/admin/elf/grand-prize               every picture sent in this year, oldest first, and whether
//                                                 the entries have closed (elf: view)
//   GET  /api/admin/elf/grand-prize/:id/picture   one entry's picture (elf: view)
//   POST /api/admin/elf/grand-prize/:id/winner    mark it as the year's one winner, once the entries have
//                                                 closed (elf: edit)
//
// The entries close at 5pm on Christmas Eve unless a head elf saves another time, never earlier than an
// hour after door 24's place can be shown (closingRefusal, src/elf/grand-prize.ts), and the time is fixed
// once the entries have closed; the link can still change. A change saves only
// what was sent (ruling F6), through setElfSettings, which writes the audit row: a time and a link, never
// a child's name, a picture or a mobile. The screens are Settings > The grand prize and the Grand prize
// part in assets/js/admin/elf-hq.js.
//
// The Grand prize part is for head elves only: they see each detective's full name, the grown up's mobile
// and the picture, judged with no age (the site never asks for one). Those answers are kept by no cache and
// never logged; only an error's message is. The site announces nothing: NBCC rings the winner's grown up.
// Unit tested in test/unit/admin-elf-prize.test.ts.

export const adminElfPrizeRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const BAD_REQUEST = "That did not look right. Reload the page and try again.";
const TIME_WORDS = "Type a time like 17:00.";
/** Once the entries have closed their closing time is fixed, as a door's times are once its evening has
 *  started: a winner is marked only after the close, so a picture never changes under the judge. */
const CLOSED_WORDS = "The entries have closed, so their closing time cannot change.";
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
      if (grandPrizeClosesAt(settings).getTime() <= now.getTime()) return res.status(409).json({ error: CLOSED_WORDS });
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

// ---- the Grand prize part: every picture sent in, and the one winner ----

/** An answer that carries a child's picture or a family's mobile: no cache, shared or private, keeps it. */
const PRIVATE = "private, no-store";
const NOT_THERE = { error: "That picture is not there." };
const STILL_OPEN = { error: "The entries are still open, so the winner can be marked once they close." };

/** The :id in the address, when it is a whole number above 0. */
function idOf(req: Request): number | null {
  const raw = String((req.params as Record<string, unknown> | undefined)?.id ?? "");
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

/** What the Grand prize part shows: when the entries close and whether they have, every entry of the year
 *  oldest first (the detective by full name, the grown up, the family's mobile, when its picture came in and
 *  whether it is the winner), and whether the caller may mark the winner. */
function entriesAnswer(settings: ElfSettings, entries: StaffEntry[], canEdit: boolean, now: Date) {
  const closesAt = grandPrizeClosesAt(settings);
  return {
    closesAt: closesAt.toISOString(),
    closed: now.getTime() >= closesAt.getTime(),
    entries: entries.map((e) => ({
      id: e.id,
      detective: e.detective,
      grownUpName: e.grownUpName,
      mobile: e.mobile,
      sentAt: new Date(e.sentAt).toISOString(),
      winner: e.winner,
    })),
    canEdit,
  };
}

/** Every picture sent in for this year's grand prize (elf: view). */
export async function getAdminElfGrandPrize(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "view");
  if (!claims) return;
  try {
    const settings = await getElfSettings();
    const [entries, perms] = await Promise.all([listEntries(settings.year), loadEffectivePermissions(claims.sub)]);
    res.setHeader("Cache-Control", PRIVATE);
    return res.status(200).json(entriesAnswer(settings, entries, !!perms && can(perms, "elf", "edit"), new Date()));
  } catch (err) {
    console.error("admin elf grand prize entries failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** One entry's picture, for head elves' eyes only: never kept by a cache, read as anything but its type, or
 *  indexed (elf: view). */
export async function getAdminElfGrandPrizePicture(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "view");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json({ error: BAD_REQUEST });
  try {
    const { year } = await getElfSettings();
    const picture = await staffEntryPicture(year, id);
    if (!picture) return res.status(404).json(NOT_THERE);
    res.setHeader("Cache-Control", PRIVATE);
    res.setHeader("Content-Type", picture.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return res.status(200).send(picture.bytes);
  } catch (err) {
    console.error("admin elf grand prize picture failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A head elf marks an entry as the year's one winner (elf: edit), only once the entries have closed, so a
 *  picture never changes under the judge (planner's call 6). Marking another moves the mark; markWinner
 *  writes the audit row. Answers as the read does. Another head elf marking at the same moment is a 409 in
 *  words (WinnerTaken), never a 500. */
export async function postAdminElfGrandPrizeWinner(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json({ error: BAD_REQUEST });
  try {
    const settings = await getElfSettings();
    const now = new Date();
    // Read as "still open" unless the close has truly come, so a time that is not one never lets a mark in.
    if (!(now.getTime() >= grandPrizeClosesAt(settings).getTime())) return res.status(409).json(STILL_OPEN);
    if (!(await markWinner(settings.year, id, actorOf(claims)))) return res.status(404).json(NOT_THERE);
    const entries = await listEntries(settings.year);
    res.setHeader("Cache-Control", PRIVATE);
    return res.status(200).json(entriesAnswer(settings, entries, true, now));
  } catch (err) {
    if (err instanceof WinnerTaken) return res.status(409).json({ error: WINNER_TAKEN_WORDS });
    console.error("admin elf grand prize winner failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

adminElfPrizeRouter.get("/api/admin/elf/grand-prize/settings", getAdminElfPrizeSettings);
adminElfPrizeRouter.put("/api/admin/elf/grand-prize/settings", putAdminElfPrizeSettings);
adminElfPrizeRouter.get("/api/admin/elf/grand-prize", getAdminElfGrandPrize);
adminElfPrizeRouter.get("/api/admin/elf/grand-prize/:id/picture", getAdminElfGrandPrizePicture);
adminElfPrizeRouter.post("/api/admin/elf/grand-prize/:id/winner", postAdminElfGrandPrizeWinner);
