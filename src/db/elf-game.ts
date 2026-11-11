import { pool } from "./pool";
import { insertAudit, writeWithAudit } from "./donations";
import { ensureElfDoors, findElfDoorByPosterCode, getElfDoor, listElfDoors } from "./elf-doors";
import { getPractice, markPracticeFound, clearPractice, inTransaction } from "./elf-practice";
import type { MadePicture } from "./fundraiser-pictures";
import { closingInstant, doorInstant, DOOR_COUNT, eveningFor, type Door } from "../elf/calendar";
import { doorSeason, emptyDoor, staffEveningOf, type DoorSetup } from "../elf/door-setup";
import { doorState, openedAt, type DoorFacts, type DoorState } from "../elf/doors";
import { isUsableSecretWord } from "../elf/claim";
import { cracked, type SavedGuess } from "../elf/guess";
import { makePosterCode } from "../elf/door-codes";
import { ELF_NAMES, type DetectiveNameParts } from "../elf/names";
import { PRACTICE_CLUES } from "../elf/practice-words";
import type { DoorsDone } from "../elf/progress";
import { orderScrapbook, type ScrapElf, type ScrapPhoto, type Scrapbook } from "../elf/scrapbook";
import type { ElfSettings } from "../elf/settings";

// NBCC Elf Detective School wave 2: the game's data layer (tables in migrations/
// 1791200000440_elf-game.js) and the one loader every family route reads through. The design is
// docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md. The rules are pure, in src/elf/;
// this file reads and writes the rows and builds each door's `DoorRun`. The SQL is proved against a
// real database in CI. Families whose removed_at is set are left out of every count, scrapbook and
// finder line.

const HOUR_MS = 60 * 60 * 1000;
/** The most photos a family may send in 24 hours. */
export const PHOTOS_A_DAY = 5;

export interface DoorRun {
  year: number;
  /** 1 to 24, or 0 for the practice door. */
  door: Door | 0;
  facts: DoorFacts;
  /** The time the calendar shows for the door's first clue: the door's real clue 1 instant on a wave 1
   *  run (whose facts.clue1At may be held in the far future to keep it shut), facts.clue1At otherwise. */
  calendarAt: Date;
  /** The door's state at the `now` it was loaded for. */
  state: DoorState;
  placeName: string | null;
  placeTown: string | null;
  /** Every name the place counts as: its own, then the others. */
  names: string[];
  contactEmail: string | null;
  /** The clock time the place closes, as staff set it; null when none is set. */
  closesAt: string | null;
  tagWord: string | null;
  elfName: string;
  prize: string | null;
  prizeShowOff: boolean;
  posterCode: string;
  clues: { n: 1 | 2 | 3; words: string | null; hasPicture: boolean; pictureAlt: string | null; at: Date }[];
  foundFamilyId: number | null;
}

const filled = (s: string | null | undefined): s is string => typeof s === "string" && s.trim() !== "";

// ---- turning rows into runs ---------------------------------------------------------------------------

/** One door as it runs: its four instants, its state at `now`, and what it may show once open. `year`
 *  is the December the door belongs to. The live state never guesses a snow day: only a stored
 *  `snowDayAt` makes one. */
export function runOf(year: number, setup: DoorSetup, now: Date): DoorRun {
  const season = doorSeason(year);
  const evening = eveningFor(season, setup.door, staffEveningOf(setup));
  const bad = new Date(NaN);
  const clue1At = doorInstant(season, setup.door, evening.clue1) ?? bad;
  const clue2At = doorInstant(season, setup.door, evening.clue2) ?? bad;
  const clue3At = doorInstant(season, setup.door, evening.clue3) ?? bad;
  const revealAt = doorInstant(season, setup.door, evening.reveal) ?? bad;
  // A closing time that cannot be read must never leave a door hunting for ever: an hour after the
  // reveal, as the practice door does.
  const closesAt = closingInstant(season, setup.door, evening.clue1, setup.closesAt) ?? new Date(revealAt.getTime() + HOUR_MS);
  const facts: DoorFacts = {
    clue1At,
    clue2At,
    clue3At,
    revealAt,
    closesAt,
    foundAt: setup.foundAt,
    snowDay: setup.snowDayAt !== null,
    goneHome: setup.goneHomeAt !== null,
  };
  const names = [setup.placeName, ...setup.names.map((n) => n.name)].filter(filled);
  return {
    year,
    door: setup.door,
    facts,
    calendarAt: clue1At,
    state: doorState(facts, now),
    placeName: setup.placeName,
    placeTown: setup.placeTown,
    names,
    contactEmail: setup.contactEmail,
    closesAt: setup.closesAt,
    tagWord: setup.tagWord,
    elfName: filled(setup.elfName) ? setup.elfName : ELF_NAMES[setup.door - 1],
    prize: setup.prize,
    prizeShowOff: setup.prizeShowOff,
    posterCode: setup.posterCode,
    clues: setup.clues.map((c) => ({
      n: c.n,
      words: c.words,
      hasPicture: c.hasPicture,
      pictureAlt: c.pictureAlt,
      at: c.n === 1 ? clue1At : c.n === 2 ? clue2At : clue3At,
    })),
    foundFamilyId: setup.foundFamilyId,
  };
}

