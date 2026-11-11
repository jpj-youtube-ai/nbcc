import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import { phoneSchema } from "./admin-elf";
import { can } from "../admin/permissions";
import { config } from "../config";
import { isUsableSecretWord } from "../elf/claim";
import { renderElfPoster, renderElfTag, renderPlacesList, renderStaffCard } from "../elf/print";
import { materialsMessagePage } from "../fundraising/materials";
import { getElfSettings, type ElfSettings } from "../db/elf";
import { cluePicture } from "../db/elf-game";
import { checkPictureUpload, decodeBase64 } from "../fundraising/pictures";
import { processPicture } from "../fundraising/picture-process";
import {
  addElfDoorName,
  changeElfDoor,
  ensureElfDoors,
  getElfDoor,
  listElfDoors,
  markElfTagPrinted,
  removeElfCluePicture,
  removeElfDoorName,
  saveElfClue,
  saveElfCluePicture,
  savePastedClues,
  setElfTagWord,
  tickElfDoor,
  type DoorChange,
} from "../db/elf-doors";
import { doorInstant, eveningFor, EVENING_PROBLEM_WORDS, closesTooSoon, DOOR_COUNT, isClockTime, isDoor, LAST_REVEAL_TIME, type Door, type Evening } from "../elf/calendar";
import { CLUE_WORDS_MAX, parseCluePaste, pasteAgainstDoors, type ClueN, type PastedDoor, type PasteProblem } from "../elf/clue-paste";
import { makeTagWord } from "../elf/door-codes";
import {
  doorPicture,
  doorSeason,
  doorsSummary,
  doorWeekday,
  prizeListText,
  readinessOf,
  staffEveningOf,
  type DoorSetup,
  type Readiness,
} from "../elf/door-setup";
import { normalisePlaceName } from "../elf/place-names";
import { longDayWords } from "../elf/words";

// NBCC Elf Detective School in the admin: Head Elf HQ > Doors. The 24 doors, each with its place, prize,
// elf, clues and evening. These rows name the secret places, so every route is behind the elf permission
// and no answer is ever cached. The SQL is src/db/elf-doors.ts; the rules are pure modules in src/elf/.
//
//   GET    /api/admin/elf/doors                           the 24 tiles, the counts, the prize list (elf: view)
//   GET    /api/admin/elf/doors/:door                     one door's sheet (view)
//   PATCH  /api/admin/elf/doors/:door                     place, prize, elf name, times (edit)
//   POST   /api/admin/elf/doors/:door/names               a name that counts (edit)
//   DELETE /api/admin/elf/doors/:door/names/:id           take one off (edit)
//   POST   /api/admin/elf/doors/:door/word                a new tag word (edit)
//   POST|DELETE  .../dropped-off and .../thanked          the ticks (edit)
//   POST|DELETE  .../snow-day                             call a door off, or take that back, before its clue 1 (edit)
//   POST|DELETE  .../gone-home                            the place has stopped hosting the elf, once the door's day is over (edit)
//   PUT    /api/admin/elf/doors/:door/clues/:n            one clue (edit)
//   PUT|DELETE|GET .../clues/:n/picture                   a clue's picture: put it on, take it off, look at it (edit, edit, view)
//   POST   /api/admin/elf/clues/check and /save           every clue pasted at once (edit)
//   GET    /api/admin/elf/doors/:door/poster|staff-card|tag, and /api/admin/elf/places-list
//                                                         the prints: whole secret HTML pages (view)
//
// Once a door's clue 1 is out its times, word, clues and the removal of names are fixed (the game has
// started); its place details, prize, new names and ticks still change. Unit tested in
// test/unit/admin-elf-doors.test.ts.

export const adminElfDoorsRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const BAD_REQUEST = "That did not look right. Reload the page and try again.";
const NO_SUCH_DOOR = { error: "There is no door like that." };

type Evening3 = [boolean, boolean, boolean];

export interface DoorTile {
  door: Door;
  weekday: string;
  placeName: string | null;
  ready: boolean;
  toDo: number;
  /** True once this door's first clue is out. */
  started: boolean;
}

