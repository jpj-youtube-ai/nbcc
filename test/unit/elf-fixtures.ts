import { isDoor } from "../../src/elf/calendar";
import { ELF_NAMES } from "../../src/elf/names";
import type { CalendarView, ClaimWin, DoorView, GoView, HqView, PosterView, VisitWin, WardrobeView } from "../../src/elf/pages/types";

/** The page a family sees after scanning the poster at an invented shop. Signed in, two detectives,
 *  and the shop's door still shut on the calendar unless told otherwise. */
export function posterView(over: Partial<PosterView> = {}): PosterView {
  return {
    code: "toy-shop-k4f9",
    door: 7,
    elfName: "Bauble",
    placeName: "The Toy Shop",
    placeTown: "Troon",
    open: false,
    claimable: true,
    foundHidden: false,
    revealAt: null,
    goneHome: false,
    signedIn: true,
    detectives: [
      { id: "d1", name: "Detective Ruby Tinselfoot", hasStamp: false },
      { id: "d2", name: "Detective Leo Frostwhistle", hasStamp: false },
    ],
    joinUrl: "/elf/join",
    signInUrl: "/elf/sign-in",
    calendarUrl: "/elf",
    hqUrl: "/elf/hq",
    yourPhoto: null,
    wordError: null,
    wordUrl: "/elf/p/toy-shop-k4f9/word",
    photoUrl: "/api/elf/p/toy-shop-k4f9/photo",
    ...over,
  };
}

/** Ruby has just won door 7's elf. */
export function claimWin(over: Partial<ClaimWin> = {}): ClaimWin {
  return {
    door: 7,
    elfName: "Bauble",
    placeName: "The Toy Shop",
    at: new Date("2026-12-07T17:47:12.000Z"),
    now: new Date("2026-12-07T17:47:13.000Z"),
    detectives: [{ name: "Detective Ruby Tinselfoot", badgeNumber: "0427", rank: "Junior Detective", elfUrl: "/elf/pic/d1.svg" }],
    calendarUrl: "/elf",
    hqUrl: "/elf/hq",
    ...over,
  };
}

/** Ruby and Leo have typed the word at the shop after its elf was found. The visit took Ruby to six
 *  doors and a promotion. */
export function visitWin(over: Partial<VisitWin> = {}): VisitWin {
  return {
    door: 7,
    placeName: "The Toy Shop",
    countsFrom: null,
    detectives: [
      { name: "Detective Ruby Tinselfoot", doorsDone: 6, promotedTo: "Junior Detective", newThings: 4, wardrobeUrl: "/elf/hq/wardrobe/d1" },
      { name: "Detective Leo Frostwhistle", doorsDone: 1, promotedTo: null, newThings: 0, wardrobeUrl: "/elf/hq/wardrobe/d2" },
    ],
    photo: { door: 7, sendUrl: "/api/elf/p/toy-shop-k4f9/photo" },
    calendarUrl: "/elf",
    hqUrl: "/elf/hq",
    ...over,
  };
}

/** Ruby's wardrobe with doors 1 to 6 done: door 6's snow globe and puffin have just arrived, still
 *  wrapped. Ruby is in the reindeer costume and gold glasses, with a robin, at Largs, in a candy cane frame. */
export function wardrobeView(over: Partial<WardrobeView> = {}): WardrobeView {
  return {
    detective: {
      id: "d1",
      name: "Detective Ruby Tinselfoot",
      nameApproved: true,
      badgeNumber: "0427",
      rank: "Junior Detective",
      doorsDone: 6,
      next: { rank: "Detective", toGo: 6 },
      graduate: false,
      goldSeal: false,
      elfUrl: "/elf/pic/d1.svg",
      frame: "candy",
      newThings: 2,
      wardrobeUrl: "/elf/hq/wardrobe/d1",
    },
    look: { sibling: "sister", skin: "s3", hair: "ginger", hairStyle: "bunches", costume: "reindeer", scene: "largs", friend: "robin", frame: "candy", glasses: "specs-gold", bow: null },
    state: { doors: [1, 2, 3, 4, 5, 6] },
    fresh: ["snowglobe", "puffin"],
    favourites: [],
    made: true,
    // Monday 7 December 2026 at 3pm: door 7's clue is out at 5:30pm.
    now: at("2026-12-07T15:00:00.000Z"),
    doorDays: Array.from({ length: 24 }, (_, i) => ({ door: i + 1, clueAt: at(`2026-12-${pad(i + 1)}T17:30:00.000Z`), date: `2026-12-${pad(i + 1)}` })),
    // No door Ruby's family can still crack from Detective HQ (Plan 2c-1), unless told otherwise.
    crackable: [],
    hqUrl: "/elf/hq",
    calendarUrl: "/elf",
    saveUrl: "/elf/hq/wardrobe/d1",
    ...over,
  };
}

