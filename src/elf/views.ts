import type { DoorRun, FamilyRuns } from "../db/elf-game";
import { DEFAULT_MORNING_CLUE_TIME, DEFAULT_SCHOOL_CLUE_TIME, DOOR_COUNT, clueTimeFor, doorDate, doorInstant, isDoor, type Door } from "./calendar";
import { canGuess, cluesOut, doorState, isClaimable, isOpen, nextClueAt, openedAt, shownAt } from "./doors";
import { badgeWords } from "./emails";
import { factFor } from "./facts";
import { cracked, type SavedGuess } from "./guess";
import { detectiveNames, familyDetectiveName, type DetectiveNameParts } from "./names";
import { doorPicture } from "./door-setup";
import { progressOf, type DoorsDone } from "./progress";
import { collageOf, type Scrapbook } from "./scrapbook";
import type { ElfSettings } from "./settings";
import { sameDay } from "./words";
import { normaliseFavourites, normaliseLook, wardrobeState } from "./wardrobe";
import type { CalendarView, DetectiveView, DoorView, FamilyMarks, HqView, PosterView, TodayView, WardrobeView } from "./pages/types";

// NBCC Elf Detective School: what the database holds, turned into what the screens show. Pure: the
// rows and the doors' runs come in, the views go out. Nothing is shown before its time: a place, a
// scrapbook, the counts and the prize come only once a door is open, a clue only once it is out, and a
// child is named only through detectiveName or detectiveNames.
// Unit tested in test/unit/elf-views.test.ts.

export interface DetectiveRow {
  id: number;
  firstName: string;
  surname: string;
  nameApproved: boolean;
  badgeNumber: number | null;
  look: unknown;
  /** The costumes unlocked and not opened yet, by id: wrapped presents on the wardrobe. */
  fresh: string[];
  /** The favourite looks, as stored. They are made safe before they are shown. */
  favourites: unknown;
}

export interface FamilyRow {
  id: number;
  grownUpName: string;
  email: string;
  detectives: DetectiveRow[];
}

/** When school starts: door 1's first clue, at 5:30pm London time. */
export function firstClueAt(year: number): Date {
  return doorInstant({ year }, 1, "17:30") ?? new Date(Date.UTC(year, 11, 1, 17, 30));
}

/** What a detective has done so far, from the doors they have done. */
function earned(doors: DoorsDone) {
  return { progress: progressOf(doors), state: wardrobeState(doors) };
}

const NO_DOORS: DoorsDone = { cracked: [], visited: [] };

export function detectiveViewFor(d: DetectiveRow, doorsDone: DoorsDone): DetectiveView {
  const { progress, state } = earned(doorsDone);
  return {
    id: String(d.id),
    // A family always sees its own detectives' names in full.
    name: familyDetectiveName({ firstName: d.firstName, surname: d.surname, approved: true }),
    nameApproved: d.nameApproved,
    badgeNumber: d.badgeNumber === null ? "" : badgeWords(d.badgeNumber),
    rank: progress.rank,
    doorsDone: progress.doorsDone,
    next: progress.next ? { rank: progress.next.rank, toGo: progress.next.toGo } : null,
    graduate: progress.graduate,
    goldSeal: progress.goldSeal,
    elfUrl: `/elf/hq/elf/${d.id}.png`,
    frame: normaliseLook(d.look, state).frame,
    newThings: d.fresh.length,
    wardrobeUrl: `/elf/hq/wardrobe/${d.id}`,
  };
}

function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** The run whose day is today in London, or null. */
function runForToday(runs: readonly DoorRun[], now: Date): DoorRun | null {
  return runs.find((r) => r.door !== 0 && sameDay(r.calendarAt, now)) ?? null;
}

function todayOf(run: DoorRun, o: { now: Date; guesses: Map<number, SavedGuess>; finders: Map<Door, DetectiveNameParts[]> }): TodayView {
  const state = doorState(run.facts, o.now);
  const out = cluesOut(run.facts, o.now);
  const guess = o.guesses.get(run.door) ?? null;
  let outcome: TodayView["outcome"] = null;
  if (isOpen(state) && run.placeName !== null) {
    const found = state === "found" && run.facts.foundAt !== null;
    const finders = run.door === 0 ? [] : (o.finders.get(run.door) ?? []);
    outcome = {
      place: run.placeName,
      by: found ? detectiveNames(finders) || "A detective" : null,
      at: found ? run.facts.foundAt : null,
      cracked: cracked({ state, openedAt: openedAt(run.facts, o.now), names: run.names }, guess),
    };
  }
  return {
    door: run.door,
    practice: run.door === 0,
    state,
    elfName: run.elfName,
    clues: run.clues
      .filter((c) => c.n <= out)
      .map((c) => ({
        n: c.n,
        at: c.at,
        words: c.words,
        // The practice door has no pictures; a real door's picture is served only once its clue is out.
        pictureUrl: c.hasPicture && run.door !== 0 ? `/elf/hq/clue/${run.door}/${c.n}.jpg` : null,
        pictureAlt: c.hasPicture && run.door !== 0 ? c.pictureAlt : null,
      })),
    nextClueAt: nextClueAt(run.facts, o.now),
    revealAt: shownAt(run.facts),
    guess: guess ? { text: guess.text, at: guess.at } : null,
    canGuess: canGuess(state),
    outcome,
  };
}