export interface DoorSheet extends DoorSetup {
  day: string;
  readiness: Readiness;
  evening: Evening;
  closesTooSoon: boolean;
  picture: string | null;
  posterUrl: string;
  clueOut: Evening3;
  started: boolean;
  /** Who called the door off and when (the by is "automatic" when the door was not ready); null if not. */
  snowDay: { at: string; by: string } | null;
  goneHome: { at: string; by: string } | null;
  /** Has the door's day (midnight at the end of it) passed? Gone home can be ticked only then. */
  dayOver: boolean;
}

interface Ctx {
  req: Request;
  res: Response;
  actor: string;
  settings: ElfSettings;
  year: number;
  now: Date;
  door: Door;
}

/** The evening of a door as it stands, and which of its clues are out at `now`. */
function eveningState(year: number, d: DoorSetup, now: Date): { evening: Evening; clueOut: Evening3 } {
  const season = doorSeason(year);
  const evening = eveningFor(season, d.door, staffEveningOf(d));
  const out = (time: string): boolean => {
    const at = doorInstant(season, d.door, time);
    return at !== null && at.getTime() <= now.getTime();
  };
  return { evening, clueOut: [out(evening.clue1), out(evening.clue2), out(evening.clue3)] };
}

function sheetOf(year: number, d: DoorSetup, now: Date): DoorSheet {
  const { evening, clueOut } = eveningState(year, d, now);
  const first = doorInstant(doorSeason(year), d.door, evening.clue1);
  const picture = doorPicture(year, d.door);
  return {
    ...d,
    day: first ? longDayWords(first) : "",
    readiness: readinessOf(d, picture !== null),
    evening,
    closesTooSoon: closesTooSoon(d.closesAt, evening.clue3),
    picture,
    posterUrl: `${String(config.PORTAL_BASE_URL ?? "").replace(/\/+$/, "")}/elf/p/${d.posterCode}`,
    clueOut,
    started: clueOut[0],
    snowDay: d.snowDayAt ? { at: new Date(d.snowDayAt).toISOString(), by: d.snowDayBy ?? "" } : null,
    goneHome: d.goneHomeAt ? { at: new Date(d.goneHomeAt).toISOString(), by: d.goneHomeBy ?? "" } : null,
    dayOver: dayIsOver(year, d.door, now),
  };
}

/** Midnight at the end of the door's day: when gone home can first be ticked. */
function dayIsOver(year: number, door: Door, now: Date): boolean {
  const last = doorInstant(doorSeason(year), door, "23:59");
  return !last || now.getTime() >= last.getTime() + 60_000;
}

/** The sentence for a zod failure: our own message, never zod's ("Required", "Unrecognized key(s) ..."). */
const ZOD_OWN = new Set(["invalid_type", "unrecognized_keys", "invalid_union", "invalid_literal"]);
const sentenceOr = (issue: { message?: string; code?: string } | undefined): string =>
  issue?.message && !ZOD_OWN.has(issue.code ?? "") && issue.message !== "Required" && /^[A-Z]/.test(issue.message) ? issue.message : BAD_REQUEST;

/** A handler for the elf section: the headers, the gate, the :door in the address, and the try/catch. */
function guarded(what: string, level: "view" | "edit", work: (c: Ctx) => Promise<Response | void>, needsDoor = true) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    res.setHeader("Cache-Control", "no-store");
    const claims = await authorizeSection(req, res, "elf", level);
    if (!claims) return;
    let door: Door = 1;
    if (needsDoor) {
      const raw = String((req.params as Record<string, unknown> | undefined)?.door ?? "");
      const n = /^[1-9]\d?$/.test(raw) ? Number(raw) : NaN;
      if (!isDoor(n)) return res.status(400).json(NO_SUCH_DOOR);
      door = n;
    }
    try {
      const settings = await getElfSettings();
      return await work({ req, res, actor: actorOf(claims), settings, year: settings.year, now: new Date(), door });
    } catch (err) {
      console.error(`admin elf doors ${what} failed:`, err instanceof Error ? err.message : err);
      return res.status(500).json(UNAVAILABLE);
    }
  };
}

const noDoor = (res: Response, door: number) => res.status(404).json({ error: `There is no door ${door}.` });

// ---- reading ---------------------------------------------------------------------------------------

