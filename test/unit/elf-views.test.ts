import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { DOOR_PICTURES } from "../../src/elf/door-setup";
import { runOf, waveOneRuns, type DoorRun } from "../../src/db/elf-game";
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";
import type { Door } from "../../src/elf/calendar";
import type { FamilyKnowledge } from "../../src/elf/catch-up";
import type { SavedGuess } from "../../src/elf/guess";
import { renderHqPage } from "../../src/elf/pages/hq";
import type { DetectiveNameParts } from "../../src/elf/names";
import type { DoorsDone } from "../../src/elf/progress";
import type { Scrapbook } from "../../src/elf/scrapbook";
import { calendarViewFor, entryViewFor, familyDoorView, goViewFor, hqViewFor, lookFromForm, posterViewFor, wardrobeViewFor, type FamilyRow } from "../../src/elf/views";
import { normalisePlaceName } from "../../src/elf/place-names";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { defaultLook } from "../../src/elf/wardrobe";

// NBCC Elf Detective School: turning what the database holds into what the screens show. Every
// family here is invented.

const SETTINGS = { ...ELF_DEFAULTS, schoolOn: true };
const NOW = new Date("2026-12-07T15:00:00.000Z");

const at = (iso: string) => new Date(iso);
const EMPTY_DONE: DoorsDone = { cracked: [], visited: [] };
// 7 December 2026 is a Monday: clue 1 at 5:30pm, clue 2 at 6pm, clue 3 at 6:30pm, the place at 7pm.
const SIX_10 = at("2026-12-07T18:10:00Z");
const SIX_45 = at("2026-12-07T18:45:00Z");
const SEVEN_30 = at("2026-12-07T19:30:00Z");

/** A door set up with an invented place, tag word and three clues. */
function setup(door: number, over: Partial<DoorSetup> = {}): DoorSetup {
  return {
    ...emptyDoor(door as Door, `code${door}`),
    placeName: "The Toy Shop",
    placeTown: "Troon",
    names: [{ id: 1, name: "Toy Shop" }],
    tagWord: "SNOWBALL",
    prize: "A pretend prize",
    elfName: "Bauble",
    clues: [
      { n: 1, words: "Practice clue 1: it lives where the kettle lives", hasPicture: false, pictureAlt: null },
      { n: 2, words: "Practice clue 2: it has a lid", hasPicture: true, pictureAlt: "A pretend picture" },
      { n: 3, words: "Practice clue 3: it whistles", hasPicture: false, pictureAlt: null },
    ],
    ...over,
  };
}
const run = (door: number, now: Date, over: Partial<DoorSetup> = {}): DoorRun => runOf(2026, setup(door, over), now);
const RUBY: DetectiveNameParts = { firstName: "Ruby", surname: "Tinselfoot", approved: false };
const BOOK: Scrapbook = {
  elves: [
    { visitId: 1, detective: RUBY, countsFrom: at("2026-12-07T19:00:00Z"), found: true, pictureUrl: "/elf/door/7/elf/1.png" },
    { visitId: 2, detective: RUBY, countsFrom: at("2026-12-07T19:10:00Z"), found: false, pictureUrl: "/elf/door/7/elf/2.png" },
  ],
  photos: [{ token: "tok1", url: "/elf/door/7/photo/tok1.jpg" }],
  count: 3,
};

interface CalOver {
  runs: DoorRun[];
  finders?: Map<Door, DetectiveNameParts[]>;
  counts?: Map<Door, { cracked: number; visited: number }>;
  scrapbooks?: Map<Door, Scrapbook>;
  now: Date;
}
const cal = (o: CalOver) =>
  calendarViewFor({ settings: SETTINGS, now: o.now, runs: o.runs, finders: o.finders ?? new Map(), counts: o.counts ?? new Map(), scrapbooks: o.scrapbooks ?? new Map() });
const WAVE_ONE = (now: Date) => waveOneRuns(2026, now);
/** The wave 1 doors with door 7 swapped for a real run. */
const withDoor7 = (now: Date, over: Partial<DoorSetup> = {}): DoorRun[] => [...WAVE_ONE(now).slice(0, 6), run(7, now, over), ...WAVE_ONE(now).slice(7)];
const calDoor7 = (o: Omit<CalOver, "runs">, over: Partial<DoorSetup> = {}) => cal({ ...o, runs: withDoor7(o.now, over) }).doors[6];

function hq(over: Partial<Parameters<typeof hqViewFor>[0]> & { now: Date }) {
  return hqViewFor({
    family: FAMILY,
    settings: { ...SETTINGS, doorsOn: true },
    runs: { runs: WAVE_ONE(over.now), practice: null },
    guesses: new Map(),
    typed: new Set(),
    doorsDone: new Map(),
    finders: new Map(),
    photos: [],
    entries: new Map(),
    ...over,
  });
}
/** A family that has neither guessed nor been anywhere. */
const NOTHING_DONE: FamilyKnowledge = { guesses: new Map(), typed: new Set() };
const wardrobe = (detective = FAMILY.detectives[0], doorsDone: DoorsDone = EMPTY_DONE) =>
  wardrobeViewFor({ detective, settings: SETTINGS, now: NOW, doorsDone, runs: WAVE_ONE(NOW), knowledge: NOTHING_DONE });
const FAMILY: FamilyRow = {
  id: 3,
  grownUpName: "Sam Example",
  email: "sam@example.com",
  detectives: [
    { id: 100, firstName: "Ruby", surname: "Tinselfoot", nameApproved: false, badgeNumber: 1, look: null, fresh: [], favourites: [] },
    { id: 101, firstName: "Leo", surname: "Frostwhistle", nameApproved: true, badgeNumber: 42, look: null, fresh: ["tree"], favourites: [] },
  ],
};

describe("Detective HQ before school starts", () => {
  const view = hq({ now: new Date("2026-11-13T09:00:00.000Z") });

  it("has no case today, and counts down to the first clue on Tuesday 1 December at 5:30pm", () => {
    expect(view.today).toBeNull();
    expect(view.nextClueAt?.toISOString()).toBe("2026-12-01T17:30:00.000Z");
  });

  it("greets the grown up by first name and shows each detective in full to their own family", () => {
    expect(view.familyName).toBe("Sam");
    expect(view.detectives.map((d) => d.name)).toEqual(["Detective Ruby Tinselfoot", "Detective Leo Frostwhistle"]);
    expect(view.detectives.map((d) => d.badgeNumber)).toEqual(["EDS 0001", "EDS 0042"]);
  });

  it("starts every detective as a Trainee, six doors from Junior Detective", () => {
    for (const d of view.detectives) {
      expect(d.rank).toBe("Trainee");
      expect(d.doorsDone).toBe(0);
      expect(d.next).toEqual({ rank: "Junior Detective", toGo: 6 });
    }
  });

  it("points at each detective's own elf and wardrobe", () => {
    expect(view.detectives[0].elfUrl).toBe("/elf/hq/elf/100.png");
    expect(view.detectives[0].wardrobeUrl).toBe("/elf/hq/wardrobe/100");
    expect(view.detectives[1].newThings).toBe(1);
  });

  it("hands HQ each detective's chosen frame, made safe, so their picture sits in it", () => {
    const framed = hq({
      family: {
        ...FAMILY,
        detectives: [
          { ...FAMILY.detectives[0], look: { frame: "gold" } },
          { ...FAMILY.detectives[1], look: { frame: "no-such-frame" } },
        ],
      },
      settings: SETTINGS,
      now: new Date("2026-11-13T09:00:00.000Z"),
    });
    expect(framed.detectives.map((d) => d.frame)).toEqual(["gold", null]);
    expect(view.detectives.map((d) => d.frame)).toEqual([null, null]);
  });
});

describe("the wardrobe", () => {
  it("is built from the doors the detective has done on the server, and a missing look is the starting elf", () => {
    const view = wardrobe();
    expect(view.state).toEqual({ doors: [] });
    expect(view.look).toEqual(defaultLook());
    expect(view.favourites).toEqual([]);
    expect(view.saveUrl).toBe("/api/elf/look");
    expect(view.calendarUrl).toBe("/elf");
  });

  it("makes the saved look safe, so an old layered look shows as the start with its own skin and hair", () => {
    const old = { sibling: "brother", skin: "s4", hair: "black", hairStyle: "curly", outfit: "tree", pieces: { hat: ["bobble", "red"] } };
    const view = wardrobe({ ...FAMILY.detectives[0], look: old });
    expect(view.look).toEqual({ ...defaultLook(), sibling: "brother", skin: "s4", hair: "black", hairStyle: "curly" });
  });

  it("shows the saved favourite looks, made safe", () => {
    const favourites = [{ ...defaultLook(), scene: "largs" }, "junk", { ...defaultLook(), costume: "santa" }];
    const view = wardrobe({ ...FAMILY.detectives[0], favourites });
    expect(view.favourites).toEqual([{ ...defaultLook(), scene: "largs" }, defaultLook()]);
  });
});