/** The family's marks: a door is cracked or visited by any of its detectives, or snowed in. */
function marksOf(runs: readonly DoorRun[], family: FamilyRow, doorsDone: Map<number, DoorsDone>, photos: FamilyMarks["photos"], now: Date): FamilyMarks {
  const crackedDoors = new Set<number>();
  const visitedDoors = new Set<number>();
  for (const d of family.detectives) {
    const done = doorsDone.get(d.id);
    for (const n of done?.cracked ?? []) crackedDoors.add(n);
    for (const n of done?.visited ?? []) visitedDoors.add(n);
  }
  const snow = new Set(runs.filter((r) => r.door !== 0 && doorState(r.facts, now) === "snow").map((r) => r.door));
  const doors: FamilyMarks["doors"] = [];
  for (let n = 1; n <= DOOR_COUNT; n += 1) {
    if (!isDoor(n)) continue;
    if (crackedDoors.has(n) || visitedDoors.has(n) || snow.has(n)) {
      doors.push({ door: n, cracked: crackedDoors.has(n), visited: visitedDoors.has(n), snow: snow.has(n) });
    }
  }
  return { doors, photos };
}

export function hqViewFor(o: {
  family: FamilyRow;
  settings: ElfSettings;
  now: Date;
  runs: FamilyRuns;
  guesses: Map<number, SavedGuess>;
  doorsDone: Map<number, DoorsDone>;
  finders: Map<Door, DetectiveNameParts[]>;
  photos: FamilyMarks["photos"];
}): HqView {
  const real = o.runs.runs.filter((r) => r.door !== 0);
  // With December's doors off, HQ is wave 1: no case today unless a practice run is going.
  const todayRun = o.runs.practice ?? (o.settings.doorsOn ? runForToday(real, o.now) : null);
  const next = real
    .map((r) => r.calendarAt)
    .filter((at) => at.getTime() > o.now.getTime())
    .sort((x, y) => x.getTime() - y.getTime())[0];
  return {
    now: o.now,
    familyName: firstWord(o.family.grownUpName),
    detectives: o.family.detectives.map((d) => detectiveViewFor(d, o.doorsDone.get(d.id) ?? NO_DOORS)),
    today: todayRun ? todayOf(todayRun, o) : null,
    nextClueAt: next ?? null,
    marks: marksOf(real, o.family, o.doorsDone, o.photos, o.now),
    calendarUrl: "/elf",
    guessUrl: "/api/elf/guess",
    addDetectiveUrl: "/elf/join",
  };
}

export function wardrobeViewFor(o: { detective: DetectiveRow; settings: ElfSettings; now: Date; doorsDone: DoorsDone }): WardrobeView {
  const { state } = earned(o.doorsDone);
  const doorDays = [];
  for (let n = 1; n <= DOOR_COUNT; n += 1) doorDays.push({ door: n, clueAt: clueAtOf(o.settings, n as Door), date: doorDate(o.settings, n as Door) });
  return {
    detective: detectiveViewFor(o.detective, o.doorsDone),
    look: normaliseLook(o.detective.look, state),
    state,
    fresh: o.detective.fresh,
    favourites: normaliseFavourites(o.detective.favourites, state),
    made: o.detective.look !== null && o.detective.look !== undefined,
    now: o.now,
    doorDays,
    hqUrl: "/elf/hq",
    calendarUrl: "/elf",
    saveUrl: "/api/elf/look",
  };
}

/** Wave 1's wardrobe state (no doors done), for saving a look. Task 7 removes its last caller. */
export function wardrobeStateNow() {
  return earned(NO_DOORS).state;
}

/** A look as the plain wardrobe form sends it (no script): one field for each part, with an empty choice
 *  meaning none. Only words are read. normaliseLook makes it safe afterwards. */
export function lookFromForm(form: Record<string, unknown>): Record<string, unknown> {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const chosen = (v: unknown) => text(v) || null;
  return {
    sibling: text(form.sibling),
    skin: text(form.skin),
    hair: text(form.hair),
    hairStyle: text(form.hairStyle),
    costume: chosen(form.costume),
    scene: text(form.scene),
    friend: chosen(form.friend),
    frame: chosen(form.frame),
    glasses: chosen(form.glasses),
    bow: chosen(form.bow),
  };
}

function poundsWords(p: number): string {
  return p % 100 === 0 ? `£${p / 100}` : `£${(p / 100).toFixed(2)}`;
}