export const getAdminElfDoors = async (req: Request, res: Response): Promise<Response | void> => {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "view");
  if (!claims) return;
  try {
    const { year } = await getElfSettings();
    const now = new Date();
    await ensureElfDoors(year);
    const [rows, perms] = await Promise.all([listElfDoors(year), loadEffectivePermissions(claims.sub)]);
    const withPicture = rows.map((setup) => ({ setup, hasPicture: doorPicture(year, setup.door) !== null }));
    const tiles: DoorTile[] = withPicture.map(({ setup, hasPicture }) => {
      const r = readinessOf(setup, hasPicture);
      const started = eveningState(year, setup, now).clueOut[0];
      return { door: setup.door, weekday: doorWeekday(year, setup.door), placeName: setup.placeName, ready: r.ready, toDo: r.toDo, started };
    });
    return res.status(200).json({
      year,
      doors: tiles,
      counts: doorsSummary(withPicture),
      prizeList: prizeListText(rows),
      canEdit: !!perms && can(perms, "elf", "edit"),
    });
  } catch (err) {
    console.error("admin elf doors failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
};

export const getAdminElfDoor = async (req: Request, res: Response): Promise<Response | void> => {
  res.setHeader("Cache-Control", "no-store");
  const claims = await authorizeSection(req, res, "elf", "view");
  if (!claims) return;
  const raw = String((req.params as Record<string, unknown> | undefined)?.door ?? "");
  const n = /^[1-9]\d?$/.test(raw) ? Number(raw) : NaN;
  if (!isDoor(n)) return res.status(400).json(NO_SUCH_DOOR);
  try {
    const { year } = await getElfSettings();
    const [d, perms] = await Promise.all([getElfDoor(year, n), loadEffectivePermissions(claims.sub)]);
    if (!d) return noDoor(res, n);
    return res.status(200).json({ door: sheetOf(year, d, new Date()), canEdit: !!perms && can(perms, "elf", "edit") });
  } catch (err) {
    console.error("admin elf doors door failed:", err instanceof Error ? err.message : err);
    return res.status(500).json(UNAVAILABLE);
  }
};

// ---- the details -----------------------------------------------------------------------------------

/** Blank words are nothing (null). */
const blankIsNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const text = (max: number, label: string) =>
  z.preprocess(blankIsNull, z.string({ invalid_type_error: BAD_REQUEST }).trim().max(max, `${label} can be up to ${max} characters.`).nullable().optional());

const clockTime = (label: string) =>
  z.preprocess(
    blankIsNull,
    z.string({ invalid_type_error: BAD_REQUEST }).trim().refine((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s), `${label} must be a time such as 17:30.`).nullable().optional(),
  );

const doorSchema = z
  .object({
    placeName: text(80, "The place name"),
    placeTown: text(60, "The town"),
    placeAddress: text(200, "The address"),
    contactName: text(80, "The contact name"),
    contactPhone: phoneSchema.optional(),
    contactEmail: z.preprocess(
      blankIsNull,
      z.string({ invalid_type_error: BAD_REQUEST }).trim().max(254, "The contact email can be up to 254 characters.").email("That email does not look right.").nullable().optional(),
    ),
    closesAt: clockTime("The closing time"),
    elfSpot: text(200, "The elf's spot"),
    agreedBy: text(80, "Agreed by"),
    prize: text(200, "The prize"),
    prizeShowOff: z.boolean({ invalid_type_error: BAD_REQUEST }).optional(),
    elfName: text(30, "The elf's name"),
    clue1Time: clockTime("Clue 1's time"),
    clue2Time: clockTime("Clue 2's time"),
    clue3Time: clockTime("Clue 3's time"),
    revealTime: clockTime("The time the place is shown"),
  })
  .strict();

const TIME_KEYS = ["clue1Time", "clue2Time", "clue3Time", "revealTime"] as const;
const minutesOf = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock5 = (t: string | null | undefined): string | null => (isClockTime(t) ? t.slice(0, 5) : null);

export const patchAdminElfDoor = guarded("change", "edit", async ({ req, res, actor, year, now, door }) => {
  const parsed = doorSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]) });
  const change: DoorChange = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) (change as Record<string, unknown>)[k] = v;
  }
  const stored = await getElfDoor(year, door);
  if (!stored) return noDoor(res, door);
  // Nothing to change: write nothing, audit nothing, and answer the door as it is.
  if (Object.keys(change).length === 0) return res.status(200).json({ door: sheetOf(year, stored, now) });
  if ("placeName" in change && change.placeName === null && eveningState(year, stored, now).clueOut[0]) {
    return res.status(409).json({ error: `Door ${door}'s evening has started, so its place must keep a name.` });
  }
  const timeChanged = TIME_KEYS.some((k) => k in change && clock5(change[k]) !== clock5(stored[k]));
  if (timeChanged && eveningState(year, stored, now).clueOut[0]) {
    return res.status(409).json({ error: `Door ${door}'s evening has started, so its times cannot change.` });
  }
  if (TIME_KEYS.some((k) => k in change)) {
    const merged: DoorSetup = { ...stored, ...change };
    const first = eveningFor(doorSeason(year), door, staffEveningOf(merged)).problems[0];
    if (first) return res.status(400).json({ error: EVENING_PROBLEM_WORDS[first] });
    if (door === DOOR_COUNT && minutesOf(eveningFor(doorSeason(year), door, staffEveningOf(merged)).reveal) > minutesOf(LAST_REVEAL_TIME)) {
      return res.status(400).json({ error: "On Christmas Eve the place must be shown by 8pm." });
    }
  }
  const d = await changeElfDoor(year, door, change, actor);
  return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
});