/** Can this door run its evening? A place, a usable tag word and a first clue (words or a picture). */
export function canRun(setup: DoorSetup): boolean {
  const first = setup.clues.find((c) => c.n === 1);
  return filled(setup.placeName) && isUsableSecretWord(setup.tagWord ?? "") && (filled(first?.words) || first?.hasPicture === true);
}

/** The 24 doors as wave 1 showed them: shut, countdowns only, the stock elves, nothing else. */
export function waveOneRuns(year: number, now: Date): DoorRun[] {
  const FAR_FUTURE = new Date(8.64e15);
  const runs: DoorRun[] = [];
  for (let door = 1; door <= DOOR_COUNT; door++) {
    const run = runOf(year, emptyDoor(door as Door, ""), now);
    // A default clue 1 that is already past is held shut, so only a countdown can show.
    const facts: DoorFacts = run.facts.clue1At.getTime() <= now.getTime() ? { ...run.facts, clue1At: FAR_FUTURE } : run.facts;
    // calendarAt stays the door's real default clue 1 instant, so the calendar can show it.
    runs.push({ ...run, facts, calendarAt: run.facts.clue1At, state: doorState(facts, now), clues: [], names: [], tagWord: null });
  }
  return runs;
}

// ---- snow days ----------------------------------------------------------------------------------------

/** Thrown inside the snow day write when the door was marked already, so its transaction rolls back. */
class AlreadyMarked extends Error {}

/** Snows in every door whose clue 1 time has come and which cannot run (no place, no usable tag word,
 *  or no first clue), stamped from its clue 1 instant. Answers the doors marked. */
export async function markAutomaticSnowDays(year: number, now: Date): Promise<Door[]> {
  const marked: Door[] = [];
  for (const setup of await listElfDoors(year)) {
    if (setup.snowDayAt !== null) continue;
    const clue1 = runOf(year, setup, now).facts.clue1At;
    if (Number.isNaN(clue1.getTime()) || clue1.getTime() > now.getTime() || canRun(setup)) continue;
    const done = await writeWithAudit(
      async (client) => {
        const r = await client.query(
          `UPDATE elf_doors SET snow_day_at = $1, snow_day_by = 'automatic', updated_at = now()
            WHERE year = $2 AND door = $3 AND snow_day_at IS NULL`,
          [clue1, year, setup.door],
        );
        if ((r.rowCount ?? 0) === 0) throw new AlreadyMarked();
        return true;
      },
      () => ({ actor: "system", action: "elf.door.snow_day", entity: "elf_door", entityId: setup.door, data: { year, door: setup.door, automatic: true } }),
    ).catch((err) => {
      // Another writer snowed it in first: nothing was changed, and nothing is audited.
      if (err instanceof AlreadyMarked) return false;
      throw err;
    });
    if (done) marked.push(setup.door);
  }
  return marked;
}

// ---- loading runs -------------------------------------------------------------------------------------

/** The year's 24 doors, read without adding any rows. A door with no row reads as an empty door. */
export async function loadDoorRuns(year: number, now: Date): Promise<DoorRun[]> {
  const have = new Map((await listElfDoors(year)).map((d) => [d.door, d]));
  const runs: DoorRun[] = [];
  for (let door = 1; door <= DOOR_COUNT; door++) {
    const setup = have.get(door as Door) ?? emptyDoor(door as Door, "");
    runs.push(runOf(year, setup, now));
  }
  return runs;
}

