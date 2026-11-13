import { describe, it, expect, vi } from "vitest";

// runOf sits beside the game's SQL, so the pool is mocked: nothing here touches a database.
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { runOf, type DoorRun } from "../../src/db/elf-game";
import type { Door } from "../../src/elf/calendar";
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";
import { isDone } from "../../src/elf/doors";
import type { ElfSettings } from "../../src/elf/settings";
import {
  GRAND_PRIZE_DEFAULT_TIME,
  WINNER_TAKEN_WORDS,
  catchUpOf,
  christmasEveOf,
  closingRefusal,
  door24Warning,
  earliestClosing,
  entriesOpenAt,
  entryOpen,
  grandPrizeClosesAt,
  latestOpening,
  prizeSectionShows,
} from "../../src/elf/grand-prize";

// NBCC Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2): the rules, pure, checked here
// without a clock. December London time is GMT, so a London time reads the same as its Z time. Thursday
// 24 December 2026: door 24's clue 1 is at 10am, clue 2 at 10:30am, clue 3 at 11am, and its place is shown
// at 11:30am; with no closing time typed its place closes at 4pm (ruling F2). Every place, elf and family
// here is invented: the repository is public.

const at = (iso: string) => new Date(iso);
const FOUR_PM = at("2026-12-24T16:00:00Z");
const FOUR_59 = at("2026-12-24T16:59:00Z");
const FIVE_PM = at("2026-12-24T17:00:00Z");

function setup(door: number, over: Partial<DoorSetup> = {}): DoorSetup {
  return {
    ...emptyDoor(door as Door, `code${door}`),
    placeName: "Corner Bakehouse",
    placeTown: "Snowford",
    tagWord: "SNOWBALL 472",
    elfName: "Twinkle",
    ...over,
  };
}
const run = (door: number, now: Date, over: Partial<DoorSetup> = {}): DoorRun => runOf(2026, setup(door, over), now);
/** Door 24 as it is on the morning of Christmas Eve, with whatever a head elf typed for it. */
const door24 = (over: Partial<DoorSetup> = {}): DoorRun => run(24, at("2026-12-24T09:00:00Z"), over);
const doorsUpTo = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe("when the grand prize entries close", () => {
  it("is 5pm in London on Christmas Eve of Elf Detective School's year when nothing is stored", () => {
    expect(GRAND_PRIZE_DEFAULT_TIME).toBe("17:00");
    const closes = grandPrizeClosesAt({ year: 2026, grandPrizeClosesAt: null });
    expect(closes).toBeInstanceOf(Date);
    expect(closes.toISOString()).toBe("2026-12-24T17:00:00.000Z");
    expect(grandPrizeClosesAt({ year: 2027, grandPrizeClosesAt: null }).toISOString()).toBe("2027-12-24T17:00:00.000Z");
  });

  it("is the moment a head elf stored, as stored", () => {
    const stored = at("2026-12-24T17:30:00Z");
    expect(grandPrizeClosesAt({ year: 2026, grandPrizeClosesAt: stored })).toEqual(stored);
  });

  // Ruling F7: the stored moment outlives the year it was set for, and older settings have no such key.
  it("reads a moment stored for an earlier year as 5pm on Christmas Eve of this year", () => {
    expect(grandPrizeClosesAt({ year: 2027, grandPrizeClosesAt: at("2026-12-24T17:30:00Z") }).toISOString()).toBe("2027-12-24T17:00:00.000Z");
  });

  it("reads a moment before midnight starting Christmas Eve as 5pm, and keeps one from that midnight", () => {
    expect(grandPrizeClosesAt({ year: 2026, grandPrizeClosesAt: at("2026-12-23T23:59:59Z") }).toISOString()).toBe("2026-12-24T17:00:00.000Z");
    expect(grandPrizeClosesAt({ year: 2026, grandPrizeClosesAt: at("2026-12-24T00:00:00Z") }).toISOString()).toBe("2026-12-24T00:00:00.000Z");
  });

  it("reads a missing or broken stored moment as 5pm", () => {
    const missing = { year: 2026 } as unknown as Pick<ElfSettings, "year" | "grandPrizeClosesAt">;
    expect(grandPrizeClosesAt(missing).toISOString()).toBe("2026-12-24T17:00:00.000Z");
    expect(grandPrizeClosesAt({ year: 2026, grandPrizeClosesAt: new Date(Number.NaN) }).toISOString()).toBe("2026-12-24T17:00:00.000Z");
  });

  // The BDD plays the grand prize in last year's December, with the closing set from the database's clock.
  it("keeps a stored moment after this year's Christmas Eve", () => {
    const fromTheClock = at("2026-11-13T12:00:00Z");
    expect(grandPrizeClosesAt({ year: 2025, grandPrizeClosesAt: fromTheClock })).toEqual(fromTheClock);
  });
});

