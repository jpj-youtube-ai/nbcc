import { isDoor } from "../../src/elf/calendar";
import { ELF_NAMES } from "../../src/elf/names";
import type { CalendarView, DoorView, HqView } from "../../src/elf/pages/types";

// NBCC Elf Detective School: pretend views for the screen tests. Every business and detective here
// is invented: the repository is public, and no real family's name belongs in it.

export const at = (iso: string): Date => new Date(iso);

const pad = (n: number): string => String(n).padStart(2, "0");

/** A calendar on the given day: the doors before it found, the day's own door as asked (shut unless
 *  told otherwise), and the later ones shut. Door 12 is a big prize. */
export function calendarView(now: Date, today: Partial<DoorView> = {}, over: Partial<CalendarView> = {}): CalendarView {
  const dayOfMonth = now.getUTCMonth() === 11 ? now.getUTCDate() : 0;
  const doors: DoorView[] = [];
  for (let n = 1; n <= 24; n++) {
    if (!isDoor(n)) continue;
    const base: DoorView = {
      door: n,
      state: "shut",
      clueAt: at(`2026-12-${pad(n)}T17:30:00.000Z`),
      shapeUrl: null,
      bigPrize: n === 12,
      teaser: n === 12 ? "Something with two wheels" : null,
      elfName: ELF_NAMES[n - 1],
      place: null,
      found: null,
      counts: null,
      factLine: null,
    };
    if (n < dayOfMonth) {
      doors.push({
        ...base,
        state: "found",
        place: { name: `Shop number ${n}`, town: "Ayr" },
        found: { at: at(`2026-12-${pad(n)}T18:05:00.000Z`), by: "Detective Ruby Tinselfoot", elfUrl: `/elf/pic/${n}.svg`, photoUrl: null },
        counts: { cracked: 10 + n, visited: n },
        factLine: "NBCC began with a question from a girl aged 12 in Annbank.",
      });
    } else if (n === dayOfMonth) {
      doors.push({ ...base, ...today });
    } else {
      doors.push(base);
    }
  }
  return {
    year: 2026,
    now,
    doors,
    places: [
      { name: "Shop number 1", town: "Ayr", found: true },
      { name: "The Toy Shop", town: "Troon", found: false },
      { name: "The Corner Bakery", town: "Kilmarnock", found: false },
    ],
    price: { from: "£1", suggested: "£5" },
    joinUrl: "/elf/join",
    hqUrl: "/elf/hq",
    ...over,
  };
}

/** Monday 7 December 2026 at 3pm: six doors found, door 7 waiting for its clue at 5:30pm. */
export const AFTERNOON = at("2026-12-07T15:00:00.000Z");

/** A family's own page that afternoon, a little later: door 7's clue is out and nobody has guessed. */
export function hqView(over: Partial<HqView> = {}): HqView {
  return {
    now: at("2026-12-07T17:40:00.000Z"),
    familyName: "Sam",
    detectives: [
      {
        id: "d1",
        name: "Detective Ruby Tinselfoot",
        nameApproved: true,
        badgeNumber: "0427",
        rank: "Trainee",
        doorsDone: 4,
        next: { rank: "Junior Detective", toGo: 2 },
        graduate: false,
        goldSeal: false,
        elfUrl: "/elf/pic/d1.svg",
        newThings: 3,
        wardrobeUrl: "/elf/hq/wardrobe/d1",
      },
      {
        id: "d2",
        name: "Detective Leo Frostwhistle",
        nameApproved: false,
        badgeNumber: "0428",
        rank: "Junior Detective",
        doorsDone: 6,
        next: { rank: "Detective", toGo: 6 },
        graduate: false,
        goldSeal: false,
        elfUrl: "/elf/pic/d2.svg",
        newThings: 0,
        wardrobeUrl: "/elf/hq/wardrobe/d2",
      },
    ],
    today: {
      door: 7,
      state: "hunting",
      clueAt: at("2026-12-07T17:30:00.000Z"),
      elfName: "Bauble",
      clue: "I am hiding where stories sleep on shelves.\nLook up, not down!",
      options: [
        { id: "p-toys", name: "The Toy Shop", town: "Troon" },
        { id: "p-books", name: "The Bookshop", town: "Ayr" },
        { id: "p-bakery", name: "The Corner Bakery", town: "Kilmarnock" },
      ],
      guess: null,
      outcome: null,
    },
    nextClueAt: at("2026-12-08T17:30:00.000Z"),
    marks: {
      doors: [
        { door: 1, cracked: true, visited: true },
        { door: 2, cracked: true, visited: false },
        { door: 4, cracked: false, visited: true },
      ],
    },
    calendarUrl: "/elf",
    guessUrl: "/elf/hq/guess",
    ...over,
  };
}