/** One door; a door with no row reads as an empty door. */
export async function loadDoorRun(year: number, door: Door, now: Date): Promise<DoorRun> {
  const setup = (await getElfDoor(year, door)) ?? emptyDoor(door, "");
  return runOf(year, setup, now);
}

/** The door of `year` whose poster carries this code, or null: an empty code, or another year's door,
 *  is never matched (the practice door's code is matched by loadPractice). */
export async function loadDoorRunByPosterCode(code: string, year: number, now: Date): Promise<DoorRun | null> {
  if (code === "") return null;
  const found = await findElfDoorByPosterCode(code);
  if (!found || found.year !== year || found.setup.posterCode === "") return null;
  return runOf(year, found.setup, now);
}

/** The practice door as door 0 of year 0, or null when none is set. Its times are absolute. */
export async function loadPractice(now: Date): Promise<DoorRun | null> {
  const p = await getPractice();
  if (!p) return null;
  const facts: DoorFacts = {
    clue1At: p.clue1At,
    clue2At: p.clue2At,
    clue3At: p.clue3At,
    revealAt: p.revealAt,
    closesAt: new Date(p.revealAt.getTime() + HOUR_MS),
    foundAt: p.foundAt,
    snowDay: false,
    goneHome: false,
  };
  return {
    year: 0,
    door: 0,
    facts,
    calendarAt: p.clue1At,
    state: doorState(facts, now),
    placeName: p.placeName,
    placeTown: p.placeTown,
    names: [p.placeName],
    contactEmail: null,
    closesAt: null,
    tagWord: p.tagWord,
    elfName: p.elfName,
    prize: null,
    prizeShowOff: false,
    posterCode: p.posterCode,
    clues: PRACTICE_CLUES.map((words, i) => ({
      n: (i + 1) as 1 | 2 | 3,
      words,
      hasPicture: false,
      pictureAlt: null,
      at: [p.clue1At, p.clue2At, p.clue3At][i],
    })),
    foundFamilyId: p.foundFamilyId,
  };
}

export interface FamilyRuns {
  runs: DoorRun[];
  practice: DoorRun | null;
}

/** What every family route reads: the real doors when the switch is on, wave 1's shut doors when it is
 *  off, and the practice door only for a browser that holds the preview cookie. */
export async function runsFor(o: { settings: ElfSettings; now: Date; practice: boolean }): Promise<FamilyRuns> {
  const runs = o.settings.doorsOn ? await loadDoorRuns(o.settings.year, o.now) : waveOneRuns(o.settings.year, o.now);
  const practice = o.practice ? await loadPractice(o.now) : null;
  return { runs, practice };
}

// ---- guesses ------------------------------------------------------------------------------------------

interface GuessRow {
  door: number;
  family_id: number;
  text: string;
  norm: string;
  saved_at: Date;
}

const savedGuess = (r: GuessRow): SavedGuess => ({ text: r.text, norm: r.norm, at: r.saved_at });

/** Saves a family's guess for a door, replacing its earlier one. */
export async function saveGuess(year: number, door: number, familyId: number, guess: { text: string; norm: string }, at: Date): Promise<void> {
  await pool.query(
    `INSERT INTO elf_guesses (year, door, family_id, text, norm, saved_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (year, door, family_id) DO UPDATE SET text = EXCLUDED.text, norm = EXCLUDED.norm, saved_at = EXCLUDED.saved_at`,
    [year, door, familyId, guess.text, guess.norm, at],
  );
}

/** A family's guesses, by door. */
export async function familyGuesses(year: number, familyId: number): Promise<Map<number, SavedGuess>> {
  const r = await pool.query<GuessRow>("SELECT door, text, norm, saved_at FROM elf_guesses WHERE year = $1 AND family_id = $2", [year, familyId]);
  return new Map(r.rows.map((row) => [row.door, savedGuess(row)]));
}

/** Every guess for a door, leaving removed families out. */
export async function doorGuesses(year: number, door: number): Promise<{ familyId: number; guess: SavedGuess }[]> {
  const r = await pool.query<GuessRow>(
    `SELECT g.family_id, g.text, g.norm, g.saved_at FROM elf_guesses g
       JOIN elf_families f ON f.id = g.family_id
      WHERE g.year = $1 AND g.door = $2 AND f.removed_at IS NULL`,
    [year, door],
  );
  return r.rows.map((row) => ({ familyId: row.family_id, guess: savedGuess(row) }));
}