describe("when the entries are open", () => {
  const open = { graduate: true, year: 2026, closesAt: FIVE_PM };

  it("open at midnight in London as 24 December begins", () => {
    expect(entriesOpenAt(2026)).toBeInstanceOf(Date);
    expect(entriesOpenAt(2026).toISOString()).toBe("2026-12-24T00:00:00.000Z");
    expect(entryOpen({ ...open, now: at("2026-12-24T00:00:00Z") })).toBe(true);
  });

  it("are open at 4:59:59pm on Christmas Eve, and closed at 5pm", () => {
    expect(entryOpen({ ...open, now: at("2026-12-24T16:59:59Z") })).toBe(true);
    expect(entryOpen({ ...open, now: FIVE_PM })).toBe(false);
  });

  it("are never open to a detective who has not done all 24 doors", () => {
    expect(entryOpen({ ...open, graduate: false, now: at("2026-12-24T12:00:00Z") })).toBe(false);
  });

  it("are not open yet at 11:59pm on 23 December", () => {
    expect(entryOpen({ ...open, now: at("2026-12-23T23:59:00Z") })).toBe(false);
  });
});

// Ruling F9: one rule for whether Detective HQ shows the grand prize section.
describe("the grand prize section in Detective HQ", () => {
  const shows = (now: Date, over: { doorsOn?: boolean; closesAt?: Date } = {}) =>
    prizeSectionShows({ doorsOn: true, year: 2026, closesAt: FIVE_PM, now, ...over });

  it("shows from midnight starting Christmas Eve, after the entries close too, until 1 January", () => {
    expect(shows(at("2026-12-23T23:59:59Z"))).toBe(false);
    expect(shows(at("2026-12-24T00:00:00Z"))).toBe(true);
    expect(shows(FIVE_PM)).toBe(true);
    expect(shows(at("2026-12-31T23:59:59Z"))).toBe(true);
    expect(shows(at("2027-01-01T00:00:00Z"))).toBe(false);
  });

  it("never shows while December's doors are off", () => {
    expect(shows(at("2026-12-24T12:00:00Z"), { doorsOn: false })).toBe(false);
  });

  it("stays until the entries close when that is after 1 January", () => {
    const closesAt = at("2027-01-02T12:00:00Z");
    expect(shows(at("2027-01-01T12:00:00Z"), { closesAt })).toBe(true);
    expect(shows(closesAt, { closesAt })).toBe(false);
  });
});

