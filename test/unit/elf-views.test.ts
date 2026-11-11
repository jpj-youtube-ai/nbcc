import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { DOOR_PICTURES } from "../../src/elf/door-setup";
import { runOf, waveOneRuns, type DoorRun } from "../../src/db/elf-game";
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";
import type { Door } from "../../src/elf/calendar";
import type { SavedGuess } from "../../src/elf/guess";
import type { DetectiveNameParts } from "../../src/elf/names";
import type { DoorsDone } from "../../src/elf/progress";
import type { Scrapbook } from "../../src/elf/scrapbook";
import { calendarViewFor, hqViewFor, lookFromForm, posterViewFor, wardrobeViewFor, type FamilyRow } from "../../src/elf/views";
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
    doorsDone: new Map(),
    finders: new Map(),
    photos: [],
    ...over,
  });
}
const wardrobe = (detective = FAMILY.detectives[0], doorsDone: DoorsDone = EMPTY_DONE) => wardrobeViewFor({ detective, settings: SETTINGS, now: NOW, doorsDone });
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

  it("gives a found door its place, scrapbook, collage and prize, even with Show it off unticked", () => {
    const d = calDoor7(
      { now: SEVEN_30, finders: new Map([[7 as Door, [RUBY]]]), scrapbooks: new Map([[7 as Door, BOOK]]), counts: new Map([[7 as Door, { cracked: 2, visited: 3 }]]) },
      { foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3, prizeShowOff: false },
    );
    expect(d.state).toBe("found");
    expect(d.place).toEqual({ name: "The Toy Shop", town: "Troon" });
    expect(d.revealAt).toBeNull();
    expect(d.scrapbook).toBe(BOOK);
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

describe("Detective HQ with December's doors switched off", () => {
  const OFF = { ...SETTINGS, doorsOn: false };

  it("has no case today and no countdown to clue 2 or 3, at 6:10pm and at 10am on 7 December", () => {
    for (const [now, next] of [[SIX_10, "2026-12-08T17:30:00.000Z"], [at("2026-12-07T10:00:00Z"), "2026-12-07T17:30:00.000Z"]] as const) {
      const view = hq({ now, settings: OFF, runs: { runs: WAVE_ONE(now), practice: null } });
      expect(view.today).toBeNull();
      // Always the next clue 1 to come (the calendar's time), never a clue 2 or 3.
      expect(view.nextClueAt?.toISOString()).toBe(next);
    }
  });

  it("gives the practice run as today for a practice browser, never a wave 1 door", () => {
    const practice = { ...run(7, SIX_10), door: 0 as const };
    const view = hq({ now: SIX_10, settings: OFF, runs: { runs: WAVE_ONE(SIX_10), practice } });
    expect(view.today?.door).toBe(0);
    expect(view.today?.practice).toBe(true);
  });
});

describe("a door's prize words and picture", () => {
  const found = { foundAt: at("2026-12-07T18:40:00Z"), foundFamilyId: 3 };

  it("gives found-hidden and snow doors no teaser, even with Show it off ticked", () => {
    expect(calDoor7({ now: SIX_45 }, { ...found, prizeShowOff: true }).teaser).toBeNull();
    expect(calDoor7({ now: SIX_10 }, { snowDayAt: at("2026-12-07T17:30:00Z"), prizeShowOff: true }).teaser).toBeNull();
    expect(calDoor7({ now: at("2026-12-07T20:30:00Z") }, { prizeShowOff: true }).teaser).toBe("A pretend prize");
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
    expect(today.revealAt.toISOString()).toBe("2026-12-07T20:00:00.000Z");
    expect(today.canGuess).toBe(true);
    expect(JSON.stringify(today)).not.toContain("it whistles");
    expect(JSON.stringify(today)).not.toContain("Toy Shop");
    expect(today.outcome).toBeNull();
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
    expect(v).toMatchObject({ code: "code7", door: 7, placeName: "The Toy Shop", placeTown: "Troon", open: false, claimable: true, foundHidden: false, revealAt: null, goneHome: false, yourPhoto: null });
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
});