// ---- word tries ---------------------------------------------------------------------------------------

/** Counts one more wrong word at a door, and answers how many wrong words the family has typed. */
export async function takeWordTry(year: number, door: number, familyId: number): Promise<number> {
  const r = await pool.query<{ wrong: number }>(
    `INSERT INTO elf_word_tries (year, door, family_id, wrong) VALUES ($1, $2, $3, 1)
     ON CONFLICT (year, door, family_id) DO UPDATE SET wrong = elf_word_tries.wrong + 1, updated_at = now()
     RETURNING wrong`,
    [year, door, familyId],
  );
  return Number(r.rows[0].wrong);
}

/** Gives one wrong word back, never below none. */
export async function giveBackWordTry(year: number, door: number, familyId: number): Promise<void> {
  await pool.query(
    "UPDATE elf_word_tries SET wrong = GREATEST(wrong - 1, 0), updated_at = now() WHERE year = $1 AND door = $2 AND family_id = $3",
    [year, door, familyId],
  );
}

export async function familyWordTries(year: number, familyId: number): Promise<{ door: Door; wrong: number }[]> {
  const r = await pool.query<{ door: number; wrong: number }>("SELECT door, wrong FROM elf_word_tries WHERE year = $1 AND family_id = $2 ORDER BY door", [year, familyId]);
  return r.rows.map((row) => ({ door: row.door as Door, wrong: Number(row.wrong) }));
}

/** A head elf lets a family type words at a door again. */
export async function clearWordTries(year: number, door: number, familyId: number, actor: string): Promise<void> {
  await writeWithAudit(
    (client) => client.query("UPDATE elf_word_tries SET wrong = 0, updated_at = now() WHERE year = $1 AND door = $2 AND family_id = $3", [year, door, familyId]),
    () => ({ actor, action: "elf.word_tries.cleared", entity: "elf_door", entityId: door, data: { year, door, familyId } }),
  );
}

// ---- finding and visiting -----------------------------------------------------------------------------

/** Has the family already won a door this year? (One prize a family.) */
export async function familyHasWon(year: number, familyId: number): Promise<boolean> {
  const r = await pool.query<{ won: boolean }>("SELECT EXISTS (SELECT 1 FROM elf_doors WHERE year = $1 AND found_family_id = $2) AS won", [year, familyId]);
  return r.rows[0]?.won === true;
}

/** The right word typed at a door: one transaction. When the family `won` a real door, the door's
 *  found time is set once under the row lock (rowCount 0 means a family was first, so this is only a
 *  visit). Then each detective's stamp, counting from `at` for the winner and otherwise from the
 *  later of `at` and the time the place is shown. */
export async function recordWord(o: {
  year: number;
  door: Door | 0;
  familyId: number;
  detectiveIds: number[];
  won: boolean;
  shownAt: Date;
  at: Date;
  looks: Record<number, unknown>;
}): Promise<{ won: boolean; countsFrom: Date; stamped: number[] }> {
  return inTransaction(async (client) => {
    let won = o.won;
    if (won && o.door > 0) {
      const claim = await client.query(
        `UPDATE elf_doors SET found_at = $1, found_family_id = $2, updated_at = now()
          WHERE year = $3 AND door = $4 AND found_at IS NULL`,
        [o.at, o.familyId, o.year, o.door],
      );
      won = (claim.rowCount ?? 0) > 0;
    } else if (won) {
      won = await markPracticeFound(o.familyId, o.at, client);
    }
    const countsFrom = won || o.at.getTime() >= o.shownAt.getTime() ? o.at : o.shownAt;
    let stamped: number[] = [];
    if (o.detectiveIds.length > 0) {
      const params: unknown[] = [o.year, o.door, o.familyId, o.at, countsFrom, won];
      const values = o.detectiveIds.map((id) => {
        params.push(id, o.looks[id] === undefined || o.looks[id] === null ? null : JSON.stringify(o.looks[id]));
        return `($1, $2, $3, $${params.length - 1}, $4, $5, $6, $${params.length})`;
      });
      const r = await client.query<{ detective_id: number }>(
        `INSERT INTO elf_visits (year, door, family_id, detective_id, typed_at, counts_from, found, look)
         VALUES ${values.join(", ")}
         ON CONFLICT (year, door, detective_id) DO NOTHING
         RETURNING detective_id`,
        params,
      );
      stamped = r.rows.map((row) => Number(row.detective_id));
    }
    await insertAudit(client, {
      actor: "family",
      action: won ? "elf.door.found" : "elf.door.visited",
      entity: "elf_door",
      entityId: o.door,
      data: { year: o.year, familyId: o.familyId, detectives: stamped.length },
    });
    return { won, countsFrom, stamped };
  });
}