describe("door 24 and when the entries can close", () => {
  it("opens at the latest when its place closes, and the entries can close an hour after that", () => {
    const typed = door24({ closesAt: "16:00" });
    expect(typed.facts.revealAt.toISOString()).toBe("2026-12-24T11:30:00.000Z");
    expect(latestOpening(typed).toISOString()).toBe("2026-12-24T16:00:00.000Z");
    expect(earliestClosing(typed).toISOString()).toBe("2026-12-24T17:00:00.000Z");
  });

  it("counts from its place closing at 4pm when no closing time is typed", () => {
    expect(latestOpening(door24()).toISOString()).toBe("2026-12-24T16:00:00.000Z");
    expect(earliestClosing(door24()).toISOString()).toBe("2026-12-24T17:00:00.000Z");
  });

  it("opens no later for an elf found in the morning: the latest is when nobody finds it", () => {
    expect(latestOpening(door24({ foundAt: at("2026-12-24T10:20:00Z") })).toISOString()).toBe("2026-12-24T16:00:00.000Z");
  });

  it("counts a place shown after it closes from when it is shown", () => {
    const late = door24({ revealTime: "17:00" });
    expect(latestOpening(late).toISOString()).toBe("2026-12-24T17:00:00.000Z");
    expect(closingRefusal({ closesAt: at("2026-12-24T17:59:00Z"), door24: late })).toBe(
      "Door 24's hiding place closes at 5pm, so grand prize entries can close at 6pm at the earliest.",
    );
  });
});

describe("refusing a closing time in Settings", () => {
  it("refuses 4:59pm while door 24's place closes at 4pm, and takes 5pm", () => {
    const typed = door24({ closesAt: "16:00" });
    expect(closingRefusal({ closesAt: FOUR_59, door24: typed })).toBe(
      "Door 24's hiding place closes at 4pm, so grand prize entries can close at 5pm at the earliest.",
    );
    expect(closingRefusal({ closesAt: FIVE_PM, door24: typed })).toBeNull();
  });

  // Ruling F3: with no closing time typed door 24 closes at 4pm, so the default 5pm saves.
  it("refuses 4:59pm and takes 5pm when door 24 has no closing time typed", () => {
    expect(closingRefusal({ closesAt: FOUR_59, door24: door24() })).toBe(
      "Door 24's hiding place closes at 4pm, so grand prize entries can close at 5pm at the earliest.",
    );
    expect(closingRefusal({ closesAt: FIVE_PM, door24: door24() })).toBeNull();
  });

  it("says the minutes of a time that is not on the hour", () => {
    expect(closingRefusal({ closesAt: FIVE_PM, door24: door24({ closesAt: "16:30" }) })).toBe(
      "Door 24's hiding place closes at 4:30pm, so grand prize entries can close at 5:30pm at the earliest.",
    );
  });
});

describe("warning about door 24 in Settings and Doors", () => {
  it("warns when door 24's place closes later than an hour before the entries close", () => {
    expect(door24Warning({ closesAt: FIVE_PM, door24: door24({ closesAt: "16:30" }) })).toBe(
      "Grand prize entries close at 5pm, so door 24's place must close by 4pm.",
    );
  });

  it("says nothing when door 24's place closes an hour before, typed or by default", () => {
    expect(door24Warning({ closesAt: FIVE_PM, door24: door24({ closesAt: "16:00" }) })).toBeNull();
    expect(door24Warning({ closesAt: FIVE_PM, door24: door24() })).toBeNull();
  });

  it("gives neither the refusal nor the warning for entries at 4pm with door 24 closing at 3pm", () => {
    const early = door24({ closesAt: "15:00" });
    expect(closingRefusal({ closesAt: FOUR_PM, door24: early })).toBeNull();
    expect(door24Warning({ closesAt: FOUR_PM, door24: early })).toBeNull();
  });
});

