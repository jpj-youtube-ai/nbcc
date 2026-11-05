import { DEFAULT_MORNING_CLUE_TIME, DEFAULT_SCHOOL_CLUE_TIME, DOOR_COUNT, clueTimeFor, doorDate, doorInstant, type Door } from "./calendar";
import { badgeWords } from "./emails";
import { ELF_NAMES, familyDetectiveName } from "./names";
import { progressOf } from "./progress";
import type { ElfSettings } from "./settings";
import { normaliseFavourites, normaliseLook, wardrobeState } from "./wardrobe";
import type { CalendarView, DetectiveView, DoorView, HqView, WardrobeView } from "./pages/types";

// NBCC Elf Detective School: what the database holds, turned into what the screens show (wave 1
// plan, Tasks 7 and 8). Pure: the rows come in, the views go out. In wave 1 no door has opened, so
// every detective has 0 doors done; wave 2 brings the cracked and visited doors in here.
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

/** What a detective has done so far. Wave 1: nothing yet, as no door has a table to be cracked or
 *  visited; wave 2 passes the family's cracked doors and the detective's own visits here. */
function earned() {
  const doors = { cracked: [], visited: [] };
  return { progress: progressOf(doors), state: wardrobeState(doors) };
}

export function detectiveViewFor(d: DetectiveRow): DetectiveView {
  const { progress, state } = earned();
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

export function hqViewFor(o: { family: FamilyRow; settings: ElfSettings; now: Date }): HqView {
  const start = firstClueAt(o.settings.year);
  return {
    now: o.now,
    familyName: firstWord(o.family.grownUpName),
    detectives: o.family.detectives.map(detectiveViewFor),
    today: null,
    nextClueAt: o.now.getTime() < start.getTime() ? start : null,
    marks: { doors: [] },
    calendarUrl: "/elf",
    guessUrl: "/api/elf/guess",
    addDetectiveUrl: "/elf/join",
  };
}

export function wardrobeViewFor(o: { detective: DetectiveRow; settings: ElfSettings; now: Date }): WardrobeView {
  const { state } = earned();
  const doorDays = [];
  for (let n = 1; n <= DOOR_COUNT; n += 1) doorDays.push({ door: n, clueAt: clueAtOf(o.settings, n as Door), date: doorDate(o.settings, n as Door) });
  return {
    detective: detectiveViewFor(o.detective),
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

/** What the server builds the wardrobe state from in wave 1, for saving a look. */
export function wardrobeStateNow() {
  return earned().state;
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

/**
 * The public calendar. In wave 1 every door is shut (nothing has opened yet): a carved shape, the
 * Big prize ribbon and the place all come with wave 2's admin, so a door shows the mystery star, its
 * elf's name and its countdown. The same for every visitor, so it can be cached. A place is never
 * listed: a door shows its place only once it is open (docs/superpowers/specs/2026-11-03-elf-
 * detective-secret-places-design.md).
 */
/** When a door's clue comes out this season, as the calendar shows it. */
function clueAtOf(settings: ElfSettings, door: Door): Date {
  const season = { year: settings.year, holidayDoors: [], schoolClueTime: DEFAULT_SCHOOL_CLUE_TIME, morningClueTime: DEFAULT_MORNING_CLUE_TIME };
  return doorInstant(season, door, clueTimeFor(season, door, null)) ?? new Date(Date.UTC(settings.year, 11, door, 17, 30));
}

export function calendarViewFor(o: { settings: ElfSettings; now: Date }): CalendarView {
  const doors: DoorView[] = [];
  for (let n = 1; n <= DOOR_COUNT; n += 1) {
    const door = n as Door;
    doors.push({
      door,
      state: "shut",
      clueAt: clueAtOf(o.settings, door),
      shapeUrl: null,
      bigPrize: false,
      teaser: null,
      elfName: ELF_NAMES[n - 1] ?? "Elf",
      place: null,
      found: null,
      counts: null,
      factLine: null,
    });
  }
  return {
    year: o.settings.year,
    now: o.now,
    doors,
    price: { from: poundsWords(o.settings.entryFromPence), suggested: poundsWords(o.settings.entrySuggestedPence) },
    joinUrl: "/elf/join",
    hqUrl: "/elf/hq",
  };
}