export async function familyVisits(
  year: number,
  familyId: number,
): Promise<{ door: Door | 0; detectiveId: number; countsFrom: Date; found: boolean }[]> {
  const r = await pool.query<{ door: number; detective_id: number; counts_from: Date; found: boolean }>(
    "SELECT door, detective_id, counts_from, found FROM elf_visits WHERE year = $1 AND family_id = $2 ORDER BY door, detective_id",
    [year, familyId],
  );
  return r.rows.map((row) => ({ door: row.door as Door | 0, detectiveId: Number(row.detective_id), countsFrom: row.counts_from, found: row.found }));
}

/** The name parts of the detectives who found the door's elf, leaving a removed family out. */
export async function finderParts(year: number, door: number): Promise<DetectiveNameParts[]> {
  const r = await pool.query<{ first_name: string; surname: string; name_approved: boolean }>(
    `SELECT d.first_name, d.surname, d.name_approved FROM elf_visits v
       JOIN elf_detectives d ON d.id = v.detective_id
       JOIN elf_families f ON f.id = v.family_id
      WHERE v.year = $1 AND v.door = $2 AND v.found AND f.removed_at IS NULL
      ORDER BY d.id`,
    [year, door],
  );
  return r.rows.map((row) => ({ firstName: row.first_name, surname: row.surname, approved: row.name_approved === true }));
}

// ---- doors done ---------------------------------------------------------------------------------------

function crackedBy(run: DoorRun, guess: SavedGuess | undefined, now: Date): boolean {
  return cracked({ state: doorState(run.facts, now), openedAt: openedAt(run.facts, now), names: run.names }, guess ?? null);
}

/** For each of the family's detectives, the doors done at `now`: the family's cracked doors (the same
 *  for each detective), the detective's own stamps that count by now (never the practice door), and the
 *  snowed in doors. */
export async function familyDoorsDone(year: number, familyId: number, runs: DoorRun[], now: Date): Promise<Map<number, DoorsDone>> {
  const [detectives, guesses, visits] = await Promise.all([
    pool.query<{ id: number }>("SELECT id FROM elf_detectives WHERE family_id = $1 AND active ORDER BY id", [familyId]),
    familyGuesses(year, familyId),
    familyVisits(year, familyId),
  ]);
  // A door the runs say is shut shows no progress, whatever rows exist (with the switch off every run is shut).
  const realRuns = runs.filter((r) => r.door > 0 && doorState(r.facts, now) !== "shut");
  const open = new Set<number>(realRuns.map((r) => r.door));
  const crackedDoors = realRuns.filter((r) => crackedBy(r, guesses.get(r.door), now)).map((r) => r.door);
  const snowDoors = realRuns.filter((r) => doorState(r.facts, now) === "snow").map((r) => r.door);
  const out = new Map<number, DoorsDone>();
  for (const d of detectives.rows) {
    const id = Number(d.id);
    const visited = visits
      .filter((v) => v.detectiveId === id && open.has(v.door) && v.countsFrom.getTime() <= now.getTime())
      .map((v) => v.door)
      .sort((a, b) => a - b);
    out.set(id, { cracked: crackedDoors, visited, snow: snowDoors });
  }
  return out;
}

/** One detective's doors done (an empty set for a detective that is not there). */
export async function detectiveDoorsDone(year: number, detectiveId: number, runs: DoorRun[], now: Date): Promise<DoorsDone> {
  const r = await pool.query<{ family_id: number }>("SELECT family_id FROM elf_detectives WHERE id = $1", [detectiveId]);
  const familyId = r.rows[0]?.family_id;
  const none: DoorsDone = { cracked: [], visited: [], snow: [] };
  if (familyId === undefined) return none;
  return (await familyDoorsDone(year, Number(familyId), runs, now)).get(detectiveId) ?? none;
}