describe("the wardrobe's days", () => {
  it("knows the time, and each door's day and clue time, as the calendar does", () => {
    const view = wardrobe();
    expect(view.now).toBe(NOW);
    expect(view.doorDays.map((d) => d.door)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    const calendar = cal({ runs: WAVE_ONE(NOW), now: NOW });
    expect(view.doorDays.map((d) => d.clueAt.toISOString())).toEqual(calendar.doors.map((d) => d.clueAt.toISOString()));
    expect(view.doorDays[6].date).toBe("2026-12-07");
  });

  it("folds step 1 away only for an elf that has been made", () => {
    expect(wardrobe().made).toBe(false);
    expect(wardrobe({ ...FAMILY.detectives[0], look: defaultLook() }).made).toBe(true);
  });
});

describe("a look from the plain form", () => {
  it("reads who the elf is, the costume and every extra, with an empty choice as none", () => {
    const look = lookFromForm({ sibling: "brother", skin: "s2", hair: "ginger", hairStyle: "bunches", costume: "", scene: "ayr", friend: "robin", frame: "", glasses: "specs-gold", bow: "" });
    expect(look).toEqual({ sibling: "brother", skin: "s2", hair: "ginger", hairStyle: "bunches", costume: null, scene: "ayr", friend: "robin", frame: null, glasses: "specs-gold", bow: null });
  });

  it("reads only words, never anything else the form sends", () => {
    const look = lookFromForm({ costume: ["tree"], scene: { x: 1 }, friend: 7 });
    expect(look).toMatchObject({ costume: null, scene: "", friend: null });
  });
});

describe("the public calendar before December", () => {
  const view = cal({ runs: WAVE_ONE(new Date("2026-11-20T10:00:00.000Z")), now: new Date("2026-11-20T10:00:00.000Z") });

  it("has 24 doors, every one shut, with nothing about where any elf hides", () => {
    expect(view.doors.length).toBe(24);
    for (const d of view.doors) {
      expect(d.state).toBe("shut");
      expect(d.place).toBeNull();
      expect(d.found).toBeNull();
    }
  });

  it("counts down to door 1's first clue, at 5:30pm on Tuesday 1 December, and weekend doors at 10am", () => {
    expect(view.doors[0].clueAt.toISOString()).toBe("2026-12-01T17:30:00.000Z");
    // Saturday 5 December
    expect(view.doors[4].clueAt.toISOString()).toBe("2026-12-05T10:00:00.000Z");
  });

  // TASK-613: places close early on Christmas Eve, so its door is in the morning, a Thursday though it is.
  it("shows Christmas Eve's door at 10am, and the Wednesday before it after school", () => {
    expect(view.doors[23].clueAt.toISOString()).toBe("2026-12-24T10:00:00.000Z");
    expect(view.doors[22].clueAt.toISOString()).toBe("2026-12-23T17:30:00.000Z");
  });

  it("shows the price the admin set, as words", () => {
    expect(view.price).toEqual({ from: "£1", suggested: "£5" });
    expect(view.joinUrl).toBe("/elf/join");
    expect(view.hqUrl).toBe("/elf/hq");
  });
});

describe("the calendar's doors through the evening", () => {
  it("gives a found door with its place still hidden no place, scrapbook, counts or prize, and names the finders in public form", () => {
    const d = calDoor7(
      { now: SIX_45, finders: new Map([[7 as Door, [RUBY]]]), scrapbooks: new Map([[7 as Door, BOOK]]), counts: new Map([[7 as Door, { cracked: 2, visited: 3 }]]) },
      { foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 },
    );
    expect(d.state).toBe("found-hidden");
    expect(d.place).toBeNull();
    expect(d.found).toEqual({ at: at("2026-12-07T18:40:00Z"), by: "Detective R. Tinselfoot" });
    expect(d.revealAt?.toISOString()).toBe("2026-12-07T19:00:00.000Z");
    expect(d.scrapbook).toBeNull();
    expect(d.counts).toBeNull();
    expect(d.collage).toEqual([]);
    expect(d.prize).toBeNull();
    expect(d.factLine).toBeNull();
  });

  // Plan 2c-1, Task 4: before Christmas Day the calendar everyone shares names no place and shows no photo.
  it("gives a found door its elves, collage, counts and prize, even with Show it off unticked, but not its place or photos", () => {
    const d = calDoor7(
      { now: SEVEN_30, finders: new Map([[7 as Door, [RUBY]]]), scrapbooks: new Map([[7 as Door, BOOK]]), counts: new Map([[7 as Door, { cracked: 2, visited: 3 }]]) },
      { foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3, prizeShowOff: false },
    );
    expect(d.state).toBe("found");
    expect(d.place).toBeNull();
    expect(d.goUrl).toBe("/elf/hq/door/7");
    expect(d.revealAt).toBeNull();
    expect(d.scrapbook).toEqual({ elves: BOOK.elves, photos: [], count: 2 });
    expect(d.counts).toEqual({ cracked: 2, visited: 3 });
    expect(d.collage).toEqual(["/elf/door/7/elf/1.png", "/elf/door/7/elf/2.png"]);
    expect(d.prize).toBe("A pretend prize");
    expect(d.teaser).toBeNull();
    expect(d.bigPrize).toBe(false);
    expect(d.factLine).not.toBeNull();
  });

  it("gives a snowed in door no place, no finder, no counts and no fact", () => {
    const d = calDoor7({ now: SIX_10 }, { snowDayAt: at("2026-12-07T17:30:00Z") });
    expect(d.state).toBe("snow");
    expect(d.place).toBeNull();
    expect(d.found).toBeNull();
    expect(d.counts).toBeNull();
    expect(d.scrapbook).toBeNull();
    expect(d.prize).toBeNull();
    expect(d.factLine).toBeNull();
  });

  it("shows the teaser before the find only when Show it off is ticked", () => {
    const plain = calDoor7({ now: SIX_10 }, { prizeShowOff: false });
    const shown = calDoor7({ now: SIX_10 }, { prizeShowOff: true });
    expect(plain.state).toBe("hunting");
    expect(plain.teaser).toBeNull();
    expect(plain.bigPrize).toBe(false);
    expect(shown.teaser).toBe("A pretend prize");
    expect(shown.bigPrize).toBe(true);
    expect(shown.prize).toBeNull();
  });

  it("never carries the practice run", () => {
    const practice = { ...run(7, SIX_10), door: 0 as const };
    const view = cal({ runs: [...WAVE_ONE(SIX_10), practice], now: SIX_10 });
    expect(view.doors.map((d) => d.door)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("takes door 3's clue 1 time from the run's calendarAt, never the far future, for a wave 1 door that has passed", () => {
    const now = at("2026-12-07T18:10:00Z");
    const view = cal({ runs: waveOneRuns(2026, now), now });
    expect(view.doors[2].state).toBe("shut");
    expect(view.doors[2].clueAt.toISOString()).toBe("2026-12-03T17:30:00.000Z");
    for (const d of view.doors) expect(d.clueAt.getTime()).toBeLessThan(Date.UTC(2027, 0, 1));
  });

  it("writes no place, clue word, tag word or prize into a shut, hunting, found-hidden or snowed in door", () => {
    const cases: [Date, Partial<DoorSetup>][] = [
      [at("2026-12-07T17:00:00Z"), {}],
      [SIX_10, {}],
      [SIX_45, { foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 }],
      [SIX_10, { snowDayAt: at("2026-12-07T17:30:00Z") }],
    ];
    for (const [now, over] of cases) {
      const text = JSON.stringify(calDoor7({ now }, { ...over, prizeShowOff: false }));
      for (const secret of ["Toy Shop", "Troon", "kettle", "SNOWBALL", "pretend prize", "/elf/door/7/photo"]) expect(text).not.toContain(secret);
    }
  });
});

// Plan 2c-1, Task 4, and Review Focus 4: the calendar everyone shares carries no place and no photo for an
// open door from its shown moment until Christmas Day, carries both from Christmas Day, and neither from 1
// January (Jaimie's answer 6). Door 7's run holds its place every time, and the scrapbook given for it holds
// a photo, so each test fails if either leaks. Door 7 is found at 5:47pm on Monday 7 December and its place
// shown at 7pm; never found, it is shown at the place's 8pm closing. December has no clock change, so
// London's time is UTC's.
const CORNER: Partial<DoorSetup> = { placeName: "Corner Bakehouse", placeTown: "Snowford", names: [{ id: 1, name: "The Bakehouse" }] };
const FOUND_AT_547: Partial<DoorSetup> = { ...CORNER, foundAt: at("2026-12-07T17:47:00Z"), foundFamilyId: 3 };
const SEVEN_05 = at("2026-12-07T19:05:00Z");
/** Door 7 on the calendar everyone shares at `now`, found at 5:47pm unless told otherwise. */
const shared7 = (now: Date, over: Partial<DoorSetup> = FOUND_AT_547) => calDoor7({ now, scrapbooks: new Map([[7 as Door, BOOK]]) }, over);

describe("the calendar everyone shares, from a door's shown moment to the new year", () => {
  it("gives an open door no place and no photo, and the go page, from its shown moment until Christmas Day", () => {
    for (const now of [SEVEN_05, at("2026-12-24T23:59:59Z")]) {
      const d = shared7(now);
      expect(d.state, now.toISOString()).toBe("found");
      expect(d.place).toBeNull();
      expect(d.goUrl).toBe("/elf/hq/door/7");
      expect(d.scrapbook?.photos).toEqual([]);
      // The elves stay, counted on their own.
      expect(d.scrapbook?.elves).toEqual(BOOK.elves);
      expect(d.scrapbook?.count).toBe(2);
      const text = JSON.stringify(d);
      for (const secret of ["Bakehouse", "Snowford", "/photo/", "tok1"]) expect(text, now.toISOString()).not.toContain(secret);
    }
  });

  it("does the same for a door shown with nobody found", () => {
    const d = shared7(at("2026-12-07T20:05:00Z"), CORNER);
    expect(d.state).toBe("revealed");
    expect(d.place).toBeNull();
    expect(d.goUrl).toBe("/elf/hq/door/7");
    expect(d.scrapbook?.photos).toEqual([]);
    for (const secret of ["Bakehouse", "Snowford", "/photo/"]) expect(JSON.stringify(d)).not.toContain(secret);
  });

  it("gives an open door its place and its scrapbook as given, photos and all, and no go page, from Christmas Day until 1 January", () => {
    for (const now of [at("2026-12-25T00:00:00Z"), at("2026-12-31T23:59:59Z")]) {
      const d = shared7(now);
      expect(d.place, now.toISOString()).toEqual({ name: "Corner Bakehouse", town: "Snowford" });
      expect(d.goUrl).toBeNull();
      expect(d.scrapbook).toBe(BOOK);
    }
  });

  it("takes the place and the photos off again from 1 January, and offers no go", () => {
    const d = shared7(at("2027-01-01T00:00:00Z"));
    expect(d.state).toBe("found");
    expect(d.place).toBeNull();
    expect(d.goUrl).toBeNull();
    expect(d.scrapbook?.photos).toEqual([]);
  });

  it("offers no go at a door that is not open: found with its place hidden, snowed in, hunted or shut", () => {
    expect(shared7(SIX_45, { ...CORNER, foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 })).toMatchObject({ state: "found-hidden", goUrl: null, place: null });
    expect(shared7(SIX_10, { ...CORNER, snowDayAt: at("2026-12-07T17:30:00Z") })).toMatchObject({ state: "snow", goUrl: null });
    expect(shared7(SIX_10, CORNER)).toMatchObject({ state: "hunting", goUrl: null });
    expect(shared7(at("2026-12-07T17:00:00Z"), CORNER)).toMatchObject({ state: "shut", goUrl: null });
  });

  // The spec: nothing worked out from the place either. The view is the same whatever the place is called.
  it("is the same whatever the place is called, so nothing on it can be worked out from the place", () => {
    const elsewhere = { ...FOUND_AT_547, placeName: "Mistletoe Mill", placeTown: "Exampleton", names: [] };
    expect(shared7(SEVEN_05, elsewhere)).toEqual(shared7(SEVEN_05));
  });
});

// Plan 2c-1, Task 4: a family's own door, which the family's own route draws for a family that can see the
// place (Task 5): the shared door with the place, its elves and the door's photos, and no go page.
describe("a family's own door", () => {
  const photos = [
    { token: "zz9photo", url: "/elf/door/7/photo/zz9photo.jpg" },
    { token: "aa1photo", url: "/elf/door/7/photo/aa1photo.jpg" },
  ];
  const mine = { place: { name: "Corner Bakehouse", town: "Snowford" }, photos };

  it("is the shared door with its place, its elves and the photos sorted by token and counted with them, and no go page", () => {
    const shared = shared7(SEVEN_05);
    const d = familyDoorView(shared, mine);
    expect(d.place).toEqual({ name: "Corner Bakehouse", town: "Snowford" });
    expect(d.scrapbook?.elves).toEqual(BOOK.elves);
    expect(d.scrapbook?.photos).toEqual([photos[1], photos[0]]);
    expect(d.scrapbook?.count).toBe(BOOK.elves.length + 2);
    expect(d.goUrl).toBeNull();
    // Everything else is the shared door's, and nothing given is changed.
    expect({ ...d, place: shared.place, scrapbook: shared.scrapbook, goUrl: shared.goUrl }).toEqual(shared);
    expect(photos.map((p) => p.token)).toEqual(["zz9photo", "aa1photo"]);
  });

  // From Christmas Day the shared door holds the photos too: the family's own door takes them from `mine`
  // alone, so none is shown twice.
  it("takes only the shared door's elves, so from Christmas Day no photo is shown twice", () => {
    const christmas = shared7(at("2026-12-25T00:00:00Z"));
    expect(christmas.scrapbook?.photos.length).toBe(1);
    const d = familyDoorView(christmas, mine);
    expect(d.scrapbook?.photos).toEqual([photos[1], photos[0]]);
    expect(d.scrapbook?.count).toBe(BOOK.elves.length + 2);
  });

  it("gives back a door that is not open as it was", () => {
    const hidden = shared7(SIX_45, { ...CORNER, foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 });
    expect(hidden.state).toBe("found-hidden");
    expect(familyDoorView(hidden, mine)).toBe(hidden);
  });
});

// Plan 2c-1, Task 6: having a go at a missed door, on its own page in Detective HQ. Door 7 is found at 5:47pm
// on Monday 7 December and its place shown at 7pm; the place closes at 8pm (typed as "20:00"). Its run holds
// the place every time, so each test that says the place is not in the view fails if it leaks.
describe("the go page's view", () => {
  const CLOSING: Partial<DoorSetup> = { ...FOUND_AT_547, closesAt: "20:00" };
  const PLACE = { name: "Corner Bakehouse", town: "Snowford" };
  const go7 = (now: Date, o: { guess?: SavedGuess | null; typed?: boolean; cluesShown?: number; finders?: DetectiveNameParts[]; over?: Partial<DoorSetup> } = {}) =>
    goViewFor({ run: run(7, now, { ...CLOSING, ...o.over }), now, guess: o.guess ?? null, typed: o.typed ?? false, finders: o.finders ?? [RUBY], cluesShown: o.cluesShown ?? 1 });
  /** A go, made at 7:05pm unless told otherwise: one guess, once the place was shown. */
  const go = (text: string, made = SEVEN_05): SavedGuess => ({ text, norm: normalisePlaceName(text), at: made, late: true });
  /** The practice door (year 0, door 0) on door 7's evening. */
  const practice = (now: Date): DoorRun => ({ ...run(7, now, CLOSING), year: 0, door: 0, closesAt: null });

  it("offers a family that missed the evening its go: clue 1, the link to the next, and the closing time", () => {
    const v = go7(SEVEN_05);
    expect(v.stage).toBe("go");
    expect(v).toMatchObject({ door: 7, practice: false, elfName: "Bauble", formUrl: "/elf/hq/door/7/go", hqUrl: "/elf/hq", guessError: null, outcome: null });
    expect(v.clues.map((c) => c.n)).toEqual([1]);
    expect(v.clues[0].words).toBe("Practice clue 1: it lives where the kettle lives");
    expect(v.nextUrl).toBe("/elf/hq/door/7?clues=2");
    expect(v.closesAt?.toISOString()).toBe("2026-12-07T20:00:00.000Z");
    expect(v.day.toISOString()).toBe("2026-12-07T17:30:00.000Z");
    expect(v.found).toEqual({ at: at("2026-12-07T17:47:00Z"), by: "Detective R. Tinselfoot" });
    expect(v.stillHiding).toBe(false);
    const text = JSON.stringify(v);
    for (const secret of ["Corner Bakehouse", "Snowford", "The Bakehouse"]) expect(text).not.toContain(secret);
  });

  it("shows the clues asked for, held to 1 to 3, with the next clue's link until all three show", () => {
    const three = go7(SEVEN_05, { cluesShown: 3 });
    expect(three.clues.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(three.nextUrl).toBeNull();
    expect(go7(SEVEN_05, { cluesShown: 2 })).toMatchObject({ nextUrl: "/elf/hq/door/7?clues=3" });
    expect(go7(SEVEN_05, { cluesShown: 2 }).clues.map((c) => c.n)).toEqual([1, 2]);
    expect(go7(SEVEN_05, { cluesShown: 9 }).clues.map((c) => c.n)).toEqual([1, 2, 3]);
    for (const odd of [0, -2, 1.5, Number.NaN]) expect(go7(SEVEN_05, { cluesShown: odd }).clues.map((c) => c.n), String(odd)).toEqual([1]);
  });

  // Ruling F11: one clue mapper, the one Detective HQ's case uses, so a picture is served by its own address.
  it("draws each clue as Detective HQ's case does, its picture and all", () => {
    const three = go7(SEVEN_05, { cluesShown: 3 });
    expect(three.clues[1]).toMatchObject({ n: 2, pictureUrl: "/elf/hq/clue/7/2.jpg", pictureAlt: "A pretend picture" });
    const today = hq({ now: SEVEN_05, runs: { runs: withDoor7(SEVEN_05, CLOSING), practice: null } }).today!;
    expect(three.clues).toEqual(today.clues);
  });

  it("offers no next clue that is not there: a door with clue 1 only shows it alone", () => {
    const one = go7(SEVEN_05, { cluesShown: 1, over: { clues: [setup(7).clues[0]] } });
    expect(one.clues.map((c) => c.n)).toEqual([1]);
    expect(one.nextUrl).toBeNull();
  });

  it("says when the hiding place closes only on the door's own day", () => {
    expect(go7(at("2026-12-08T10:00:00Z")).closesAt).toBeNull();
    expect(go7(SEVEN_05, { over: { closesAt: null } }).closesAt).toBeNull();
  });

  it("is done once the family has had its go: cracked, with no clues and no next link", () => {
    const v = go7(SEVEN_05, { guess: go("the bakehouse") });
    expect(v.stage).toBe("done");
    expect(v.clues).toEqual([]);
    expect(v.nextUrl).toBeNull();
    expect(v.outcome).toEqual({ verdict: "cracked", place: PLACE, stillHiding: false, goneHome: false, visited: false });
  });

  it("says wrong for any other guess, and cracked for a right guess saved on the night", () => {
    expect(go7(SEVEN_05, { guess: go("the toy shop") })).toMatchObject({ stage: "done", outcome: { verdict: "wrong", place: PLACE } });
    const night: SavedGuess = { text: "Corner Bakehouse", norm: normalisePlaceName("Corner Bakehouse"), at: at("2026-12-07T18:40:00Z"), late: false };
    expect(go7(SEVEN_05, { guess: night })).toMatchObject({ stage: "done", outcome: { verdict: "cracked" } });
  });

  it("is done for a family whose detective typed the tag word: no verdict, and visited", () => {
    const v = go7(SEVEN_05, { typed: true });
    expect(v.stage).toBe("done");
    expect(v.outcome).toEqual({ verdict: "none", place: PLACE, stillHiding: false, goneHome: false, visited: true });
  });

  it("is closed from midnight as Christmas Day begins, with the place for everyone until 1 January", () => {
    const christmas = go7(at("2026-12-25T00:00:00Z"));
    expect(christmas.stage).toBe("closed");
    expect(christmas.clues).toEqual([]);
    expect(christmas.outcome).toEqual({ verdict: "none", place: PLACE, stillHiding: false, goneHome: false, visited: false });
    const newYear = go7(at("2027-01-01T00:00:00Z"));
    expect(newYear.stage).toBe("closed");
    expect(newYear.outcome).toBeNull();
    expect(JSON.stringify(newYear)).not.toContain("Corner Bakehouse");
    // A family that has had its guess still sees how it went.
    expect(go7(at("2027-01-01T00:00:00Z"), { guess: go("the bakehouse") })).toMatchObject({ stage: "done", outcome: { verdict: "cracked" } });
  });

  // Ruling F8: the elf is still hiding only at a door shown with nobody found, and only until it goes home.
  it("knows the elf is still hiding at a door shown with nobody found, until it has gone home", () => {
    const unfound = { foundAt: null, foundFamilyId: null };
    const hiding = go7(at("2026-12-07T20:05:00Z"), { over: unfound });
    expect(hiding).toMatchObject({ stage: "go", stillHiding: true, found: null });
    expect(go7(at("2026-12-07T20:05:00Z"), { over: unfound, typed: true }).outcome).toMatchObject({ stillHiding: true, goneHome: false });
    const home = { ...unfound, goneHomeAt: at("2026-12-07T20:01:00Z") };
    expect(go7(at("2026-12-07T20:05:00Z"), { over: home })).toMatchObject({ stage: "go", stillHiding: false });
    expect(go7(at("2026-12-07T20:05:00Z"), { over: home, typed: true }).outcome).toMatchObject({ stillHiding: false, goneHome: true });
  });

  it("says A detective when a found elf has no finder rows, never a name", () => {
    expect(go7(SEVEN_05, { finders: [] }).found?.by).toBe("A detective");
  });

  it("names no finder before the moment of the find", () => {
    expect(go7(SIX_10, { over: { foundAt: at("2026-12-07T18:40:00Z") } }).found).toBeNull();
  });

  // Rulings on Plan 2c-1, the notes for every task that shows a place: the one rule is asked only of an open door.
  it("never gives the place before the door opens, even to the family whose detective typed the tag word", () => {
    const v = go7(SIX_45, { typed: true, guess: go("the bakehouse", SIX_10) });
    expect(v.stage).toBe("closed");
    expect(v.outcome).toBeNull();
    expect(v.clues).toEqual([]);
    expect(JSON.stringify(v)).not.toContain("Corner Bakehouse");
  });

  it("never tells the place of a door that did not open, even from Christmas Day: a snowed in door keeps it", () => {
    const snowed = go7(at("2026-12-25T00:00:00Z"), { over: { foundAt: null, foundFamilyId: null, snowDayAt: at("2026-12-07T17:30:00Z") } });
    expect(snowed).toMatchObject({ stage: "closed", outcome: null });
    expect(JSON.stringify(snowed)).not.toContain("Corner Bakehouse");
  });

  it("gives an open door with no place no outcome", () => {
    expect(go7(SEVEN_05, { typed: true, over: { placeName: null, placeTown: null } }).outcome).toBeNull();
  });

  it("carries the words of a go refused from the form with no script", () => {
    const v = goViewFor({ run: run(7, SEVEN_05, CLOSING), now: SEVEN_05, guess: null, typed: false, finders: [], cluesShown: 2, guessError: "That is a bit long." });
    expect(v.guessError).toBe("That is a bit long.");
  });

  it("plays the practice door as door 0, whose go never closes, with no pictures and no closing time", () => {
    const v = goViewFor({ run: practice(SEVEN_05), now: SEVEN_05, guess: null, typed: false, finders: [], cluesShown: 3 });
    expect(v).toMatchObject({ door: 0, practice: true, stage: "go", formUrl: "/elf/hq/door/0/go", closesAt: null });
    expect(v.clues.map((c) => c.pictureUrl)).toEqual([null, null, null]);
    expect(goViewFor({ run: practice(SEVEN_05), now: SEVEN_05, guess: null, typed: false, finders: [], cluesShown: 1 }).nextUrl).toBe("/elf/hq/door/0?clues=2");
    const christmas = at("2026-12-25T00:00:00Z");
    expect(goViewFor({ run: practice(christmas), now: christmas, guess: null, typed: false, finders: [], cluesShown: 1 }).stage).toBe("go");
    // As Detective HQ's case, the practice door names no finder, whatever it is handed.
    expect(goViewFor({ run: practice(SEVEN_05), now: SEVEN_05, guess: null, typed: false, finders: [RUBY], cluesShown: 1 }).found?.by).toBe("A detective");
  });

  // Rulings on Plan 2c-1, from Task 6's review: once the elf has gone home unfound the page says nobody found
  // it, with no "yet", so the view says whether it has gone home; and no closing time is said after then.
  it("says whether the elf has gone home, and gives no closing time once it has", () => {
    expect(go7(SEVEN_05).goneHome).toBe(false);
    const SEVEN_30 = at("2026-12-07T19:30:00Z");
    expect(go7(SEVEN_30, { over: { goneHomeAt: at("2026-12-07T19:20:00Z") } })).toMatchObject({ goneHome: true, closesAt: null });
    const unfound = { foundAt: null, foundFamilyId: null, goneHomeAt: at("2026-12-07T20:01:00Z") };
    expect(go7(at("2026-12-07T20:05:00Z"), { over: unfound })).toMatchObject({ found: null, stillHiding: false, goneHome: true });
  });
});

// Plan 2c-1, Task 7: Detective HQ catches up. At 7:05pm on Monday 7 December, door 7, found at 5:47pm, has had
// its place shown since 7pm, and the place closes at 8pm (typed as "20:00"). Doors 3 and 5 were found on their
// days and are open; doors 4 and 6 were snowed in. Every run holds its place, so each test that says the
// place is not in the view fails if it leaks.
const DOOR7_CLOSING: Partial<DoorSetup> = { ...FOUND_AT_547, closesAt: "20:00" };
/** The doors at `now`: 3 and 5 found and open, 4 and 6 snowed in, 7 as given (found at 5:47pm and closing
 *  at 8pm unless told otherwise), and the rest wave 1's. */
function catchUpDoors(now: Date, seven: Partial<DoorSetup> = DOOR7_CLOSING): DoorRun[] {
  const wave = WAVE_ONE(now);
  return [
    wave[0],
    wave[1],
    run(3, now, { ...CORNER, elfName: "Pudding", foundAt: at("2026-12-03T18:10:00Z"), foundFamilyId: 4 }),
    run(4, now, { snowDayAt: at("2026-12-04T17:30:00Z") }),
    run(5, now, { ...CORNER, elfName: "Sprout", foundAt: at("2026-12-05T11:10:00Z"), foundFamilyId: 4 }),
    run(6, now, { snowDayAt: at("2026-12-06T10:00:00Z") }),
    run(7, now, seven),
    ...wave.slice(7),
  ];
}
/** A guess saved on the night, or a go (`late`). */
const saved = (text: string, made: Date, late = false): SavedGuess => ({ text, norm: normalisePlaceName(text), at: made, late });

describe("Detective HQ catching up", () => {
  const hq7 = (o: { now?: Date; guesses?: [number, SavedGuess][]; typed?: number[]; seven?: Partial<DoorSetup>; settings?: typeof SETTINGS } = {}) => {
    const now = o.now ?? SEVEN_05;
    return hq({
      now,
      runs: { runs: catchUpDoors(now, o.seven), practice: null },
      guesses: new Map(o.guesses ?? []),
      typed: new Set(o.typed ?? []),
      ...(o.settings ? { settings: o.settings } : {}),
    });
  };

  it("offers a family that has neither guessed nor been to today's door its go, with no outcome, and says when the place closes", () => {
    const today = hq7().today!;
    expect(today).toMatchObject({ door: 7, state: "found", canGuess: false, outcome: null, goUrl: "/elf/hq/door/7" });
    expect(today.closesAt?.toISOString()).toBe("2026-12-07T20:00:00.000Z");
    for (const secret of ["Corner Bakehouse", "Snowford", "The Bakehouse"]) expect(JSON.stringify(today)).not.toContain(secret);
  });

  it("tells a family that guessed on the night how it went, and offers no go", () => {
    const today = hq7({ guesses: [[7, saved("the bakehouse", at("2026-12-07T18:40:00Z"))]] }).today!;
    expect(today.outcome).toMatchObject({ place: "Corner Bakehouse", cracked: true });
    expect(today.goUrl).toBeNull();
    expect(today.closesAt?.toISOString()).toBe("2026-12-07T20:00:00.000Z");
  });

  it("tells a family whose detective typed the tag word where the elf was, and offers no go", () => {
    const today = hq7({ typed: [7] }).today!;
    expect(today.outcome).toMatchObject({ place: "Corner Bakehouse", cracked: false });
    expect(today.goUrl).toBeNull();
  });

  it("says a go at today's door cracked the case once the family has had it", () => {
    const today = hq7({ guesses: [[7, saved("the bakehouse", SEVEN_05, true)]] }).today!;
    expect(today.outcome?.cracked).toBe(true);
    expect(today.goUrl).toBeNull();
  });

  // Rulings on Plan 2c-1, the notes for every task that shows a place: the one rule is asked only of an open door.
  it("never gives the place before the door opens, even to the family whose detective found the elf", () => {
    const today = hq7({ now: SIX_45, typed: [7], guesses: [[7, saved("the bakehouse", SIX_10)]], seven: { ...DOOR7_CLOSING, foundAt: at("2026-12-07T18:40:00Z") } }).today!;
    expect(today.state).toBe("found-hidden");
    expect(today.outcome).toBeNull();
    expect(today.goUrl).toBeNull();
    expect(JSON.stringify(today)).not.toContain("Corner Bakehouse");
  });

  it("still offers the go once the elf has gone home, with no closing time", () => {
    const today = hq7({ seven: { ...DOOR7_CLOSING, goneHomeAt: at("2026-12-07T19:02:00Z") } }).today!;
    expect(today).toMatchObject({ goUrl: "/elf/hq/door/7", closesAt: null, outcome: null });
  });

  // Task 9, fix round 1 (the review's Minor 1): whether a family may find out later than the reveal is the run's
  // own: while the elf is hunted and the place closes after the reveal (its typed closing, or the 8pm a door
  // falls back to). Never the closing time HQ shows, which is gone once it has passed.
  it("says the place may be shown later than the reveal only while the elf is hunted and the place closes after it", () => {
    const hunting = (closesAt: string | null, now = SIX_45) => hq7({ now, seven: { ...CORNER, closesAt } }).today!;
    expect(hunting("20:00").mayShowLater).toBe(true);
    // The 8pm a door falls back to, with no closing time typed (ruling F13).
    expect(hunting(null).mayShowLater).toBe(true);
    expect(hunting("19:00").mayShowLater).toBe(false);
    expect(hunting("18:45", at("2026-12-07T18:50:00Z")).mayShowLater).toBe(false);
    const found = hq7({ now: SIX_10, seven: { ...CORNER, closesAt: "20:00", foundAt: at("2026-12-07T18:05:00Z"), foundFamilyId: 3 } }).today!;
    expect(found).toMatchObject({ state: "found-hidden", mayShowLater: false });
  });

  // Fix round 1 (the ruling on the ladder's sibling line): once the reveal time has passed with the elf still
  // hiding, its place is shown when it is found or at the place's closing, typed or the 8pm fallback.
  it("gives the latest the place is shown while the elf is hunted, and says it once the reveal has passed", () => {
    const latest = (closesAt: string | null, now: Date) => hq7({ now, seven: { ...CORNER, closesAt } }).today!.shownBy?.toISOString() ?? null;
    expect(latest("20:30", SEVEN_05)).toBe("2026-12-07T20:30:00.000Z");
    expect(latest(null, SEVEN_05)).toBe("2026-12-07T20:00:00.000Z");
    // Before the reveal, an unfound elf's place is shown at the reveal at the latest when the place closes first.
    expect(latest("18:45", at("2026-12-07T18:50:00Z"))).toBe("2026-12-07T19:00:00.000Z");
    expect(hq7({ now: SIX_10, seven: { ...CORNER, foundAt: at("2026-12-07T18:05:00Z"), foundFamilyId: 3 } }).today!.shownBy).toBeNull();
    expect(hq7().today!.shownBy).toBeNull();
    const page = renderHqPage(hq7({ now: SEVEN_05, seven: { ...CORNER, closesAt: null } }));
    expect(page).toContain("You find out whether you cracked it as soon as the elf is found, or at 8pm at the latest.");
  });

  // The whole-branch review, Important 1: a closing typed at or before clue 1 is read as that time the next day
  // (closingInstant), so it is never the latest a family finds out today. HQ names a latest only when it falls on
  // the door's own day; otherwise the sentence ends at "found".
  it("names no latest when the closing typed falls on the next day, a 5pm closing with a 5:30pm clue", () => {
    const view = hq7({ now: at("2026-12-07T19:15:00Z"), seven: { ...CORNER, closesAt: "17:00" } });
    expect(view.today).toMatchObject({ state: "hunting", shownBy: null });
    const page = renderHqPage(view);
    expect(page).toContain("You find out whether you cracked it as soon as the elf is found.");
    expect(page).not.toContain("at the latest");
  });

  it("says only the reveal's time between a closing typed before the reveal and the reveal", () => {
    const view = hq7({ now: at("2026-12-07T18:50:00Z"), seven: { ...CORNER, closesAt: "18:45" } });
    expect(view.today).toMatchObject({ state: "hunting", closesAt: null });
    const page = renderHqPage(view);
    expect(page).toContain("You find out whether you cracked it at 7pm.");
    expect(page).not.toContain("or later if the elf is still hiding then");
  });

  // Task 9, from Task 7's review: the case knows when the elf has gone home, so it never promises the prize or a
  // visit then.
  it("says whether today's elf has gone home", () => {
    expect(hq7().today!.goneHome).toBe(false);
    const gone = hq7({ guesses: [[7, saved("the bakehouse", at("2026-12-07T18:40:00Z"))]], seven: { ...DOOR7_CLOSING, goneHomeAt: at("2026-12-07T19:02:00Z") } }).today!;
    expect(gone).toMatchObject({ goneHome: true, outcome: { place: "Corner Bakehouse", cracked: true } });
  });

  it("offers the practice door's go, once its place is shown, to a family that has not guessed it", () => {
    const practice: DoorRun = { ...run(7, SEVEN_05, DOOR7_CLOSING), year: 0, door: 0, closesAt: null };
    const view = hq({ now: SEVEN_05, runs: { runs: catchUpDoors(SEVEN_05), practice } });
    expect(view.today).toMatchObject({ door: 0, practice: true, outcome: null, goUrl: "/elf/hq/door/0", closesAt: null });
    const guessed = hq({ now: SEVEN_05, runs: { runs: catchUpDoors(SEVEN_05), practice }, guesses: new Map([[0, saved("the bakehouse", SIX_10)]]) });
    expect(guessed.today).toMatchObject({ goUrl: null, outcome: { cracked: true } });
  });

  it("lists the other doors the family can still crack, newest first, each with its day, elf and go page, but not today's", () => {
    const view = hq7();
    expect(view.toCrack).toEqual([
      { door: 5, elfName: "Sprout", clueAt: at("2026-12-05T10:00:00Z"), url: "/elf/hq/door/5" },
      { door: 3, elfName: "Pudding", clueAt: at("2026-12-03T17:30:00Z"), url: "/elf/hq/door/3" },
    ]);
    for (const secret of ["Corner Bakehouse", "Snowford"]) expect(JSON.stringify(view.toCrack)).not.toContain(secret);
  });

  it("leaves a door off the list once the family has guessed it, rightly or wrongly, or been there", () => {
    expect(hq7({ guesses: [[5, saved("the toy shop", at("2026-12-05T10:40:00Z"))]] }).toCrack.map((d) => d.door)).toEqual([3]);
    expect(hq7({ typed: [3] }).toCrack.map((d) => d.door)).toEqual([5]);
  });

  // Ruling F9: the list leaves out only the door today's case shows.
  it("keeps today's real door on the list while today's case is the practice door", () => {
    const practice: DoorRun = { ...run(7, SEVEN_05, DOOR7_CLOSING), year: 0, door: 0, closesAt: null };
    expect(hq({ now: SEVEN_05, runs: { runs: catchUpDoors(SEVEN_05), practice } }).toCrack.map((d) => d.door)).toEqual([7, 5, 3]);
  });

  it("lists no door from midnight as Christmas Day begins", () => {
    expect(hq7({ now: at("2026-12-25T00:00:00Z") }).toCrack).toEqual([]);
  });

  // Review Focus 5: with December's doors off, Detective HQ is exactly today's.
  it("lists nothing, and the page says nothing new, with December's doors off", () => {
    const off = hq7({ settings: { ...SETTINGS, doorsOn: false } });
    expect(off.today).toBeNull();
    expect(off.toCrack).toEqual([]);
    const page = renderHqPage(off);
    for (const words of ["Doors you can still crack", "Have a go", "closes at"]) expect(page).not.toContain(words);
  });
});

// Ruling F7: a missed door's costume says "Crack it in Detective HQ to catch up" only while the family can still
// crack that door, so never at a door it guessed wrongly, nor at any door from Christmas Day.
describe("the wardrobe's doors still to crack", () => {
  const ON = { ...SETTINGS, doorsOn: true };
  const crackable = (o: { now?: Date; knowledge?: FamilyKnowledge; settings?: typeof SETTINGS } = {}) => {
    const now = o.now ?? SEVEN_05;
    return wardrobeViewFor({ detective: FAMILY.detectives[0], settings: o.settings ?? ON, now, doorsDone: EMPTY_DONE, runs: catchUpDoors(now), knowledge: o.knowledge ?? NOTHING_DONE }).crackable;
  };

  it("are the doors the family may still have a go at, newest first", () => {
    expect(crackable()).toEqual([7, 5, 3]);
  });

  it("leave out a door the family guessed, even wrongly, and one it has been to", () => {
    expect(crackable({ knowledge: { guesses: new Map([[5, saved("the toy shop", at("2026-12-05T10:40:00Z"))]]), typed: new Set([3]) } })).toEqual([7]);
  });

  it("are none from midnight as Christmas Day begins", () => {
    expect(crackable({ now: at("2026-12-25T00:00:00Z") })).toEqual([]);
  });

  it("are none with December's doors off", () => {
    expect(crackable({ settings: SETTINGS })).toEqual([]);
  });
});

describe("Detective HQ with December's doors switched off", () => {
  const OFF = { ...SETTINGS, doorsOn: false };

  // Final review, Important 7: with the doors off, HQ is exactly wave 1's (origin/main), which counts
  // down to door 1's first clue and to nothing after it ("Every door is open"), never to a clue 2 or 3.
  it("has no case today, and counts down only to door 1's first clue, as wave 1's HQ did", () => {
    for (const now of [at("2026-11-13T09:00:00Z"), at("2026-12-01T17:29:00Z")]) {
      const view = hq({ now, settings: OFF, runs: { runs: WAVE_ONE(now), practice: null } });
      expect(view.today).toBeNull();
      expect(view.nextClueAt?.toISOString()).toBe("2026-12-01T17:30:00.000Z");
    }
    for (const now of [at("2026-12-01T17:30:00Z"), at("2026-12-07T10:00:00Z"), SIX_10]) {
      const view = hq({ now, settings: OFF, runs: { runs: WAVE_ONE(now), practice: null } });
      expect(view.today).toBeNull();
      expect(view.nextClueAt).toBeNull();
    }
  });

  it("gives the practice run as today for a practice browser, never a wave 1 door", () => {
    const practice = { ...run(7, SIX_10), door: 0 as const };
    const view = hq({ now: SIX_10, settings: OFF, runs: { runs: WAVE_ONE(SIX_10), practice } });
    expect(view.today?.door).toBe(0);
    expect(view.today?.practice).toBe(true);
  });
});

// Plan 2c-2, Task 3: Detective HQ's grand prize section. Ruby (detective 100) has done all 24 doors and Leo
// (detective 101) 23, as a family would whose doors were all snowed in but door 24. The entries close at 5pm
// on Christmas Eve unless a head elf set another time.
describe("Detective HQ's grand prize", () => {
  const EVERY_DOOR = Array.from({ length: 24 }, (_, i) => i + 1);
  const DONE = new Map<number, DoorsDone>([
    [100, { cracked: [], visited: [], snow: EVERY_DOOR }],
    [101, { cracked: [], visited: [], snow: EVERY_DOOR.slice(0, 23) }],
  ]);
  const FIVE_PM = at("2026-12-24T17:00:00.000Z");
  const prize = (now: Date, over: Partial<Parameters<typeof hqViewFor>[0]> = {}) => hq({ now, doorsDone: DONE, ...over }).grandPrize;

  it("lists only the detective who has done all 24 doors at 9am on Christmas Eve, open until 5pm", () => {
    expect(prize(at("2026-12-24T09:00:00.000Z"))).toEqual({
      closesAt: FIVE_PM,
      open: true,
      detectives: [{ name: "Detective Ruby Tinselfoot", url: "/elf/hq/entry/100", sent: false }],
    });
  });

  it("says the entries are closed from 5pm, and still shows the section until 1 January", () => {
    expect(prize(at("2026-12-24T16:59:59.000Z"))?.open).toBe(true);
    expect(prize(FIVE_PM)?.open).toBe(false);
    expect(prize(at("2026-12-31T23:59:59.000Z"))?.open).toBe(false);
    expect(prize(FIVE_PM)?.detectives.map((d) => d.url)).toEqual(["/elf/hq/entry/100"]);
  });

  it("is not there before midnight as Christmas Eve begins, nor from midnight as 1 January 2027 begins", () => {
    expect(prize(at("2026-12-23T23:59:00.000Z"))).toBeNull();
    expect(prize(at("2026-12-24T00:00:00.000Z"))).not.toBeNull();
    expect(prize(at("2027-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("is not there with December's doors off", () => {
    expect(prize(at("2026-12-24T09:00:00.000Z"), { settings: { ...SETTINGS, doorsOn: false } })).toBeNull();
  });

  it("says whose picture is in, from the family's entries", () => {
    const entries = new Map([[100, { sentAt: at("2026-12-24T10:45:00.000Z") }]]);
    expect(prize(at("2026-12-24T11:00:00.000Z"), { entries })?.detectives).toEqual([{ name: "Detective Ruby Tinselfoot", url: "/elf/hq/entry/100", sent: true }]);
  });

  it("lists both detectives once both have done all 24 doors, and none while neither has", () => {
    const both = new Map<number, DoorsDone>([...DONE].map(([id]) => [id, { cracked: [], visited: [], snow: EVERY_DOOR }]));
    expect(prize(at("2026-12-24T11:00:00.000Z"), { doorsDone: both })?.detectives.map((d) => d.name)).toEqual(["Detective Ruby Tinselfoot", "Detective Leo Frostwhistle"]);
    expect(prize(at("2026-12-24T11:00:00.000Z"), { doorsDone: new Map() })).toEqual({ closesAt: FIVE_PM, open: true, detectives: [] });
  });

  it("closes at the time a head elf set in Settings", () => {
    const settings = { ...SETTINGS, doorsOn: true, grandPrizeClosesAt: at("2026-12-24T18:30:00.000Z") };
    expect(prize(at("2026-12-24T18:00:00.000Z"), { settings })).toMatchObject({ closesAt: at("2026-12-24T18:30:00.000Z"), open: true });
    expect(prize(at("2026-12-24T18:30:00.000Z"), { settings })?.open).toBe(false);
  });
});

describe("the grand prize entry page's view", () => {
  const ruby = FAMILY.detectives[0];
  const FIVE_PM = at("2026-12-24T17:00:00.000Z");
  const entry = (over: Partial<Parameters<typeof entryViewFor>[0]> = {}) =>
    entryViewFor({ detective: ruby, hasMobile: true, closesAt: FIVE_PM, now: at("2026-12-24T10:30:00.000Z"), sentAt: null, ...over });

  it("names the detective as the family sees them, with where the picture goes and the way back", () => {
    expect(entry()).toEqual({
      detective: { id: "100", name: "Detective Ruby Tinselfoot" },
      closesAt: FIVE_PM,
      open: true,
      sent: null,
      askMobile: false,
      postUrl: "/api/elf/entry/100",
      hqUrl: "/elf/hq",
    });
  });

  it("gives the picture already in, with its private address", () => {
    const sentAt = at("2026-12-24T10:45:00.000Z");
    expect(entry({ sentAt }).sent).toEqual({ at: sentAt, pictureUrl: "/elf/hq/entry/100/picture.jpg" });
  });

  it("asks for a mobile only when the family has none", () => {
    expect(entry({ hasMobile: false }).askMobile).toBe(true);
  });

  it("is open until the entries close, and closed from then", () => {
    expect(entry({ now: at("2026-12-24T16:59:59.000Z") }).open).toBe(true);
    expect(entry({ now: FIVE_PM }).open).toBe(false);
  });
});

describe("a door's prize words and picture", () => {
  const found = { foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 };

  it("gives found-hidden and snow doors no teaser, even with Show it off ticked", () => {
    expect(calDoor7({ now: SIX_45 }, { ...found, prizeShowOff: true }).teaser).toBeNull();
    expect(calDoor7({ now: SIX_10 }, { snowDayAt: at("2026-12-07T17:30:00Z"), prizeShowOff: true }).teaser).toBeNull();
    expect(calDoor7({ now: at("2026-12-07T20:30:00Z") }, { prizeShowOff: true }).teaser).toBe("A pretend prize");
  });

  // Final review, Important 7: the page and each door read wave 1's words while the doors are off.
  it("carries whether December's doors are on, for the page and for every door", () => {
    const on = calendarViewFor({ settings: { ...SETTINGS, doorsOn: true }, now: SIX_10, runs: withDoor7(SIX_10), finders: new Map(), counts: new Map(), scrapbooks: new Map() });
    const off = calendarViewFor({ settings: { ...SETTINGS, doorsOn: false }, now: SIX_10, runs: WAVE_ONE(SIX_10), finders: new Map(), counts: new Map(), scrapbooks: new Map() });
    expect(on.doorsOn).toBe(true);
    expect(on.doors.every((d) => d.doorsOn === true)).toBe(true);
    expect(off.doorsOn).toBe(false);
    expect(off.doors.every((d) => d.doorsOn === false)).toBe(true);
  });

  it("shows a door picture only with the doors switched on, never on a wave 1 run", () => {
    const pictures = DOOR_PICTURES as Record<string, string>;
    pictures["2026-7"] = "/elf/shape/pretend.svg";
    try {
      const on = calendarViewFor({ settings: { ...SETTINGS, doorsOn: true }, now: SIX_10, runs: withDoor7(SIX_10), finders: new Map(), counts: new Map(), scrapbooks: new Map() });
      const off = calendarViewFor({ settings: { ...SETTINGS, doorsOn: false }, now: SIX_10, runs: WAVE_ONE(SIX_10), finders: new Map(), counts: new Map(), scrapbooks: new Map() });
      expect(on.doors[6].shapeUrl).toBe("/elf/shape/pretend.svg");
      expect(off.doors.every((d) => d.shapeUrl === null)).toBe(true);
    } finally {
      delete pictures["2026-7"];
    }
  });

  it("says A detective when a found door has no finder rows, never a name", () => {
    const d = calDoor7({ now: SIX_45 }, found);
    expect(d.found?.by).toBe("A detective");
  });
});

describe("Detective HQ in the evening", () => {
  it("gives today's clues that are out and clue 3's time as the next clue, at 6:10pm", () => {
    const view = hq({ now: SIX_10, runs: { runs: withDoor7(SIX_10), practice: null } });
    const today = view.today!;
    expect(today.door).toBe(7);
    expect(today.practice).toBe(false);
    expect(today.state).toBe("hunting");
    expect(today.clues.map((c) => c.n)).toEqual([1, 2]);
    expect(today.clues[0].words).toBe("Practice clue 1: it lives where the kettle lives");
    expect(today.clues[1]).toMatchObject({ pictureUrl: "/elf/hq/clue/7/2.jpg", pictureAlt: "A pretend picture" });
    expect(today.nextClueAt?.toISOString()).toBe("2026-12-07T18:30:00.000Z");
    // The staff reveal time, 7pm, never the place's closing time (8pm).
    expect(today.revealAt?.toISOString()).toBe("2026-12-07T19:00:00.000Z");
    expect(today.canGuess).toBe(true);
    // Only the route sets a refused guess's words, for the form sent with no script.
    expect(today.guessError).toBeNull();
    expect(JSON.stringify(today)).not.toContain("it whistles");
    expect(JSON.stringify(today)).not.toContain("Toy Shop");
    expect(today.outcome).toBeNull();
  });

  // Final review, Important 2: an unfound door's place is shown at its closing time, which is wrong as the
  // reveal once the elf is found. So HQ says the staff reveal time until it passes, then nothing (the page
  // says "as soon as the elf is found"); a find before the reveal keeps the real shown time. The spec's
  // answer 5 (Plan 2c-1) tells a family when the place closes, but on its own, through closesAt, on the
  // door's own day: never as when the place is shown. The place closes at 8:30pm here.
  it("gives the staff reveal time before it and none after it while the elf hides, never the closing time as the reveal, and the closing time on its own", () => {
    const closing = { closesAt: "20:30" };
    const hunting = (now: Date) => hq({ now, runs: { runs: withDoor7(now, closing), practice: null } }).today!;
    expect(hunting(at("2026-12-07T18:45:00Z"))).toMatchObject({ state: "hunting", nextClueAt: null });
    expect(hunting(at("2026-12-07T18:45:00Z")).revealAt?.toISOString()).toBe("2026-12-07T19:00:00.000Z");
    expect(hunting(at("2026-12-07T18:59:59Z")).revealAt?.toISOString()).toBe("2026-12-07T19:00:00.000Z");
    expect(hunting(at("2026-12-07T19:00:00Z")).state).toBe("hunting");
    expect(hunting(at("2026-12-07T19:00:00Z")).revealAt).toBeNull();
    expect(hunting(at("2026-12-07T20:15:00Z")).revealAt).toBeNull();
    const foundHidden = hq({ now: SIX_45, runs: { runs: withDoor7(SIX_45, { ...closing, foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 }), practice: null } }).today!;
    expect(foundHidden.state).toBe("found-hidden");
    expect(foundHidden.revealAt?.toISOString()).toBe("2026-12-07T19:00:00.000Z");
    expect(foundHidden.closesAt?.toISOString()).toBe("2026-12-07T20:30:00.000Z");
    for (const now of [SIX_10, SIX_45, at("2026-12-07T19:00:00Z"), SEVEN_30, at("2026-12-07T20:15:00Z")]) {
      expect(hunting(now).revealAt?.toISOString(), now.toISOString()).not.toBe("2026-12-07T20:30:00.000Z");
      expect(hunting(now).closesAt?.toISOString(), now.toISOString()).toBe("2026-12-07T20:30:00.000Z");
    }
    // Not before clue 1, and not once the place has closed.
    expect(hunting(at("2026-12-07T17:00:00Z")).closesAt).toBeNull();
    expect(hunting(at("2026-12-07T20:30:00Z")).closesAt).toBeNull();
    // Never the 8pm a door falls back to with no closing time typed.
    expect(hq({ now: SIX_10, runs: { runs: withDoor7(SIX_10), practice: null } }).today!.closesAt).toBeNull();
  });

  it("keeps the same rule for the practice door, which closes an hour after its reveal", () => {
    const practice = (now: Date): DoorRun => ({ ...run(7, now), door: 0 as const, year: 0 });
    const today = (now: Date) => hq({ now, runs: { runs: WAVE_ONE(now), practice: practice(now) } }).today!;
    expect(today(SIX_45).revealAt?.toISOString()).toBe("2026-12-07T19:00:00.000Z");
    expect(today(SEVEN_30).state).toBe("hunting");
    expect(today(SEVEN_30).revealAt).toBeNull();
  });

  it("gives a snow day no clues and no next clue", () => {
    const view = hq({ now: SIX_10, runs: { runs: withDoor7(SIX_10, { snowDayAt: at("2026-12-07T17:30:00Z") }), practice: null } });
    expect(view.today?.state).toBe("snow");
    expect(view.today?.clues).toEqual([]);
    expect(view.today?.nextClueAt).toBeNull();
    expect(view.today?.canGuess).toBe(false);
  });

  it("has no today before the day, and counts down to the next clue 1", () => {
    const now = at("2026-11-30T12:00:00Z");
    const view = hq({ now, runs: { runs: withDoor7(now), practice: null } });
    expect(view.today).toBeNull();
    expect(view.nextClueAt?.toISOString()).toBe("2026-12-01T17:30:00.000Z");
  });

  it("gives the practice run as today while it runs, door 0, practice true", () => {
    const practice = { ...run(7, SIX_10), door: 0 as const };
    const view = hq({ now: SIX_10, runs: { runs: withDoor7(SIX_10), practice } });
    expect(view.today?.practice).toBe(true);
    expect(view.today?.door).toBe(0);
  });

  it("shows a saved guess back as typed", () => {
    const guess: SavedGuess = { text: "  the toy SHOP ", norm: "toyshop", at: at("2026-12-07T18:05:00Z") };
    const view = hq({ now: SIX_10, runs: { runs: withDoor7(SIX_10), practice: null }, guesses: new Map([[7, guess]]) });
    expect(view.today?.guess).toEqual({ text: "  the toy SHOP ", at: at("2026-12-07T18:05:00Z") });
  });

  it("says cracked by cracked(): a guess saved before the place was shown, and not after", () => {
    const found = { foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 };
    const early: SavedGuess = { text: "Toy Shop", norm: "toyshop", at: at("2026-12-07T18:59:59Z") };
    const late: SavedGuess = { text: "Toy Shop", norm: "toyshop", at: at("2026-12-07T19:00:01Z") };
    const finders = new Map([[7 as Door, [RUBY]]]);
    const good = hq({ now: SEVEN_30, runs: { runs: withDoor7(SEVEN_30, found), practice: null }, guesses: new Map([[7, early]]), finders });
    const bad = hq({ now: SEVEN_30, runs: { runs: withDoor7(SEVEN_30, found), practice: null }, guesses: new Map([[7, late]]), finders });
    expect(good.today?.outcome).toEqual({ place: "The Toy Shop", by: "Detective R. Tinselfoot", at: at("2026-12-07T18:40:00Z"), cracked: true });
    expect(bad.today?.outcome?.cracked).toBe(false);
  });

  it("has no outcome while the place is hidden, even once found", () => {
    const view = hq({ now: SIX_45, runs: { runs: withDoor7(SIX_45, { foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 }), practice: null } });
    expect(view.today?.state).toBe("found-hidden");
    expect(view.today?.outcome).toBeNull();
    expect(view.today?.canGuess).toBe(true);
  });

  it("builds the marks and each detective's progress from the doors done, with snow days marked", () => {
    const done = new Map<number, DoorsDone>([[100, { cracked: [1, 2], visited: [2, 3], snow: [4] }]]);
    const now = at("2026-12-07T18:10:00Z");
    const runs = [...WAVE_ONE(now).slice(0, 3), run(4, now, { snowDayAt: at("2026-12-04T17:30:00Z") }), ...WAVE_ONE(now).slice(4)];
    const photos = [{ door: 3 as Door, token: "tok9", status: "waiting" as const }];
    const view = hq({ now, runs: { runs, practice: null }, doorsDone: done, photos });
    expect(view.marks.doors).toEqual([
      { door: 1, cracked: true, visited: false, snow: false },
      { door: 2, cracked: true, visited: true, snow: false },
      { door: 3, cracked: false, visited: true, snow: false },
      { door: 4, cracked: false, visited: false, snow: true },
    ]);
    expect(view.marks.photos).toEqual(photos);
    expect(view.detectives[0].doorsDone).toBe(4);
    expect(view.detectives[1].doorsDone).toBe(0);
  });
});

describe("the wardrobe from the detective's doors", () => {
  it("is built from the detective's own cracked, visited and snow doors", () => {
    const view = wardrobe(FAMILY.detectives[0], { cracked: [1], visited: [2], snow: [3] });
    expect(view.state).toEqual({ doors: [1, 2, 3] });
    expect(view.detective.doorsDone).toBe(3);
  });
});

describe("the poster page's view", () => {
  const poster = (now: Date, over: Partial<DoorSetup> = {}, family: FamilyRow | null = FAMILY) =>
    posterViewFor({ run: run(7, now, over), now, family, stamped: new Set([100]), yourPhoto: null });

  it("gives the same view for a shut door and a hunting door", () => {
    expect(poster(at("2026-12-07T17:00:00Z"))).toEqual(poster(SIX_10));
  });

  it("knows the family's detectives, who has the stamp, and the urls", () => {
    const v = poster(SIX_10);
    expect(v.signedIn).toBe(true);
    expect(v.detectives).toEqual([
      { id: "100", name: "Detective Ruby Tinselfoot", hasStamp: true },
      { id: "101", name: "Detective Leo Frostwhistle", hasStamp: false },
    ]);
    expect(v).toMatchObject({ code: "code7", door: 7, placeName: "The Toy Shop", placeTown: "Troon", open: false, claimable: true, foundHidden: false, revealAt: null, goneHome: false, yourPhoto: null, wordError: null });
    expect(v.wordUrl).toBe("/elf/p/code7/word");
    expect(v.photoUrl).toBe("/api/elf/p/code7/photo");
    expect(poster(SIX_10, {}, null)).toMatchObject({ signedIn: false, detectives: [] });
  });

  it("marks a found door whose place is hidden, with when it is shown, and a found door open", () => {
    const found = { foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 };
    expect(poster(SIX_45, found)).toMatchObject({ open: false, claimable: false, foundHidden: true });
    expect(poster(SIX_45, found).revealAt?.toISOString()).toBe("2026-12-07T19:00:00.000Z");
    expect(poster(SEVEN_30, found)).toMatchObject({ open: true, claimable: false, foundHidden: false, revealAt: null });
    expect(poster(at("2026-12-07T20:30:00Z"))).toMatchObject({ open: true, claimable: true });
  });

  it("says when the elves have gone home", () => {
    expect(poster(SEVEN_30, { goneHomeAt: at("2026-12-07T19:20:00Z") }).goneHome).toBe(true);
  });

  // Task 6: the page names the elf once its door is found or open, and only then.
  it("carries the door's elf name, the stock one when staff typed none", () => {
    expect(poster(SIX_10, { elfName: "Pudding" }).elfName).toBe("Pudding");
    expect(poster(SIX_10, { elfName: "" }).elfName).toBe("Bauble");
  });
});