// NBCC Elf Detective School: pretend views for the screen tests. Every business and detective here
// is invented: the repository is public, and no real family's name belongs in it.

export const at = (iso: string): Date => new Date(iso);

const pad = (n: number): string => String(n).padStart(2, "0");

/** A calendar on the given day, with December's doors on: the doors before it found, the day's own door
 *  as asked (shut unless told otherwise), and the later ones shut. Door 12 is a big prize. */
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
      prize: null,
      elfName: ELF_NAMES[n - 1],
      place: null,
      found: null,
      revealAt: null,
      counts: null,
      scrapbook: null,
      collage: [],
      goneHome: false,
      factLine: null,
      doorsOn: true,
      // The doors before the day carry their places, as a family's own doors and everyone's from
      // Christmas Day do, so none of them offers a go.
      goUrl: null,
    };
    if (n < dayOfMonth) {
      doors.push({
        ...base,
        state: "found",
        place: { name: `Shop number ${n}`, town: "Ayr" },
        found: { at: at(`2026-12-${pad(n)}T18:05:00.000Z`), by: "Detective Ruby Tinselfoot" },
        counts: { cracked: 10 + n, visited: n },
        scrapbook: {
          elves: [{ visitId: n, detective: { firstName: "Ruby", surname: "Tinselfoot", approved: true }, countsFrom: at(`2026-12-${pad(n)}T18:05:00.000Z`), found: true, pictureUrl: `/elf/pic/${n}.svg` }],
          photos: [],
          count: 1,
        },
        collage: [`/elf/pic/${n}.svg`],
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
    price: { from: "£1", suggested: "£5" },
    joinUrl: "/elf/join",
    hqUrl: "/elf/hq",
    doorsOn: true,
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
        frame: null,
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
        frame: null,
        newThings: 0,
        wardrobeUrl: "/elf/hq/wardrobe/d2",
      },
    ],
    today: {
      door: 7,
      practice: false,
      state: "hunting",
      elfName: "Bauble",
      clues: [{ n: 1, at: at("2026-12-07T17:30:00.000Z"), words: "I am hiding where stories sleep on shelves.\nLook up, not down!", pictureUrl: null, pictureAlt: null }],
      nextClueAt: at("2026-12-07T18:00:00.000Z"),
      revealAt: at("2026-12-07T20:00:00.000Z"),
      guess: null,
      canGuess: true,
      guessError: null,
      outcome: null,
      goUrl: null,
      closesAt: null,
    },
    nextClueAt: at("2026-12-08T17:30:00.000Z"),
    // No missed door to crack (Plan 2c-1), unless told otherwise.
    toCrack: [],
    marks: {
      doors: [
        { door: 1, cracked: true, visited: true, snow: false },
        { door: 2, cracked: true, visited: false, snow: false },
        { door: 4, cracked: false, visited: true, snow: false },
      ],
      photos: [],
    },
    calendarUrl: "/elf",
    guessUrl: "/elf/hq/guess",
    ...over,
  };
}

/** Door 7's go page that evening at 7:05pm, for a family that missed it (Plan 2c-1): Twinkle was found at
 *  5:47pm, the place has been shown since 7pm and closes at 8pm, and clue 1 is showing. Having a go
 *  unless told otherwise. */
export function goView(over: Partial<GoView> = {}): GoView {
  return {
    door: 7,
    practice: false,
    elfName: "Twinkle",
    day: at("2026-12-07T17:30:00.000Z"),
    found: { at: at("2026-12-07T17:47:00.000Z"), by: "Detective R. Tinselfoot" },
    stage: "go",
    stillHiding: false,
    goneHome: false,
    clues: [{ n: 1, at: at("2026-12-07T17:30:00.000Z"), words: "I am hiding where the loaves cool.\nFollow your nose!", pictureUrl: null, pictureAlt: null }],
    nextUrl: "/elf/hq/door/7?clues=2",
    formUrl: "/elf/hq/door/7/go",
    guessError: null,
    closesAt: at("2026-12-07T20:00:00.000Z"),
    outcome: null,
    hqUrl: "/elf/hq",
    ...over,
  };
}

/** How door 7 went for a family that can see its place, Corner Bakehouse in Snowford: cracked, unless
 *  told otherwise. */
export function goOutcome(over: Partial<NonNullable<GoView["outcome"]>> = {}): NonNullable<GoView["outcome"]> {
  return { verdict: "cracked", place: { name: "Corner Bakehouse", town: "Snowford" }, stillHiding: false, goneHome: false, visited: false, ...over };
}

/** Door 7's go page once the family can see the place: how it went, with no clues and no form. */
export const goDoneView = (outcome: Partial<NonNullable<GoView["outcome"]>> = {}, over: Partial<GoView> = {}): GoView =>
  goView({ stage: "done", clues: [], nextUrl: null, outcome: goOutcome(outcome), ...over });