// ---- names -----------------------------------------------------------------------------------------

const nameSchema = z.object({ name: z.string({ invalid_type_error: BAD_REQUEST }).trim().max(80, "A name can be up to 80 characters.") }).strict();

export const postAdminElfDoorName = guarded("name add", "edit", async ({ req, res, actor, year, now, door }) => {
  const parsed = nameSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]) });
  if (normalisePlaceName(parsed.data.name) === "") return res.status(400).json({ error: "A name needs at least one letter or number." });
  const d = await addElfDoorName(year, door, parsed.data.name, actor);
  if (d === "taken") return res.status(409).json({ error: "That name already counts for this door." });
  return d ? res.status(201).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
});

export const deleteAdminElfDoorName = guarded("name remove", "edit", async ({ req, res, actor, year, now, door }) => {
  const raw = String((req.params as Record<string, unknown> | undefined)?.id ?? "");
  if (!/^[1-9]\d{0,8}$/.test(raw)) return res.status(400).json({ error: BAD_REQUEST });
  const stored = await getElfDoor(year, door);
  if (!stored) return noDoor(res, door);
  if (eveningState(year, stored, now).clueOut[0]) {
    return res.status(409).json({ error: `Door ${door}'s evening has started, so names that count can only be added now.` });
  }
  if (!stored.names.some((x) => x.id === Number(raw))) return res.status(404).json({ error: `There is no name like that on door ${door}.` });
  const d = await removeElfDoorName(year, door, Number(raw), actor);
  return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
});

// ---- the word --------------------------------------------------------------------------------------

const wordSchema = z.object({ confirm: z.boolean({ invalid_type_error: BAD_REQUEST }).optional() }).strict();

export const postAdminElfDoorWord = guarded("word", "edit", async ({ req, res, actor, year, now, door }) => {
  const parsed = wordSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]) });
  const stored = await getElfDoor(year, door);
  if (!stored) return noDoor(res, door);
  if (eveningState(year, stored, now).clueOut[0]) {
    return res.status(409).json({ error: `Door ${door}'s elf is out, so its word cannot change.` });
  }
  if (stored.tagPrintedAt && parsed.data.confirm !== true) {
    return res.status(409).json({ error: "This door's tag has been printed. Make a new word only if you will print the tag again.", printed: true });
  }
  const d = await setElfTagWord(year, door, makeTagWord(), actor);
  return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
});

// ---- the ticks -------------------------------------------------------------------------------------

function tick(which: "droppedOff" | "thanked", on: boolean) {
  return guarded(`${which} ${on ? "tick" : "untick"}`, "edit", async ({ res, actor, year, now, door }) => {
    const d = await tickElfDoor(year, door, which, on, actor);
    return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
  });
}
export const postAdminElfDoorDroppedOff = tick("droppedOff", true);
export const deleteAdminElfDoorDroppedOff = tick("droppedOff", false);
export const postAdminElfDoorThanked = tick("thanked", true);
export const deleteAdminElfDoorThanked = tick("thanked", false);

