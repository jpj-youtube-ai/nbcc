import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import { can } from "../admin/permissions";
import { config } from "../config";
import { getElfSettings, setElfPreview, setElfSettings, type ElfSettings } from "../db/elf";
import { clearWordTries, familyWordTries, onDoorsSwitchedOn } from "../db/elf-game";
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
import { listElfDoors } from "../db/elf-doors";
import { clearPractice, getPractice, startPractice, type PracticeRow } from "../db/elf-practice";
import { doorInstant, eveningFor, isDoor, DOOR_COUNT, type Door } from "../elf/calendar";
import { doorPicture, doorSeason, emptyDoor, type DoorSetup, readinessOf, staffEveningOf } from "../elf/door-setup";
import { familyFilter, parseDetectiveChange, parseFamilyChange } from "../elf/admin-families";
import { daysUntil, questsFor, tileFor, type SoonNotReady } from "../elf/admin-hq";
import { sendSignInCodeTo } from "../elf/sign-in-code";
import { badgeWords } from "../elf/emails";
import { FESTIVE_SURNAMES } from "../elf/names";
import { PRACTICE_ELF_NAME } from "../elf/practice-words";
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
//   PATCH /api/admin/elf/settings   change them (admins only: switching the school on puts it live, and
//                                   so does December's doors, which needs door 1 to be ready)
//   GET   /api/admin/elf/hq         HQ: the settings, the numbers, Needs you, the newest recruits and
//                                   the days to the first clue (elf: view)
//   GET    /api/admin/elf/practice  the practice door, with its tag word so a head elf can type it, and
//                                   whether there is a preview link (elf: view)
//   POST   /api/admin/elf/families/:id/word-tries/clear  let a family type words at a door again (elf: edit)
//   POST   /api/admin/elf/practice  start a practice evening at a pretend place (elf: edit; only with a
//                                   preview link, which is how it is played)
//   DELETE /api/admin/elf/practice  clear it and everything played at it (elf: edit)
//
// The school has its own permission section, "elf" (src/admin/permissions.ts): admins by role, a head
// elf given it from the Team matrix. The screen is assets/js/admin/elf-hq.js. Unit tested in
// test/unit/admin-elf.test.ts.

export const adminElfRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };

/** The site's own address, with no slash on the end: links handed to head elves start with it. */
const siteOrigin = (): string => String(config.PORTAL_BASE_URL ?? "").replace(/\/+$/, "");

const DOOR_1_NOT_READY = "Door 1 is not ready yet, so December's doors cannot be switched on.";

const PHONE_WORDS = "Use only numbers, spaces, brackets, plus signs and hyphens, with at least 7 numbers.";

/** A phone number a person can ring: blank is nothing (null). Shared with the doors' contact phone. */
export const phoneSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string({ invalid_type_error: PHONE_WORDS })
    .trim()
    .max(40, PHONE_WORDS)
    .refine((s) => /^[0-9 +()-]+$/.test(s) && (s.match(/\d/g) ?? []).length >= 7, PHONE_WORDS)
    .nullable(),
);

