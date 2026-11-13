import type { DoorRun, FamilyRuns } from "../db/elf-game";
import { DEFAULT_MORNING_CLUE_TIME, DEFAULT_SCHOOL_CLUE_TIME, DOOR_COUNT, clueTimeFor, doorDate, doorInstant, isDoor, type Door } from "./calendar";
import { closingShown, doorsToCrack, goesOpen, knowsPlace, mayHaveAGo, placesPublic, type FamilyKnowledge } from "./catch-up";
import { canGuess, cluesOut, doorState, isClaimable, isOpen, nextClueAt, openedAt, shownAt, type DoorFacts, type DoorState } from "./doors";
import { badgeWords } from "./emails";
import { factFor } from "./facts";
import { grandPrizeClosesAt, prizeSectionShows } from "./grand-prize";
import { cracked, type SavedGuess } from "./guess";
import { detectiveNames, familyDetectiveName, type DetectiveNameParts } from "./names";
import { doorPicture } from "./door-setup";
import { progressOf, type DoorsDone } from "./progress";
import { collageOf, orderScrapbook, type ScrapPhoto, type Scrapbook } from "./scrapbook";
import type { ElfSettings } from "./settings";
import { sameDay } from "./words";
import { normaliseFavourites, normaliseLook, wardrobeState } from "./wardrobe";
import type { CalendarView, DetectiveView, DoorView, EntryView, FamilyMarks, GoView, HqView, PosterView, TodayView, WardrobeView } from "./pages/types";

// NBCC Elf Detective School: what the database holds, turned into what the screens show. Pure: the
// rows and the doors' runs come in, the views go out. Nothing is shown before its time: a place, a
// scrapbook, the counts and the prize come only once a door is open (and on the calendar everyone
// shares, a place and the photos only from Christmas Day until 1 January; on the go page and in Detective
// HQ's case, only once the family may know it), a clue only once it is out, and a child is named only
// through detectiveName or detectiveNames.
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

/** When Detective HQ says the place is shown: the real time once the elf is found before its reveal,
 *  the staff reveal time while the hunt is on before it, and none once that has passed with the elf
 *  still hiding (the place is then shown as soon as the elf is found, or at its closing at the latest:
 *  TodayView.shownBy says that, on the door's own day). Never the place's closing time,
 *  when an unfound elf's place is shown: that would be wrong the moment the elf is found. When the place
 *  closes is said on its own, on the door's own day (the spec's answer 5, through TodayView.closesAt and
 *  closingShown in catch-up.ts). */
function revealFor(facts: DoorFacts, state: DoorState, now: Date): Date | null {
  if (state === "found-hidden") return shownAt(facts);
  if ((state === "shut" || state === "hunting") && now.getTime() < facts.revealAt.getTime()) return facts.revealAt;
  return null;
}

/** The clues that are out at `now`, in order, as a family's screens draw them: Detective HQ's case and the
 *  go page share it. None on a snow day. */
function cluesOutOf(run: DoorRun, now: Date): TodayView["clues"] {
  const out = cluesOut(run.facts, now);
  return run.clues
    .filter((c) => c.n <= out)
    .map((c) => ({
      n: c.n,
      at: c.at,
      words: c.words,
      // The practice door has no pictures; a real door's picture is served only once its clue is out.
      pictureUrl: c.hasPicture && run.door !== 0 ? `/elf/hq/clue/${run.door}/${c.n}.jpg` : null,
      pictureAlt: c.hasPicture && run.door !== 0 ? c.pictureAlt : null,
    }));
}

/** Today's case for a family. How it ended comes only once the family can see the place (the one rule,
 *  asked only of an open door), so a go at today's door can never be cracked by reading Detective HQ; until
 *  then a family that may have a go is offered it. */
