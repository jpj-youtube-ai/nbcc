import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, loadEffectivePermissions } from "./admin-authz";
import { actorOf } from "./admin";
import { phoneSchema } from "./admin-elf";
import { can } from "../admin/permissions";
import { config } from "../config";
import { getElfSettings } from "../db/elf";
import {
  addElfDoorName,
  changeElfDoor,
  ensureElfDoors,
  getElfDoor,
  listElfDoors,
  removeElfDoorName,
  saveElfClue,
  savePastedClues,
  setElfTagWord,
  tickElfDoor,
  type DoorChange,
} from "../db/elf-doors";
import { doorInstant, eveningFor, EVENING_PROBLEM_WORDS, closesTooSoon, isClockTime, isDoor, type Door, type Evening } from "../elf/calendar";
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
//   PUT    /api/admin/elf/doors/:door/clues/:n            one clue (edit)
//   POST   /api/admin/elf/clues/check and /save           every clue pasted at once (edit)
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
}

interface Ctx {
  req: Request;
  res: Response;
  actor: string;
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
  };
}

const sentenceOr = (message: string | undefined): string => (message && /^[A-Z]/.test(message) ? message : BAD_REQUEST);

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
      return await work({ req, res, actor: actorOf(claims), year: settings.year, now: new Date(), door });
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
    await ensureElfDoors(year);
    const [rows, perms] = await Promise.all([listElfDoors(year), loadEffectivePermissions(claims.sub)]);
    const withPicture = rows.map((setup) => ({ setup, hasPicture: doorPicture(year, setup.door) !== null }));
    const tiles: DoorTile[] = withPicture.map(({ setup, hasPicture }) => {
      const r = readinessOf(setup, hasPicture);
      return { door: setup.door, weekday: doorWeekday(year, setup.door), placeName: setup.placeName, ready: r.ready, toDo: r.toDo };
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
    console.error("admin elf door failed:", err instanceof Error ? err.message : err);
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
const clock5 = (t: string | null | undefined): string | null => (isClockTime(t) ? t.slice(0, 5) : null);

export const patchAdminElfDoor = guarded("change", "edit", async ({ req, res, actor, year, now, door }) => {
  const parsed = doorSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]?.message) });
  const change: DoorChange = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) (change as Record<string, unknown>)[k] = v;
  }
  const stored = await getElfDoor(year, door);
  if (!stored) return noDoor(res, door);
  const timeChanged = TIME_KEYS.some((k) => k in change && clock5(change[k]) !== clock5(stored[k]));
  if (timeChanged && eveningState(year, stored, now).clueOut[0]) {
    return res.status(409).json({ error: `Door ${door}'s evening has started, so its times cannot change.` });
  }
  if (TIME_KEYS.some((k) => k in change)) {
    const merged: DoorSetup = { ...stored, ...change };
    const first = eveningFor(doorSeason(year), door, staffEveningOf(merged)).problems[0];
    if (first) return res.status(400).json({ error: EVENING_PROBLEM_WORDS[first] });
  }
  const d = await changeElfDoor(year, door, change, actor);
  return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
});

// ---- names -----------------------------------------------------------------------------------------

const nameSchema = z.object({ name: z.string({ invalid_type_error: BAD_REQUEST }).trim().max(80, "A name can be up to 80 characters.") }).strict();

export const postAdminElfDoorName = guarded("name add", "edit", async ({ req, res, actor, year, now, door }) => {
  const parsed = nameSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]?.message) });
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
  const d = await removeElfDoorName(year, door, Number(raw), actor);
  return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
});

// ---- the word --------------------------------------------------------------------------------------

const wordSchema = z.object({ confirm: z.boolean({ invalid_type_error: BAD_REQUEST }).optional() }).strict();

export const postAdminElfDoorWord = guarded("word", "edit", async ({ req, res, actor, year, now, door }) => {
  const parsed = wordSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]?.message) });
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

// ---- one clue --------------------------------------------------------------------------------------

const clueSchema = z.object({ words: z.string({ invalid_type_error: BAD_REQUEST }).nullable() }).strict();
const clueOutWords = (door: number, n: number) => `Door ${door}, clue ${n} is already out, so it cannot be changed.`;

export const putAdminElfDoorClue = guarded("clue", "edit", async ({ req, res, actor, year, now, door }) => {
  const rawN = String((req.params as Record<string, unknown> | undefined)?.n ?? "");
  if (rawN !== "1" && rawN !== "2" && rawN !== "3") return res.status(400).json({ error: BAD_REQUEST });
  const n = Number(rawN) as ClueN;
  const parsed = clueSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]?.message) });
  const trimmed = parsed.data.words === null ? null : parsed.data.words.trim();
  if (trimmed !== null && trimmed.length > CLUE_WORDS_MAX) return res.status(400).json({ error: "A clue can be up to 500 characters." });
  const stored = await getElfDoor(year, door);
  if (!stored) return noDoor(res, door);
  if (eveningState(year, stored, now).clueOut[n - 1]) return res.status(409).json({ error: clueOutWords(door, n) });
  const d = await saveElfClue(year, door, n, trimmed === "" ? null : trimmed, actor);
  return d ? res.status(200).json({ door: sheetOf(year, d, now) }) : noDoor(res, door);
}, true);

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
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]?.message) });
  const checked = await checkPaste(year, parsed.data.text, now);
  return res.status(200).json({ doors: checked.doors, problems: checked.problems });
}, false);

export const postAdminElfCluesSave = guarded("clues save", "edit", async ({ req, res, actor, year, now }) => {
  const parsed = pasteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: sentenceOr(parsed.error.issues[0]?.message) });
  await ensureElfDoors(year);
  const checked = await checkPaste(year, parsed.data.text, now);
  if (checked.problems.length > 0) return res.status(400).json({ error: "Fix the problems in the text first.", problems: checked.problems });
  return res.status(200).json(await savePastedClues(year, checked.pasted, actor));
}, false);

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
adminElfDoorsRouter.put("/api/admin/elf/doors/:door/clues/:n", putAdminElfDoorClue);
adminElfDoorsRouter.post("/api/admin/elf/clues/check", postAdminElfCluesCheck);
adminElfDoorsRouter.post("/api/admin/elf/clues/save", postAdminElfCluesSave);