// ---- a snow day, and gone home ------------------------------------------------------------------------

/** Calling a door off (a snow day) is only before its clue 1; the stored automatic one reads the same. */
function snowDay(on: boolean) {
  return guarded(`snow day ${on ? "call" : "cancel"}`, "edit", async ({ res, actor, year, now, door }) => {
    const stored = await getElfDoor(year, door);
    if (!stored) return noDoor(res, door);
    if (eveningState(year, stored, now).clueOut[0]) {
      return res.status(409).json({
        error: on ? `Door ${door}'s evening has started, so it cannot be called off now.` : `Door ${door}'s evening has started, so its snow day cannot be cancelled now.`,
      });
    }
    // Already as asked: nothing to write, and the first caller stays on record.
    if (on === (stored.snowDayAt !== null)) return res.status(200).json({ door: sheetOf(year, stored, now) });
    const d = await tickElfDoor(year, door, "snowDay", on, actor);
    return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
  });
}
export const postAdminElfDoorSnowDay = snowDay(true);
export const deleteAdminElfDoorSnowDay = snowDay(false);

/** Gone home is for after the door's day: the place has stopped hosting the elf. */
function goneHome(on: boolean) {
  return guarded(`gone home ${on ? "tick" : "untick"}`, "edit", async ({ res, actor, year, now, door }) => {
    if (!dayIsOver(year, door, now)) return res.status(409).json({ error: `Gone home is for after door ${door}'s day.` });
    const d = await tickElfDoor(year, door, "goneHome", on, actor);
    return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
  });
}
export const postAdminElfDoorGoneHome = goneHome(true);
export const deleteAdminElfDoorGoneHome = goneHome(false);

// ---- one clue --------------------------------------------------------------------------------------

const clueSchema = z.object({ words: z.string({ invalid_type_error: BAD_REQUEST }).nullable() }).strict();
const clueOutWords = (door: number, n: number) => `Door ${door}, clue ${n} is already out, so it cannot be changed.`;

export const putAdminElfDoorClue = guarded("clue", "edit", async ({ req, res, actor, year, now, door }) => {
  const rawN = String((req.params as Record<string, unknown> | undefined)?.n ?? "");
  if (rawN !== "1" && rawN !== "2" && rawN !== "3") return res.status(400).json({ error: BAD_REQUEST });
  const n = Number(rawN) as ClueN;
  const parsed = clueSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]) });
  const trimmed = parsed.data.words === null ? null : parsed.data.words.trim();
  if (trimmed !== null && trimmed.length > CLUE_WORDS_MAX) return res.status(400).json({ error: "A clue can be up to 500 characters." });
  const stored = await getElfDoor(year, door);
  if (!stored) return noDoor(res, door);
  if (eveningState(year, stored, now).clueOut[n - 1]) return res.status(409).json({ error: clueOutWords(door, n) });
  const d = await saveElfClue(year, door, n, trimmed === "" ? null : trimmed, actor);
  return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
}, true);

// ---- one clue's picture ----------------------------------------------------------------------------

/** The address of a clue's picture. The 4 MB JSON limit for the PUT is set on it in src/app.ts. */
export const ELF_CLUE_PICTURE_PATH = "/api/admin/elf/doors/:door/clues/:n/picture";

const ALT_WORDS = "Describe the picture in a few words, for anyone who cannot see it.";
const ALT_MAX = 200;
// The same sentences the fundraisers' picture route gives for a picture that will not do.
const LOOK_AGAIN = "Your picture needs another look";
const PHOTO_TYPE = "That picture is not one we can use. Try a JPG, PNG or WebP photo.";
const PHOTO_SIZE = "That picture is too big. Try a smaller one.";
const PHOTO_READ = "We could not open that picture. Please try a different photo.";
const PHOTO_BUSY = "Lots of pictures arriving just now. Please try again in a minute.";

const picturePutSchema = z
  .object({
    mime: z.string({ invalid_type_error: BAD_REQUEST }).min(1).max(100),
    dataBase64: z.string({ invalid_type_error: BAD_REQUEST }).min(1),
    alt: z.string({ required_error: ALT_WORDS, invalid_type_error: ALT_WORDS }),
  })
  .strict();