function todayOf(
  run: DoorRun,
  o: { now: Date; guesses: ReadonlyMap<number, SavedGuess>; typed: ReadonlySet<number>; finders: Map<Door, DetectiveNameParts[]> },
): TodayView {
  const state = doorState(run.facts, o.now);
  const guess = o.guesses.get(run.door) ?? null;
  const guessed = guess !== null;
  const typed = o.typed.has(run.door);
  let outcome: TodayView["outcome"] = null;
  if (isOpen(state) && knowsPlace({ state, guessed, typed }) && run.placeName !== null) {
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
    clues: cluesOutOf(run, o.now),
    nextClueAt: nextClueAt(run.facts, o.now),
    revealAt: revealFor(run.facts, state, o.now),
    guess: guess ? { text: guess.text, at: guess.at } : null,
    canGuess: canGuess(state),
    // Only the guess route sets this, when the form sent with no script was refused.
    guessError: null,
    outcome,
    goUrl: mayHaveAGo({ year: run.year, state, guessed, typed, now: o.now }) ? `/elf/hq/door/${run.door}` : null,
    closesAt: closingShown(run, o.now),
    goneHome: run.facts.goneHome,
    // An unfound elf's place is shown at the reveal or the closing, whichever is later (shownAt), so only a
    // closing after the reveal can make it later; the time a door falls back to with none typed counts (4pm on
    // Christmas Eve, 8pm otherwise).
    mayShowLater: state === "hunting" && run.facts.closesAt.getTime() > run.facts.revealAt.getTime(),
    shownBy: state === "hunting" ? latestShownToday(run) : null,
  };
}

/** The latest an unfound elf's place is shown, when that falls on the door's own day in London; else null. A
 *  closing typed at or before clue 1 is read as that time on the next day (closingInstant in calendar.ts), so it
 *  is never the latest a family finds out today. */
function latestShownToday(run: DoorRun): Date | null {
  const latest = shownAt({ ...run.facts, foundAt: null });
  return sameDay(latest, run.facts.clue1At) ? latest : null;
}

/** Detective HQ's case today: the practice run while one runs for this browser, else, only while
 *  December's doors are on, the door whose day is today in London, else none (wave 1 had no case). */
export function todayRunOf(o: { settings: ElfSettings; now: Date; runs: FamilyRuns }): DoorRun | null {
  return o.runs.practice ?? (o.settings.doorsOn ? runForToday(o.runs.runs, o.now) : null);
}

/** The family's marks: a door is cracked or visited by any of its detectives, or snowed in. Detective
 *  HQ draws them, and the calendar's script reads them from /api/elf/me. */
