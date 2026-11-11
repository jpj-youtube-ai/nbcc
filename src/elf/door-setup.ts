import {
  DEFAULT_MORNING_CLUE_TIME,
  DEFAULT_SCHOOL_CLUE_TIME,
  type Door,
  type ElfSeason,
  type StaffEvening,
} from "./calendar";
import { isUsableSecretWord } from "./claim";

// NBCC Elf Detective School: what one door has so far, and what it still needs before it can go
// live. Pure: no pool, no config, no clock. Unit tested in test/unit/elf-door-setup.test.ts.

export interface DoorClue {
  n: 1 | 2 | 3;
  words: string | null;
  /** Is the clue a picture (kept with the clue, never in this object)? */
  hasPicture: boolean;
  pictureAlt: string | null;
}

export interface DoorSetup {
  door: Door;
  placeName: string | null;
  placeTown: string | null;
  placeAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  closesAt: string | null;
  elfSpot: string | null;
  agreedBy: string | null;
  prize: string | null;
  prizeShowOff: boolean;
  elfName: string | null;
  tagWord: string | null;
  tagPrintedAt: Date | null;
  clue1Time: string | null;
  clue2Time: string | null;
  clue3Time: string | null;
  revealTime: string | null;
  posterCode: string;
  droppedOffAt: Date | null;
  droppedOffBy: string | null;
  thankedAt: Date | null;
  thankedBy: string | null;
  /** When the elf was found, and by which family; null while it is hiding. */
  foundAt: Date | null;
  foundFamilyId: number | null;
  /** The stored snow day (set by a head elf or automatically), never worked out live. */
  snowDayAt: Date | null;
  snowDayBy: string | null;
  goneHomeAt: Date | null;
  goneHomeBy: string | null;
  names: { id: number; name: string }[];
  clues: DoorClue[];
}

/** A door with nothing set up yet. */
export function emptyDoor(door: Door, posterCode: string): DoorSetup {
  return {
    door,
    placeName: null,
    placeTown: null,
    placeAddress: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    closesAt: null,
    elfSpot: null,
    agreedBy: null,
    prize: null,
    prizeShowOff: false,
    elfName: null,
    tagWord: null,
    tagPrintedAt: null,
    clue1Time: null,
    clue2Time: null,
    clue3Time: null,
    revealTime: null,
    posterCode,
    droppedOffAt: null,
    droppedOffBy: null,
    thankedAt: null,
    thankedBy: null,
    foundAt: null,
    foundFamilyId: null,
    snowDayAt: null,
    snowDayBy: null,
    goneHomeAt: null,
    goneHomeBy: null,
    names: [],
    clues: [
      { n: 1, words: null, hasPicture: false, pictureAlt: null },
      { n: 2, words: null, hasPicture: false, pictureAlt: null },
      { n: 3, words: null, hasPicture: false, pictureAlt: null },
    ],
  };
}

/** The season whose default times a door starts with. */
export function doorSeason(year: number): ElfSeason {
  return {
    year,
    holidayDoors: [],
    schoolClueTime: DEFAULT_SCHOOL_CLUE_TIME,
    morningClueTime: DEFAULT_MORNING_CLUE_TIME,
  };
}

/** The four evening times staff have stored on a door. */
export function staffEveningOf(d: DoorSetup): StaffEvening {
  return { clue1: d.clue1Time, clue2: d.clue2Time, clue3: d.clue3Time, reveal: d.revealTime };
}

export type ReadyKey = "place" | "prize" | "picture" | "elf" | "clues" | "droppedOff";

export const READY_WORDS: Record<ReadyKey, string> = {
  place: "The place",
  prize: "The prize",
  picture: "The door picture",
  elf: "The elf and its tag",
  clues: "The three clues",
  droppedOff: "Dropped off",
};

export interface Readiness {
  items: { key: ReadyKey; done: boolean }[];
  toDo: number;
  ready: boolean;
}

function filled(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim() !== "";
}

/** What a door still needs. */
export function readinessOf(d: DoorSetup, hasPicture: boolean): Readiness {
  const done: Record<ReadyKey, boolean> = {
    place: filled(d.placeName) && filled(d.placeTown) && filled(d.placeAddress),
    prize: filled(d.prize),
    picture: hasPicture,
    elf: filled(d.elfName) && filled(d.tagWord) && isUsableSecretWord(d.tagWord),
    clues: [1, 2, 3].every((n) => {
      const clue = d.clues.find((c) => c.n === n);
      return filled(clue?.words) || clue?.hasPicture === true;
    }),
    droppedOff: d.droppedOffAt !== null,
  };
  const keys: ReadyKey[] = ["place", "prize", "picture", "elf", "clues", "droppedOff"];
  const items = keys.map((key) => ({ key, done: done[key] }));
  const toDo = items.filter((i) => !i.done).length;
  return { items, toDo, ready: toDo === 0 };
}

export function doorsSummary(
  rows: { setup: DoorSetup; hasPicture: boolean }[],
): { placesAgreed: number; prizesChosen: number; ready: number } {
  let placesAgreed = 0;
  let prizesChosen = 0;
  let ready = 0;
  for (const { setup, hasPicture } of rows) {
    const r = readinessOf(setup, hasPicture);
    if (r.items[0].done) placesAgreed++;
    if (r.items[1].done) prizesChosen++;
    if (r.ready) ready++;
  }
  return { placesAgreed, prizesChosen, ready };
}

/** One line a door, in door order. */
export function prizeListText(doors: Pick<DoorSetup, "door" | "prize">[]): string {
  return [...doors]
    .sort((a, b) => a.door - b.door)
    .map((d) => `Door ${d.door}: ${filled(d.prize) ? d.prize.trim() : "No prize yet"}`)
    .join("\n");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function doorWeekday(year: number, door: Door): string {
  return WEEKDAYS[new Date(Date.UTC(year, 11, door)).getUTCDay()];
}

/** The door pictures, keyed `${year}-${door}`. Filled in once the prize list is in. */
export const DOOR_PICTURES: Readonly<Record<string, string>> = {};

export function doorPicture(
  year: number,
  door: Door,
  pictures: Readonly<Record<string, string>> = DOOR_PICTURES,
): string | null {
  return pictures[`${year}-${door}`] ?? null;
}