/** How many families cracked a door and how many visited it by `now`, leaving removed families out. */
export async function doorCounts(year: number, door: number, now: Date, run: DoorRun): Promise<{ cracked: number; visited: number }> {
  const guesses = await doorGuesses(year, door);
  const crackedCount = guesses.filter((g) => crackedBy(run, g.guess, now)).length;
  const r = await pool.query<{ n: string }>(
    `SELECT count(DISTINCT v.family_id) AS n FROM elf_visits v
       JOIN elf_families f ON f.id = v.family_id
      WHERE v.year = $1 AND v.door = $2 AND v.counts_from <= $3 AND f.removed_at IS NULL`,
    [year, door, now],
  );
  return { cracked: crackedCount, visited: Number(r.rows[0]?.n ?? 0) };
}

/** A door's scrapbook: the elves that count by `now` and the approved photos, in the scrapbook's order. */
export async function doorScrapbook(year: number, door: number, now: Date): Promise<Scrapbook> {
  const visits = await pool.query<{ id: number; counts_from: Date; found: boolean; first_name: string; surname: string; name_approved: boolean }>(
    `SELECT v.id, v.counts_from, v.found, d.first_name, d.surname, d.name_approved FROM elf_visits v
       JOIN elf_detectives d ON d.id = v.detective_id
       JOIN elf_families f ON f.id = v.family_id
      WHERE v.year = $1 AND v.door = $2 AND v.counts_from <= $3 AND f.removed_at IS NULL`,
    [year, door, now],
  );
  const photos = await pool.query<{ token: string }>(
    `SELECT p.token FROM elf_photos p
       JOIN elf_families f ON f.id = p.family_id
      WHERE p.year = $1 AND p.door = $2 AND p.status = 'approved' AND p.deleted_at IS NULL AND f.removed_at IS NULL`,
    [year, door],
  );
  const elves: ScrapElf[] = visits.rows.map((v) => ({
    visitId: Number(v.id),
    detective: { firstName: v.first_name, surname: v.surname, approved: v.name_approved === true },
    countsFrom: v.counts_from,
    found: v.found,
    pictureUrl: `/elf/door/${door}/elf/${v.id}.png`,
  }));
  const pics: ScrapPhoto[] = photos.rows.map((p) => ({ token: p.token, url: `/elf/door/${door}/photo/${p.token}.jpg` }));
  return orderScrapbook(elves, pics);
}

// ---- photos -------------------------------------------------------------------------------------------

/** A family sends a photo for a door. "limit" at five from the family in 24 hours (nothing is stored).
 *  The family's photo still waiting for this door is replaced, and its bytes deleted. */