export function marksOf(runs: readonly DoorRun[], family: FamilyRow, doorsDone: Map<number, DoorsDone>, photos: FamilyMarks["photos"], now: Date): FamilyMarks {
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

/** Detective HQ's grand prize section (Plan 2c-2), or null while it does not show: prizeSectionShows is the one
 *  rule both for reading the family's entries (hqViewOf in src/routes/elf.ts) and for drawing the section (ruling
 *  F9). The family's graduates, in the family's order, each with its entry page and whether its picture is in. */
function grandPrizeOf(
  o: { settings: ElfSettings; now: Date; entries: ReadonlyMap<number, { sentAt: Date }> },
  detectives: readonly { id: number; view: DetectiveView }[],
): HqView["grandPrize"] {
  const closesAt = grandPrizeClosesAt(o.settings);
  if (!prizeSectionShows({ doorsOn: o.settings.doorsOn, year: o.settings.year, closesAt, now: o.now })) return null;
  return {
    closesAt,
    open: o.now.getTime() < closesAt.getTime(),
    detectives: detectives.flatMap((d) => (d.view.graduate ? [{ name: d.view.name, url: `/elf/hq/entry/${d.id}`, sent: o.entries.has(d.id) }] : [])),
  };
}

/** Detective HQ's view. `guesses` and `typed` are what the family has done (FamilyKnowledge in catch-up.ts):
 *  this year's while December's doors are on, and the practice door's while a practice runs for this browser.
 *  `entries` are the family's grand prize entries this year, by detective (familyEntries in
 *  src/db/elf-grand-prize.ts): read only while the grand prize section shows, and empty otherwise. */
export function hqViewFor(o: {
  family: FamilyRow;
  settings: ElfSettings;
  now: Date;
  runs: FamilyRuns;
  guesses: ReadonlyMap<number, SavedGuess>;
  typed: ReadonlySet<number>;
  doorsDone: Map<number, DoorsDone>;
  finders: Map<Door, DetectiveNameParts[]>;
  photos: FamilyMarks["photos"];
  entries: ReadonlyMap<number, { sentAt: Date }>;
}): HqView {
  const real = o.runs.runs.filter((r) => r.door !== 0);
  // With December's doors off, HQ is wave 1: no case today unless a practice run is going, and, as wave
  // 1's HQ did, a countdown to door 1's first clue and to nothing after it.
  const todayRun = todayRunOf(o);
  // The missed doors the family may still crack: none with December's doors off, and never the door today's
  // case already offers (ruling F9).
  const toCrack: HqView["toCrack"] = o.settings.doorsOn
    ? doorsToCrack({ runs: real, knowledge: { guesses: o.guesses, typed: o.typed }, now: o.now }).flatMap((r) =>
        isDoor(r.door) && r.door !== todayRun?.door ? [{ door: r.door, elfName: r.elfName, clueAt: r.calendarAt, url: `/elf/hq/door/${r.door}` }] : [],
      )
    : [];
  const start = firstClueAt(o.settings.year);
  const next = o.settings.doorsOn
    ? real
        .map((r) => r.calendarAt)
        .filter((at) => at.getTime() > o.now.getTime())
        .sort((x, y) => x.getTime() - y.getTime())[0]
    : o.now.getTime() < start.getTime()
      ? start
      : undefined;
  const detectives = o.family.detectives.map((d) => ({ id: d.id, view: detectiveViewFor(d, o.doorsDone.get(d.id) ?? NO_DOORS) }));
  return {
    now: o.now,
    familyName: firstWord(o.family.grownUpName),
    detectives: detectives.map((d) => d.view),
    today: todayRun ? todayOf(todayRun, o) : null,
    nextClueAt: next ?? null,
    toCrack,
    marks: marksOf(real, o.family, o.doorsDone, o.photos, o.now),
    calendarUrl: "/elf",
    guessUrl: "/api/elf/guess",
    addDetectiveUrl: "/elf/join",
    grandPrize: grandPrizeOf(o, detectives),
  };
}

/** The grand prize entry page's view for one of the family's graduates (Plan 2c-2). The caller has checked that
 *  the detective is the signed in family's own and has done all 24 doors, and that the entries have opened.
 *  `sentAt` is when its picture came in, or null before one has; `hasMobile` whether the family has a mobile. */
export function entryViewFor(o: { detective: DetectiveRow; hasMobile: boolean; closesAt: Date; now: Date; sentAt: Date | null }): EntryView {
  const id = String(o.detective.id);
  return {
    // A family always sees its own detectives' names in full.
    detective: { id, name: familyDetectiveName({ firstName: o.detective.firstName, surname: o.detective.surname, approved: true }) },
    closesAt: o.closesAt,
    open: o.now.getTime() < o.closesAt.getTime(),
    sent: o.sentAt ? { at: o.sentAt, pictureUrl: `/elf/hq/entry/${id}/picture.jpg` } : null,
    askMobile: !o.hasMobile,
    postUrl: `/api/elf/entry/${id}`,
    hqUrl: "/elf/hq",
  };
}

/** A door's place, when it has one: its name, and its town (empty when none was typed). */
export function doorPlaceOf(run: DoorRun): { name: string; town: string } | null {
  return filled(run.placeName) ? { name: run.placeName, town: run.placeTown ?? "" } : null;
}

/** Is the elf still waiting at its place with nobody having found it? Shown unfound, and not gone home:
 *  a door whose elf has gone home never says it can still be found (ruling F8). */
const stillHidingAt = (run: DoorRun, state: DoorState): boolean => state === "revealed" && !run.facts.goneHome;

/** How a door turned out for a family that may know its place (the caller decides): the verdict on its
 *  guess (cracked by cracked(), wrong for any other guess, none without one), where the elf was, and what
 *  is left to do there. `place` is the door's own, from doorPlaceOf. */
export function goOutcomeOf(o: { run: DoorRun; now: Date; place: { name: string; town: string }; guess: SavedGuess | null; typed: boolean }): NonNullable<GoView["outcome"]> {
  const state = doorState(o.run.facts, o.now);
  const right = cracked({ state, openedAt: openedAt(o.run.facts, o.now), names: o.run.names }, o.guess);
  return {
    verdict: o.guess === null ? "none" : right ? "cracked" : "wrong",
    place: { name: o.place.name, town: o.place.town },
    stillHiding: stillHidingAt(o.run, state),
    goneHome: o.run.facts.goneHome,
    visited: o.typed,
  };
}

/** How many clues the go page shows: as asked, held to 1 to 3. */
const heldClues = (n: number): number => (Number.isFinite(n) ? Math.min(3, Math.max(1, Math.floor(n))) : 1);

/**
 * A door's page in Detective HQ for having a go (Plan 2c-1). "done" once the family can see the place
 * (the one rule, asked only of an open door: rulings on Plan 2c-1), "go" while it may have its go, and
 * "closed" otherwise. Only in "go": the first `cluesShown` of the clues that are out (held to 1 to 3) and
 * the link to the next while another is out. How it went: in "done", and in "closed" while every place is
 * shown to everyone; never for a door that is not open or has no place. The practice door names no finder,
 * as Detective HQ's case does not.
 */
export function goViewFor(o: {
  run: DoorRun;
  now: Date;
  guess: SavedGuess | null;
  typed: boolean;
  finders: DetectiveNameParts[];
  cluesShown: number;
  guessError?: string | null;
}): GoView {
  const { run, now } = o;
  const state = doorState(run.facts, now);
  const open = isOpen(state);
  const guessed = o.guess !== null;
  const stage: GoView["stage"] =
    open && knowsPlace({ state, guessed, typed: o.typed }) ? "done" : mayHaveAGo({ year: run.year, state, guessed, typed: o.typed, now }) ? "go" : "closed";
  const out = stage === "go" ? cluesOutOf(run, now) : [];
  const clues = out.slice(0, heldClues(o.cluesShown));
  const place = doorPlaceOf(run);
  const told = open && (stage === "done" || (stage === "closed" && placesPublic(run.year, now)));
  const foundAt = run.facts.foundAt;
  const finders = run.door === 0 ? [] : o.finders;
  return {
    door: run.door,
    practice: run.door === 0,
    elfName: run.elfName,
    day: run.calendarAt,
    found: foundAt !== null && foundAt.getTime() <= now.getTime() ? { at: foundAt, by: detectiveNames(finders) || "A detective" } : null,
    stage,
    stillHiding: stillHidingAt(run, state),
    goneHome: run.facts.goneHome,
    clues,
    nextUrl: clues.length < out.length ? `/elf/hq/door/${run.door}?clues=${clues.length + 1}` : null,
    formUrl: `/elf/hq/door/${run.door}/go`,
    guessError: o.guessError ?? null,
    closesAt: closingShown(run, now),
    // In "closed" the family has neither guessed nor been there, so it has no verdict.
    outcome: told && place ? goOutcomeOf({ run, now, place, guess: o.guess, typed: o.typed }) : null,
    hqUrl: "/elf/hq",
  };
}

/** The wardrobe's view. `runs` and `knowledge` are the doors and what the family has done there, for the doors
 *  it may still crack from Detective HQ (ruling F7): none while December's doors are off. */
export function wardrobeViewFor(o: {
  detective: DetectiveRow;
  settings: ElfSettings;
  now: Date;
  doorsDone: DoorsDone;
  runs: readonly DoorRun[];
  knowledge: FamilyKnowledge;
}): WardrobeView {
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
    crackable: o.settings.doorsOn ? doorsToCrack({ runs: o.runs, knowledge: o.knowledge, now: o.now }).map((r) => r.door) : [],
    hqUrl: "/elf/hq",
    calendarUrl: "/elf",
    saveUrl: "/api/elf/look",
  };
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

/** An open door's scrapbook on the calendar everyone shares: as the loader gave it while every place is
 *  shown to everyone, otherwise its elves only, counted on their own. The loader reads no photos then
 *  either (loadPublicCalendar in src/routes/elf.ts): two locks, as a photo can show the inside of the
 *  place. */
function everyonesBook(book: Scrapbook, placesShown: boolean): Scrapbook {
  return placesShown || book.photos.length === 0 ? book : { elves: book.elves, photos: [], count: book.elves.length };
}

function doorViewOf(
  run: DoorRun & { door: Door },
  o: { settings: ElfSettings; now: Date; finders: Map<Door, DetectiveNameParts[]>; counts: Map<Door, { cracked: number; visited: number }>; scrapbooks: Map<Door, Scrapbook> },
): DoorView {
  const state = doorState(run.facts, o.now);
  const open = isOpen(state);
  const hasFound = state === "found-hidden" || state === "found";
  // The calendar everyone shares names an open door's place only from Christmas Day until 1 January (the
  // spec's answer 6). Before then a family sees it on its own door, once it can (familyDoorView).
  const placesShown = placesPublic(run.year, o.now);
  const book = open ? everyonesBook(o.scrapbooks.get(run.door) ?? EMPTY_BOOK, placesShown) : null;
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
    place: open && placesShown && run.placeName !== null ? { name: run.placeName, town: run.placeTown ?? "" } : null,
    found: hasFound && run.facts.foundAt !== null ? { at: run.facts.foundAt, by: detectiveNames(o.finders.get(run.door) ?? []) || "A detective" } : null,
    revealAt: state === "found-hidden" ? shownAt(run.facts) : null,
    counts: open ? (o.counts.get(run.door) ?? { cracked: 0, visited: 0 }) : null,
    scrapbook: book,
    collage: book ? collageOf(book) : [],
    goneHome: run.facts.goneHome,
    factLine: open ? (factFor(run.door)?.doorLine ?? null) : null,
    doorsOn: o.settings.doorsOn,
    // The same for every visitor: whether a visitor may have a go is the go page's to say.
    goUrl: open && goesOpen(run.year, o.now) ? `/elf/hq/door/${run.door}` : null,
  };
}