/** The clue number in the address (1, 2 or 3), or null. */
function clueNOf(req: Request): ClueN | null {
  const raw = String((req.params as Record<string, unknown> | undefined)?.n ?? "");
  return raw === "1" || raw === "2" || raw === "3" ? (Number(raw) as ClueN) : null;
}

export const putAdminElfDoorCluePicture = guarded("clue picture", "edit", async ({ req, res, actor, year, now, door }) => {
  const n = clueNOf(req);
  if (n === null) return res.status(400).json({ error: BAD_REQUEST });
  const parsed = picturePutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const missing = parsed.error.issues.some((i) => i.path[0] === "alt");
    return res.status(400).json({ error: missing ? ALT_WORDS : sentenceOr(parsed.error.issues[0]) });
  }
  const alt = parsed.data.alt.trim();
  if (alt === "") return res.status(400).json({ error: ALT_WORDS });
  if (alt.length > ALT_MAX) return res.status(400).json({ error: `Keep the description to ${ALT_MAX} characters or fewer.` });
  const stored = await getElfDoor(year, door);
  if (!stored) return noDoor(res, door);
  if (eveningState(year, stored, now).clueOut[n - 1]) return res.status(409).json({ error: clueOutWords(door, n) });
  const bytes = decodeBase64(parsed.data.dataBase64);
  const check = checkPictureUpload(parsed.data.mime, bytes);
  if (!check.ok) {
    const size = check.reason === "size";
    return res.status(size ? 413 : 400).json({ error: LOOK_AGAIN, fields: { photo: size ? PHOTO_SIZE : PHOTO_TYPE } });
  }
  const made = await processPicture("main", bytes);
  if (!made.ok && made.reason === "busy") return res.status(503).json({ error: PHOTO_BUSY });
  if (!made.ok && made.reason === "size") return res.status(413).json({ error: LOOK_AGAIN, fields: { photo: PHOTO_SIZE } });
  if (!made.ok) return res.status(400).json({ error: LOOK_AGAIN, fields: { photo: PHOTO_READ } });
  const d = await saveElfCluePicture(year, door, n, { mime: made.mime, bytes: made.bytes, width: made.width, height: made.height }, alt, actor);
  return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
});

export const deleteAdminElfDoorCluePicture = guarded("clue picture off", "edit", async ({ req, res, actor, year, now, door }) => {
  const n = clueNOf(req);
  if (n === null) return res.status(400).json({ error: BAD_REQUEST });
  const stored = await getElfDoor(year, door);
  if (!stored) return noDoor(res, door);
  if (eveningState(year, stored, now).clueOut[n - 1]) return res.status(409).json({ error: clueOutWords(door, n) });
  const d = await removeElfCluePicture(year, door, n, actor);
  return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
});

export const getAdminElfDoorCluePicture = guarded("clue picture look", "view", async ({ req, res, year, door }) => {
  const n = clueNOf(req);
  if (n === null) return res.status(400).json({ error: BAD_REQUEST });
  const found = await cluePicture(year, door, n);
  if (!found) return res.status(404).json({ error: "There is no picture on that clue." });
  res.setHeader("Content-Type", found.mime);
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(found.bytes);
});

// ---- every clue pasted at once ---------------------------------------------------------------------

const pasteSchema = z.object({ text: z.string({ invalid_type_error: BAD_REQUEST }).max(60000, "The text can be up to 60,000 characters.") }).strict();

/** Parses a pasted file against the year's doors: what it holds, and everything wrong with it. */
async function checkPaste(year: number, input: string, now: Date): Promise<{ doors: (PastedDoor & { placeName: string | null })[]; problems: PasteProblem[]; pasted: PastedDoor[] }> {
  const rows = await listElfDoors(year);
  const byDoor = new Map(rows.map((d) => [d.door, d]));
  const result = parseCluePaste(input);
  const out = pasteAgainstDoors(result, (door, n) => {
    const d = byDoor.get(door);
    return d ? eveningState(year, d, now).clueOut[n - 1] : false;
  });
  const problems = [...result.problems, ...out].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { doors: result.doors.map((p) => ({ ...p, placeName: byDoor.get(p.door)?.placeName ?? null })), problems, pasted: result.doors };
}