const patchSchema = z
  .object({
    schoolOn: z.boolean().optional(),
    doorsOn: z.boolean().optional(),
    entryFromPence: z.number().int().min(100, "The least a family pays must be at least £1 for each detective.").max(1000, "The least a family pays can be at most £10 for each detective.").optional(),
    entrySuggestedPence: z.number().int().min(100, "The suggested amount must be at least £1 for each detective.").max(5000, "The suggested amount can be at most £50 for each detective.").optional(),
    placePhone: phoneSchema.optional(),
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
    // December's doors go live only with door 1 ready: its first clue is what every family sees first.
    if (parsed.data.doorsOn === true) {
      const door1 = (await listElfDoors(now.year)).find((d) => d.door === 1) ?? emptyDoor(1, "");
      if (!readinessOf(door1, doorPicture(now.year, 1) !== null).ready) return res.status(409).json({ error: DOOR_1_NOT_READY });
    }
    const saved = await setElfSettings(parsed.data, actorOf(claims));
    // Every door of the year gets its row (so an unready one can be snowed in), and the practice goes.
    if (parsed.data.doorsOn === true) await onDoorsSwitchedOn(saved.year);
    return res.status(200).json({ settings: forAdmin(saved) });
  } catch (err) {
    console.error("admin elf settings change failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** How far ahead a door that is not ready is called out as soon. */
const SOON_MS = 3 * 24 * 60 * 60 * 1000;
const weekdayLong = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" });

/** The doors whose clue 1 is still to come and that are not ready, soonest first, and of those the ones
 *  whose clue 1 is within three days. Read only: a door with no row yet counts as an empty one. If the
 *  doors cannot be read, HQ simply has none to point at. */
async function doorsNotReadyAt(year: number, now: Date): Promise<{ notReady: { door: Door; toDo: number }[]; soon: SoonNotReady[] }> {
  try {
    const rows = await listElfDoors(year);
    const season = doorSeason(year);
    const doors: DoorSetup[] = [];
    for (let n = 1; n <= DOOR_COUNT; n++) {
      doors.push(rows.find((r) => r.door === n) ?? emptyDoor(n as Door, ""));
    }
    const late = doors
      .map((d) => {
        const at = doorInstant(season, d.door, eveningFor(season, d.door, staffEveningOf(d)).clue1);
        return { door: d.door, at, toDo: readinessOf(d, doorPicture(year, d.door) !== null).toDo };
      })
      .filter((d) => d.toDo > 0 && d.at !== null && d.at.getTime() > now.getTime())
      .sort((a, b) => a.at!.getTime() - b.at!.getTime());
    return {
      notReady: late.map(({ door, toDo }) => ({ door, toDo })),
      soon: late.filter((d) => d.at!.getTime() - now.getTime() <= SOON_MS).map((d) => ({ door: d.door, day: weekdayLong.format(d.at!), toDo: d.toDo })),
    };
  } catch (err) {
    console.error("admin elf doors failed:", err instanceof Error ? err.message : err);
    return { notReady: [], soon: [] };
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
    const [settings, numbers, recruits, perms] = await Promise.all([
      getElfSettings(),
      elfHqNumbers(now),
      elfRecruits(RECRUITS),
      loadEffectivePermissions(claims.sub),
    ]);
    const clue = firstClueAt(settings.year);
    const { notReady, soon } = await doorsNotReadyAt(settings.year, now);
    return res.status(200).json({
      settings: forAdmin(settings),
      // Whether the lever is drawn to be pulled. The token's role is enough for that: the switch
      // itself is PATCH /api/admin/elf/settings, which checks the role in the database.
      canSwitch: claims.role === "admin",
      // Whether Families draws its changes or just words: edit on the section, read as the gate
      // reads it, so someone given only a look is never shown buttons that answer "forbidden".
      canEdit: !!perms && can(perms, "elf", "edit"),
      numbers,
      quests: questsFor(numbers, !!settings.previewHash, notReady, soon),
      doorsNotReady: notReady.length,
      doorsOn: settings.doorsOn === true,
      doorsSoonNotReady: soon,
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
    return res.status(200).json({ url: `${siteOrigin()}/elf/preview/${token}` });
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
    if (!sheet) return res.status(404).json(NO_FAMILY);
    const { year } = await getElfSettings();
    // The festive surnames come too, for the rename form: a surname must be one of them.
    return res.status(200).json({ family: sheetForAdmin(sheet), wordTries: await triesOf(year, id), surnames: [...FESTIVE_SURNAMES] });
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
    // The email refused (or the address suppressed) is the very family this button is for: say so.
    if (!(await sendSignInCodeTo(f.email))) {
      return res.status(502).json({ error: "We could not send the code just now. Please try again in a minute." });
    }
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

/** The doors a family has typed wrong words at (a door whose tries were cleared has none). */
const triesOf = async (year: number, familyId: number) => (await familyWordTries(year, familyId)).filter((t) => t.wrong > 0);

const clearTriesSchema = z.object({ door: z.number().int().refine((n) => isDoor(n)) }).strict();

/** A head elf lets a family type words at a door again (elf: edit). */
export async function postAdminElfWordTriesClear(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const id = idOf(req);
  if (id === null) return res.status(400).json(BAD_ID);
  const parsed = clearTriesSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json(BAD_ID);
  try {
    const f = await elfFamilySheet(id);
    if (!f) return res.status(404).json(NO_FAMILY);
    const { year } = await getElfSettings();
    await clearWordTries(year, parsed.data.door, id, actorOf(claims));
    return res.status(200).json({ family: sheetForAdmin(f), wordTries: await triesOf(year, id) });
  } catch (err) {
    console.error("admin elf word tries clear failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

// ---- The practice door (wave 2): a pretend evening a head elf plays through the preview link ----
//
// It is door 0 of year 0, with absolute times (src/db/elf-practice.ts), seen only by a browser holding
// the preview cookie: so it can only be started while there is a preview link. The tag word is shown to
// head elves so they can type it on the poster page; it is never cached and never logged.

const NO_PREVIEW = { error: "Make a preview link in Settings first: the practice door is played through it." };
const BAD_PRACTICE = "That did not look right. Reload the page and try again.";
const MINUTES_WORDS = "The minutes between clues must be a whole number from 1 to 30.";

/** Missing words are empty words, so they get the same sentence. */
const missingIsEmpty = (v: unknown) => (v === undefined ? "" : v);
/** Blank words are not given, so the default is used. */
const blankIsMissing = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const practiceSchema = z
  .object({
    placeName: z.preprocess(
      missingIsEmpty,
      z.string({ invalid_type_error: BAD_PRACTICE }).trim().min(1, "Type the name of the pretend place.").max(80, "The place name can be up to 80 characters."),
    ),
    placeTown: z.preprocess(
      missingIsEmpty,
      z.string({ invalid_type_error: BAD_PRACTICE }).trim().min(1, "Type the town the pretend place is in.").max(60, "The town can be up to 60 characters."),
    ),
    elfName: z.preprocess(blankIsMissing, z.string({ invalid_type_error: BAD_PRACTICE }).trim().max(30, "The elf's name can be up to 30 characters.").optional()),
    minutesApart: z
      .number({ invalid_type_error: BAD_PRACTICE })
      .refine((n) => Number.isInteger(n) && n >= 1 && n <= 30, MINUTES_WORDS)
      .optional(),
  })
  .strict();

/** The sentence for a refusal: our own words, never the checker's ("Required", "Expected string, ..."),
 *  as src/routes/admin-elf-doors.ts does for its own forms. */
const CHECKER_OWN = new Set(["invalid_type", "unrecognized_keys", "invalid_union", "invalid_literal"]);
const practiceSentence = (issue: { message?: string; code?: string } | undefined): string =>
  issue?.message && !CHECKER_OWN.has(issue.code ?? "") && issue.message !== "Required" && /^[A-Z]/.test(issue.message) ? issue.message : BAD_PRACTICE;

function practiceForAdmin(p: PracticeRow | null) {
  if (!p) return null;
  return {
    placeName: p.placeName,
    placeTown: p.placeTown,
    elfName: p.elfName,
    tagWord: p.tagWord,
    clue1At: iso(p.clue1At),
    clue2At: iso(p.clue2At),
    clue3At: iso(p.clue3At),
    revealAt: iso(p.revealAt),
    found: p.foundAt !== null,
    posterUrl: `${siteOrigin()}/elf/p/${p.posterCode}`,
  };
}

/** The practice door, or none, and whether there is a preview link to play it through (elf: view). */
export async function getAdminElfPractice(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  if (!(await authorizeSection(req, res, "elf", "view"))) return;
  try {
    const [practice, settings] = await Promise.all([getPractice(), getElfSettings()]);
    return res.status(200).json({ practice: practiceForAdmin(practice), previewOn: !!settings.previewHash });
  } catch (err) {
    console.error("admin elf practice failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A head elf starts a practice evening (elf: edit): clue 1 a minute from now, then the gaps asked for.
 *  It replaces any practice before it, and everything played at it. */
export async function postAdminElfPractice(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  const parsed = practiceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: practiceSentence(parsed.error.issues[0]) });
  try {
    const settings = await getElfSettings();
    if (!settings.previewHash) return res.status(409).json(NO_PREVIEW);
    const practice = await startPractice({
      placeName: parsed.data.placeName,
      placeTown: parsed.data.placeTown,
      elfName: parsed.data.elfName ?? PRACTICE_ELF_NAME,
      minutesApart: parsed.data.minutesApart ?? 3,
      startedBy: actorOf(claims),
      now: new Date(),
    });
    return res.status(200).json({ practice: practiceForAdmin(practice), previewOn: true });
  } catch (err) {
    console.error("admin elf practice start failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

/** A head elf clears the practice door and everything played at it (elf: edit). */
export async function deleteAdminElfPractice(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "edit");
  if (!claims) return;
  try {
    await clearPractice(actorOf(claims));
    const settings = await getElfSettings();
    return res.status(200).json({ practice: null, previewOn: !!settings.previewHash });
  } catch (err) {
    console.error("admin elf practice clear failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
}

adminElfRouter.post("/api/admin/elf/preview", postAdminElfPreview);
adminElfRouter.delete("/api/admin/elf/preview", deleteAdminElfPreview);
adminElfRouter.get("/api/admin/elf/settings", getAdminElfSettings);
adminElfRouter.patch("/api/admin/elf/settings", patchAdminElfSettings);
adminElfRouter.get("/api/admin/elf/hq", getAdminElfHq);
adminElfRouter.get("/api/admin/elf/practice", getAdminElfPractice);
adminElfRouter.post("/api/admin/elf/practice", postAdminElfPractice);
adminElfRouter.delete("/api/admin/elf/practice", deleteAdminElfPractice);
adminElfRouter.get("/api/admin/elf/families", getAdminElfFamilies);
adminElfRouter.get("/api/admin/elf/families/:id", getAdminElfFamily);
adminElfRouter.patch("/api/admin/elf/families/:id", patchAdminElfFamily);
adminElfRouter.post("/api/admin/elf/families/:id/sign-in-code", postAdminElfSignInCode);
adminElfRouter.post("/api/admin/elf/families/:id/remove", postAdminElfFamilyRemove);
adminElfRouter.post("/api/admin/elf/families/:id/restore", postAdminElfFamilyRestore);
adminElfRouter.patch("/api/admin/elf/detectives/:id", patchAdminElfDetective);
adminElfRouter.post("/api/admin/elf/families/:id/word-tries/clear", postAdminElfWordTriesClear);