/**
 * A family's own door, for a family that can see the place (the one rule, src/elf/catch-up.ts): the shared
 * door with the place, the door's photos beside the shared elves, in the scrapbook's order, and no go
 * (the family already knows where the elf was hiding). A door that is not open comes back as it was.
 * Pure: the caller decides whether the family may see the place, and reads its photos (doorPhotos).
 */
export function familyDoorView(shared: DoorView, mine: { place: { name: string; town: string }; photos: readonly ScrapPhoto[] }): DoorView {
  if (!isOpen(shared.state)) return shared;
  return {
    ...shared,
    place: { name: mine.place.name, town: mine.place.town },
    scrapbook: orderScrapbook(shared.scrapbook?.elves ?? [], mine.photos),
    goUrl: null,
  };
}

/**
 * The public calendar: the same for every visitor, so it can be cached. It never carries the
 * practice run. A door shows its scrapbook, counts and prize only once it is open, and its place and
 * photos only from Christmas Day until 1 January.
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
    doorsOn: o.settings.doorsOn,
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
    elfName: o.run.elfName,
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
    // Only the word route sets this, when the form sent with no script was refused for too many words.
    wordError: null,
    joinUrl: "/elf/join",
    signInUrl: "/elf/sign-in",
    calendarUrl: "/elf",
    hqUrl: "/elf/hq",
    wordUrl: `/elf/p/${o.run.posterCode}/word`,
    photoUrl: `/api/elf/p/${o.run.posterCode}/photo`,
  };
}