/** When a door's clue comes out this season, as the calendar shows it. */
function clueAtOf(settings: ElfSettings, door: Door): Date {
  const season = { year: settings.year, holidayDoors: [], schoolClueTime: DEFAULT_SCHOOL_CLUE_TIME, morningClueTime: DEFAULT_MORNING_CLUE_TIME };
  return doorInstant(season, door, clueTimeFor(season, door, null)) ?? new Date(Date.UTC(settings.year, 11, door, 17, 30));
}

const EMPTY_BOOK: Scrapbook = { elves: [], photos: [], count: 0 };

const filled = (s: string | null): s is string => typeof s === "string" && s.trim() !== "";

function doorViewOf(
  run: DoorRun & { door: Door },
  o: { settings: ElfSettings; now: Date; finders: Map<Door, DetectiveNameParts[]>; counts: Map<Door, { cracked: number; visited: number }>; scrapbooks: Map<Door, Scrapbook> },
): DoorView {
  const state = doorState(run.facts, o.now);
  const open = isOpen(state);
  const hasFound = state === "found-hidden" || state === "found";
  const book = open ? (o.scrapbooks.get(run.door) ?? EMPTY_BOOK) : null;
  return {
    door: run.door,
    state,
    // The calendar's clue 1 time, never facts.clue1At: a passed wave 1 door holds that in the far future.
    clueAt: run.calendarAt,
    // Nothing of the prize shows while December's doors are switched off: a door picture hints at it.
    shapeUrl: o.settings.doorsOn ? doorPicture(run.year, run.door) : null,
    bigPrize: run.prizeShowOff,
    // Before the find only: not once the elf is found (found-hidden, found) and never on a snow day.
    teaser: run.prizeShowOff && (state === "shut" || state === "hunting" || state === "revealed") && filled(run.prize) ? run.prize : null,
    prize: state === "found" && filled(run.prize) ? run.prize : null,
    elfName: run.elfName,
    place: open && run.placeName !== null ? { name: run.placeName, town: run.placeTown ?? "" } : null,
    found: hasFound && run.facts.foundAt !== null ? { at: run.facts.foundAt, by: detectiveNames(o.finders.get(run.door) ?? []) || "A detective" } : null,
    revealAt: state === "found-hidden" ? shownAt(run.facts) : null,
    counts: open ? (o.counts.get(run.door) ?? { cracked: 0, visited: 0 }) : null,
    scrapbook: book,
    collage: book ? collageOf(book) : [],
    goneHome: run.facts.goneHome,
    factLine: open ? (factFor(run.door)?.doorLine ?? null) : null,
  };
}

/**
 * The public calendar: the same for every visitor, so it can be cached. It never carries the
 * practice run. A door shows its place, scrapbook, counts and prize only once it is open.
 */
export function calendarViewFor(o: {
  settings: ElfSettings;
  now: Date;
  runs: DoorRun[];
  finders: Map<Door, DetectiveNameParts[]>;
  counts: Map<Door, { cracked: number; visited: number }>;
  scrapbooks: Map<Door, Scrapbook>;
}): CalendarView {
  const doors: DoorView[] = [];
  for (const run of o.runs) {
    if (run.door === 0) continue;
    doors.push(doorViewOf(run as DoorRun & { door: Door }, o));
  }
  doors.sort((x, y) => x.door - y.door);
  return {
    year: o.settings.year,
    now: o.now,
    doors,
    price: { from: poundsWords(o.settings.entryFromPence), suggested: poundsWords(o.settings.entrySuggestedPence) },
    joinUrl: "/elf/join",
    hqUrl: "/elf/hq",
  };
}

/** The page a poster's QR code opens. A shut door and a hunting door give the same view. */
export function posterViewFor(o: {
  run: DoorRun;
  now: Date;
  family: FamilyRow | null;
  stamped: Set<number>;
  yourPhoto: PosterView["yourPhoto"];
}): PosterView {
  const state = doorState(o.run.facts, o.now);
  const foundHidden = state === "found-hidden";
  return {
    code: o.run.posterCode,
    door: o.run.door,
    placeName: o.run.placeName ?? "",
    placeTown: o.run.placeTown ?? "",
    open: isOpen(state),
    claimable: isClaimable(state) || state === "shut",
    foundHidden,
    revealAt: foundHidden ? shownAt(o.run.facts) : null,
    goneHome: o.run.facts.goneHome,
    signedIn: o.family !== null,
    detectives: o.family
      ? o.family.detectives.map((d) => ({
          id: String(d.id),
          name: familyDetectiveName({ firstName: d.firstName, surname: d.surname, approved: true }),
          hasStamp: o.stamped.has(d.id),
        }))
      : [],
    yourPhoto: o.yourPhoto,
    joinUrl: "/elf/join",
    signInUrl: "/elf/sign-in",
    calendarUrl: "/elf",
    hqUrl: "/elf/hq",
    wordUrl: `/elf/p/${o.run.posterCode}/word`,
    photoUrl: `/api/elf/p/${o.run.posterCode}/photo`,
  };
}