describe("the week before Christmas Eve", () => {
  // Friday 18 December 2026 at 5:31pm: door 18's clue 1 came out at 5:30pm. Door 4 was snowed in.
  const NOW = at("2026-12-18T17:31:00Z");
  const runs = doorsUpTo(24).map((door) => run(door, NOW, door === 4 ? { snowDayAt: at("2026-12-04T17:30:00Z") } : {}));
  const catchUp = (o: { door?: number; done?: readonly number[]; fromHome?: number; now?: Date; runs?: readonly DoorRun[] } = {}) =>
    catchUpOf({ door: 18, runs, done: doorsUpTo(17), fromHome: 3, now: NOW, ...o });

  it("starts from doors 1 to 17 done for everyone, door 18 hunting and door 4 snowed in", () => {
    expect(runs.filter((r) => isDone(r.state)).map((r) => r.door)).toEqual(doorsUpTo(17));
    expect(runs[3].state).toBe("snow");
    expect(runs[17].state).toBe("hunting");
  });

  it("is ready when the family has done every door done for everyone", () => {
    expect(catchUp()).toEqual({ ready: true });
  });

  it("is behind, with the doors it can crack from home, when it has not done one of them", () => {
    expect(catchUp({ done: doorsUpTo(17).filter((d) => d !== 5) })).toEqual({ ready: false, fromHome: 3 });
    expect(catchUp({ done: doorsUpTo(17).filter((d) => d !== 5), fromHome: 0 })).toEqual({ ready: false, fromHome: 0 });
  });

  it("counts a snowed in door like any other", () => {
    expect(catchUp({ done: doorsUpTo(17).filter((d) => d !== 4) })).toEqual({ ready: false, fromHome: 3 });
  });

  it("never needs the email's own door, or a door still to come", () => {
    expect(catchUp({ done: doorsUpTo(17) })).toEqual({ ready: true });
    expect(catchUp({ done: [...doorsUpTo(17), 18, 19] })).toEqual({ ready: true });
  });

  it("works each door out at now, not when the doors were read", () => {
    const readEarly = doorsUpTo(24).map((door) => run(door, at("2026-12-01T09:00:00Z")));
    expect(catchUp({ runs: readEarly, done: [] })).toEqual({ ready: false, fromHome: 3 });
    expect(catchUp({ runs: readEarly, done: doorsUpTo(17) })).toEqual({ ready: true });
  });

  it("is only for the emails of doors 17 to 23", () => {
    expect(catchUp({ door: 16 })).toBeNull();
    expect(catchUp({ door: 24 })).toBeNull();
    expect(catchUp({ door: 0 })).toBeNull();
    expect(catchUp({ door: 17, now: at("2026-12-17T17:31:00Z"), done: doorsUpTo(16) })).toEqual({ ready: true });
    expect(catchUp({ door: 23, now: at("2026-12-23T17:31:00Z"), done: doorsUpTo(22) })).toEqual({ ready: true });
  });
});

describe("the day before Christmas Eve", () => {
  const EVENING = at("2026-12-23T17:31:00Z");
  const runs = doorsUpTo(24).map((door) => run(door, EVENING));

  it("gives door 23's email door 24's first clue: 10am on Christmas Eve", () => {
    expect(christmasEveOf({ door: 23, runs })?.clue1At.toISOString()).toBe("2026-12-24T10:00:00.000Z");
  });

  it("gives the time a head elf set for door 24's first clue", () => {
    const set = runs.map((r) => (r.door === 24 ? run(24, EVENING, { clue1Time: "09:30" }) : r));
    expect(christmasEveOf({ door: 23, runs: set })?.clue1At.toISOString()).toBe("2026-12-24T09:30:00.000Z");
  });

  it("is nothing for any other door's email", () => {
    expect(christmasEveOf({ door: 22, runs })).toBeNull();
    expect(christmasEveOf({ door: 24, runs })).toBeNull();
  });

  // Ruling F17: a head elf can call door 24 off before its first clue, and then no clue comes out at all.
  it("is nothing when door 24 is snowed in, or not there", () => {
    const snowed = runs.map((r) => (r.door === 24 ? run(24, EVENING, { snowDayAt: at("2026-12-23T12:00:00Z") }) : r));
    expect(christmasEveOf({ door: 23, runs: snowed })).toBeNull();
    expect(christmasEveOf({ door: 23, runs: runs.filter((r) => r.door !== 24) })).toBeNull();
  });
});

// Ruling F5: two head elves marking at the same moment take turns, so a clash at the one winner index is
// only a belt and braces; Head Elf HQ answers it with these words.
describe("the words when two head elves mark a winner at once", () => {
  it("asks the head elf to reload", () => {
    expect(WINNER_TAKEN_WORDS).toBe("Someone has just marked a winner. Reload to see it.");
  });
});