export async function sendElfPhoto(o: {
  year: number;
  door: Door | 0;
  familyId: number;
  picture: MadePicture;
  at: Date;
}): Promise<{ token: string } | "limit"> {
  return inTransaction(async (client) => {
    // One sender at a time per family, so two at once cannot both slip under the limit.
    await client.query("SELECT id FROM elf_families WHERE id = $1 FOR UPDATE", [o.familyId]);
    const counted = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM elf_photos WHERE family_id = $1 AND sent_at > $2::timestamptz - interval '24 hours'",
      [o.familyId, o.at],
    );
    if (Number(counted.rows[0]?.n ?? 0) >= PHOTOS_A_DAY) return "limit" as const;
    // Replaced, not decided: decided_at and decided_by are a head elf's decision (the photo check).
    const replaced = await client.query<{ id: number }>(
      `UPDATE elf_photos SET status = 'replaced'
        WHERE year = $1 AND door = $2 AND family_id = $3 AND status = 'waiting' RETURNING id`,
      [o.year, o.door, o.familyId],
    );
    if (replaced.rows.length > 0) {
      await client.query("DELETE FROM elf_photo_files WHERE photo_id = ANY($1::int[])", [replaced.rows.map((r) => r.id)]);
    }
    const token = makePosterCode();
    const ins = await client.query<{ id: number }>(
      `INSERT INTO elf_photos (token, year, door, family_id, mime, width, height, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [token, o.year, o.door, o.familyId, o.picture.mime, o.picture.width, o.picture.height, o.at],
    );
    await client.query("INSERT INTO elf_photo_files (photo_id, bytes) VALUES ($1, $2)", [ins.rows[0].id, o.picture.bytes]);
    await insertAudit(client, {
      actor: "family",
      action: "elf.photo.sent",
      entity: "elf_photo",
      entityId: ins.rows[0].id,
      data: { year: o.year, door: o.door, familyId: o.familyId, replaced: replaced.rows.length },
    });
    return { token };
  });
}

/** The family's current photo for a door (not replaced, taken down or deleted). An approved photo reads
 *  as waiting while the place is still hidden. A decline's reason is never given to the family. */
export async function familyPhoto(
  year: number,
  door: number,
  familyId: number,
  placeShown: boolean,
): Promise<{ token: string; status: "waiting" | "approved" | "declined" } | null> {
  const r = await pool.query<{ token: string; status: "waiting" | "approved" | "declined" }>(
    `SELECT token, status FROM elf_photos
      WHERE year = $1 AND door = $2 AND family_id = $3 AND status NOT IN ('replaced', 'taken-down', 'deleted')
      ORDER BY sent_at DESC, id DESC LIMIT 1`,
    [year, door, familyId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { token: row.token, status: row.status === "approved" && !placeShown ? "waiting" : row.status };
}

/** A family takes its own photo down: gone from the page at once, and its bytes deleted. */
export async function takeDownOwnPhoto(year: number, door: number, familyId: number, at: Date): Promise<boolean> {
  return inTransaction(async (client) => {
    const r = await client.query<{ id: number }>(
      `UPDATE elf_photos SET status = 'taken-down', taken_down_at = $4, taken_down_by = 'family'
        WHERE year = $1 AND door = $2 AND family_id = $3 AND status IN ('waiting', 'approved') RETURNING id`,
      [year, door, familyId, at],
    );
    if (r.rows.length === 0) return false;
    const ids = r.rows.map((row) => row.id);
    await client.query("DELETE FROM elf_photo_files WHERE photo_id = ANY($1::int[])", [ids]);
    for (const id of ids) {
      await insertAudit(client, { actor: "family", action: "elf.photo.taken_down", entity: "elf_photo", entityId: id, data: { year, door, familyId } });
    }
    return true;
  });
}

/** The bytes of an approved photo by its token, or null. */
export async function approvedPhoto(year: number, door: number, token: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = await pool.query<{ mime: string; bytes: Buffer }>(
    `SELECT p.mime, f.bytes FROM elf_photos p
       JOIN elf_photo_files f ON f.photo_id = p.id
       JOIN elf_families fam ON fam.id = p.family_id
      WHERE p.year = $1 AND p.door = $2 AND p.token = $3 AND p.status = 'approved'
        AND p.deleted_at IS NULL AND fam.removed_at IS NULL`,
    [year, door, token],
  );
  return r.rows[0] ? { mime: r.rows[0].mime, bytes: r.rows[0].bytes } : null;
}

// ---- elves, clue pictures, the switch -----------------------------------------------------------------

/** The elf a visit left on a door: its look and whose it is. */
export async function visitElf(year: number, door: number, visitId: number): Promise<{ look: unknown; detectiveId: number } | null> {
  const r = await pool.query<{ look: unknown; detective_id: number }>(
    `SELECT v.look, v.detective_id FROM elf_visits v
       JOIN elf_families f ON f.id = v.family_id
      WHERE v.id = $1 AND v.year = $2 AND v.door = $3 AND f.removed_at IS NULL`,
    [visitId, year, door],
  );
  return r.rows[0] ? { look: r.rows[0].look, detectiveId: Number(r.rows[0].detective_id) } : null;
}

/** A clue's picture, or null. */
export async function cluePicture(year: number, door: number, n: number): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = await pool.query<{ picture: Buffer; picture_mime: string }>(
    "SELECT picture, picture_mime FROM elf_clues WHERE year = $1 AND door = $2 AND n = $3 AND picture IS NOT NULL",
    [year, door, n],
  );
  return r.rows[0] ? { mime: r.rows[0].picture_mime, bytes: r.rows[0].picture } : null;
}

/** The doors have been switched on: every door of the year gets its row (so an unready door can be
 *  snowed in automatically, which only updates rows that exist), and the practice door and everything
 *  played at it go. */
export async function onDoorsSwitchedOn(year: number): Promise<void> {
  await ensureElfDoors(year);
  await clearPractice();
}