export const postAdminElfCluesCheck = guarded("clues check", "edit", async ({ req, res, year, now }) => {
  const parsed = pasteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]) });
  const checked = await checkPaste(year, parsed.data.text, now);
  return res.status(200).json({ doors: checked.doors, problems: checked.problems });
}, false);

export const postAdminElfCluesSave = guarded("clues save", "edit", async ({ req, res, actor, year, now }) => {
  const parsed = pasteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]) });
  await ensureElfDoors(year);
  const checked = await checkPaste(year, parsed.data.text, now);
  if (checked.problems.length > 0) return res.status(400).json({ error: "Fix the problems in the text first.", problems: checked.problems });
  return res.status(200).json(await savePastedClues(year, checked.pasted, actor));
}, false);

// ---- the prints ------------------------------------------------------------------------------------

/** The prints name secret places and words, so they are never cached, indexed or passed on by referrer. */
function privatePage(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
}

const sendPage = (res: Response, status: number, page: string): Response => res.status(status).type("html").send(page);
const notReady = (res: Response, words: string): Response => sendPage(res, 409, materialsMessagePage("Not ready to print", words));
const has = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** A print: the gate first (the usual JSON refusal), then every answer is a secret HTML page. */
function printing(what: string, work: (c: Ctx) => Promise<Response>, needsDoor = true) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    res.setHeader("Cache-Control", "no-store");
    const claims = await authorizeSection(req, res, "elf", "view");
    if (!claims) return;
    let door: Door = 1;
    if (needsDoor) {
      const raw = String((req.params as Record<string, unknown> | undefined)?.door ?? "");
      const n = /^[1-9]\d?$/.test(raw) ? Number(raw) : NaN;
      if (!isDoor(n)) return res.status(400).json(NO_SUCH_DOOR);
      door = n;
    }
    privatePage(res);
    try {
      const settings = await getElfSettings();
      // The year's door rows may not exist yet (Doors not opened): make them, so a print says what to add.
      await ensureElfDoors(settings.year);
      return await work({ req, res, actor: actorOf(claims), settings, year: settings.year, now: new Date(), door });
    } catch (err) {
      console.error(`admin elf doors ${what} failed:`, err instanceof Error ? err.message : err);
      return sendPage(res, 500, materialsMessagePage("Something went wrong", "That could not be printed just now. Try again in a minute."));
    }
  };
}

const firstClueAt = (year: number, d: DoorSetup): Date | null =>
  doorInstant(doorSeason(year), d.door, eveningFor(doorSeason(year), d.door, staffEveningOf(d)).clue1);

const noSuchDoorPage = (res: Response, door: number): Response => sendPage(res, 404, materialsMessagePage("Not ready to print", `There is no door ${door}.`));

export const getAdminElfDoorPoster = printing("poster", async ({ res, year, door }) => {
  const d = await getElfDoor(year, door);
  if (!d) return noSuchDoorPage(res, door);
  if (!has(d.placeName) || !has(d.placeTown)) return notReady(res, `Door ${door} needs its place's name and town before its poster can be printed.`);
  const siteOrigin = String(config.PORTAL_BASE_URL ?? "").replace(/\/+$/, "");
  let page: string;
  try {
    page = renderElfPoster({ placeName: d.placeName, placeTown: d.placeTown, siteOrigin, posterUrl: `${siteOrigin}/elf/p/${d.posterCode}` });
  } catch (err) {
    if (!/^https:\/\//.test(siteOrigin)) return notReady(res, "The poster can only be printed on the live site.");
    throw err;
  }
  return sendPage(res, 200, page);
});

export const getAdminElfDoorStaffCard = printing("staff card", async ({ res, settings, year, door }) => {
  const d = await getElfDoor(year, door);
  if (!d) return noSuchDoorPage(res, door);
  if (!has(d.placeName) || !has(d.elfName)) return notReady(res, `Door ${door} needs its place and its elf's name before its staff card can be printed.`);
  const { placePhone } = settings;
  if (!has(placePhone)) return notReady(res, "Add NBCC's phone number for places in Settings before printing a staff card.");
  const clueAt = firstClueAt(year, d);
  if (!clueAt) throw new Error("no time for clue 1");
  return sendPage(res, 200, renderStaffCard({ placeName: d.placeName, door, elfName: d.elfName, clueAt, phone: placePhone }));
});

export const getAdminElfDoorTag = printing("tag", async ({ res, actor, year, door }) => {
  const d = await getElfDoor(year, door);
  if (!d) return noSuchDoorPage(res, door);
  if (!has(d.elfName) || !has(d.tagWord) || !isUsableSecretWord(d.tagWord)) return notReady(res, `Door ${door} needs its elf's name before its tag can be printed.`);
  const page = renderElfTag({ elfName: d.elfName, secretWord: d.tagWord });
  try {
    await markElfTagPrinted(year, door, actor);
  } catch (err) {
    // The tag was made; failing to note it as printed must not turn a good print into an error.
    console.error("admin elf doors tag printed note failed:", err instanceof Error ? err.message : err);
  }
  return sendPage(res, 200, page);
});

export const getAdminElfPlacesList = printing(
  "places list",
  async ({ res, year }) => {
    const rows = await listElfDoors(year);
    const entries = rows.flatMap((d) => {
      const clueAt = firstClueAt(year, d);
      return clueAt
        ? [{ door: d.door, clueAt, placeName: d.placeName, placeTown: d.placeTown, placeAddress: d.placeAddress, contactName: d.contactName, contactPhone: d.contactPhone }]
        : [];
    });
    return sendPage(res, 200, renderPlacesList(year, entries));
  },
  false,
);

adminElfDoorsRouter.get("/api/admin/elf/doors", getAdminElfDoors);
adminElfDoorsRouter.get("/api/admin/elf/doors/:door", getAdminElfDoor);
adminElfDoorsRouter.patch("/api/admin/elf/doors/:door", patchAdminElfDoor);
adminElfDoorsRouter.post("/api/admin/elf/doors/:door/names", postAdminElfDoorName);
adminElfDoorsRouter.delete("/api/admin/elf/doors/:door/names/:id", deleteAdminElfDoorName);
adminElfDoorsRouter.post("/api/admin/elf/doors/:door/word", postAdminElfDoorWord);
adminElfDoorsRouter.post("/api/admin/elf/doors/:door/dropped-off", postAdminElfDoorDroppedOff);
adminElfDoorsRouter.delete("/api/admin/elf/doors/:door/dropped-off", deleteAdminElfDoorDroppedOff);
adminElfDoorsRouter.post("/api/admin/elf/doors/:door/thanked", postAdminElfDoorThanked);
adminElfDoorsRouter.delete("/api/admin/elf/doors/:door/thanked", deleteAdminElfDoorThanked);
adminElfDoorsRouter.post("/api/admin/elf/doors/:door/snow-day", postAdminElfDoorSnowDay);
adminElfDoorsRouter.delete("/api/admin/elf/doors/:door/snow-day", deleteAdminElfDoorSnowDay);
adminElfDoorsRouter.post("/api/admin/elf/doors/:door/gone-home", postAdminElfDoorGoneHome);
adminElfDoorsRouter.delete("/api/admin/elf/doors/:door/gone-home", deleteAdminElfDoorGoneHome);
adminElfDoorsRouter.put("/api/admin/elf/doors/:door/clues/:n", putAdminElfDoorClue);
adminElfDoorsRouter.put(ELF_CLUE_PICTURE_PATH, putAdminElfDoorCluePicture);
adminElfDoorsRouter.delete(ELF_CLUE_PICTURE_PATH, deleteAdminElfDoorCluePicture);
adminElfDoorsRouter.get(ELF_CLUE_PICTURE_PATH, getAdminElfDoorCluePicture);
adminElfDoorsRouter.post("/api/admin/elf/clues/check", postAdminElfCluesCheck);
adminElfDoorsRouter.post("/api/admin/elf/clues/save", postAdminElfCluesSave);
adminElfDoorsRouter.get("/api/admin/elf/doors/:door/poster", getAdminElfDoorPoster);
adminElfDoorsRouter.get("/api/admin/elf/doors/:door/staff-card", getAdminElfDoorStaffCard);
adminElfDoorsRouter.get("/api/admin/elf/doors/:door/tag", getAdminElfDoorTag);
adminElfDoorsRouter.get("/api/admin/elf/places-list", getAdminElfPlacesList);
