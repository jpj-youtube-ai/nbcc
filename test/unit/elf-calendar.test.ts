import { describe, it, expect } from "vitest";
import {
  DOOR_COUNT,
  CHRISTMAS_EVE_CLOSING_TIME,
  DEFAULT_MORNING_CLUE_TIME,
  DEFAULT_CLOSING_TIME,
  DEFAULT_SCHOOL_CLUE_TIME,
  LAST_REVEAL_TIME,
  closingInstant,
  clueTimeFor,
  dayKind,
  defaultClueTime,
  doorDate,
  doorInstant,
  doorOn,
  eveningFor,
  isClockTime,
  isDoor,
  type ElfSeason,
} from "../../src/elf/calendar";

// NBCC Elf Detective School: which day each door belongs to and when its clue comes out. Pure, so
// every case is checked here without a database or a clock. December 2026 starts on a Tuesday and
// December 2027 on a Wednesday.

const SEASON: ElfSeason = {
  year: 2026,
  holidayDoors: [21, 22, 23, 24],
  schoolClueTime: DEFAULT_SCHOOL_CLUE_TIME,
  morningClueTime: DEFAULT_MORNING_CLUE_TIME,
};

describe("the doors of the calendar", () => {
  it("has 24 doors, one for each day from 1 to 24 December", () => {
    expect(DOOR_COUNT).toBe(24);
    expect(doorDate(SEASON, 1)).toBe("2026-12-01");
    expect(doorDate(SEASON, 24)).toBe("2026-12-24");
  });

  it("knows a door number from anything else", () => {
    expect(isDoor(1)).toBe(true);
    expect(isDoor(24)).toBe(true);
    expect(isDoor(0)).toBe(false);
    expect(isDoor(25)).toBe(false);
    expect(isDoor(7.5)).toBe(false);
    expect(isDoor(Number.NaN)).toBe(false);
    expect(isDoor("7")).toBe(false);
    expect(isDoor(null)).toBe(false);
  });

  it("finds the door for a date, and nothing outside 1 to 24 December of its own year", () => {
    expect(doorOn(SEASON, "2026-12-01")).toBe(1);
    expect(doorOn(SEASON, "2026-12-07")).toBe(7);
    expect(doorOn(SEASON, "2026-12-24")).toBe(24);
    expect(doorOn(SEASON, "2026-12-25")).toBeNull();
    expect(doorOn(SEASON, "2026-11-30")).toBeNull();
    expect(doorOn(SEASON, "2025-12-07")).toBeNull();
    expect(doorOn(SEASON, "not a date")).toBeNull();
  });
});

describe("the kind of day a door falls on", () => {
  it("calls Monday to Friday a school day", () => {
    expect(dayKind(SEASON, 1)).toBe("school"); // Tuesday
    expect(dayKind(SEASON, 4)).toBe("school"); // Friday
    expect(dayKind(SEASON, 7)).toBe("school"); // Monday
  });

  it("calls Saturday and Sunday a weekend", () => {
    expect(dayKind(SEASON, 5)).toBe("weekend");
    expect(dayKind(SEASON, 6)).toBe("weekend");
    expect(dayKind(SEASON, 19)).toBe("weekend");
  });

  it("works the weekends out afresh for another year", () => {
    const next = { ...SEASON, year: 2027, holidayDoors: [] };
    expect(dayKind(next, 1)).toBe("school"); // Wednesday
    expect(dayKind(next, 4)).toBe("weekend"); // Saturday
    expect(dayKind(next, 5)).toBe("weekend"); // Sunday
    expect(dayKind(next, 6)).toBe("school"); // Monday
  });

  it("calls a weekday staff have marked a holiday", () => {
    expect(dayKind(SEASON, 21)).toBe("holiday");
    expect(dayKind(SEASON, 24)).toBe("holiday");
  });

  it("keeps a weekend a weekend even when it is marked as a holiday", () => {
    expect(dayKind({ ...SEASON, holidayDoors: [19, 20] }, 19)).toBe("weekend");
  });
});

// TASK-613 (Jaimie, 11 November 2026): places close early on Christmas Eve, so door 24 is a morning
// door by default, as if staff had marked it a holiday, unless a head elf sets its own times.
describe("Christmas Eve's door", () => {
  const UNMARKED: ElfSeason = { ...SEASON, holidayDoors: [] };

  it("is a holiday though nobody marked it one, every year it falls on a weekday", () => {
    expect(dayKind(UNMARKED, 24)).toBe("holiday"); // Thursday 24 December 2026
    expect(dayKind({ ...UNMARKED, year: 2027 }, 24)).toBe("holiday"); // Friday
  });

  it("stays a weekend in a year it falls on one", () => {
    expect(dayKind({ ...UNMARKED, year: 2022 }, 24)).toBe("weekend"); // Saturday
  });

  it("starts with its clue at the morning time, 10am, whatever kind of day it is", () => {
    expect(defaultClueTime(UNMARKED, 24)).toBe("10:00");
    expect(defaultClueTime({ ...UNMARKED, year: 2022 }, 24)).toBe("10:00");
    expect(defaultClueTime({ ...UNMARKED, morningClueTime: "09:30" }, 24)).toBe("09:30");
  });

  it("runs its morning at 10am, 10:30am and 11am, with the place shown at 11:30am", () => {
    expect(eveningFor(UNMARKED, 24, {})).toEqual({ clue1: "10:00", clue2: "10:30", clue3: "11:00", reveal: "11:30", problems: [] });
  });

  it("keeps the times a head elf sets for it", () => {
    expect(clueTimeFor(UNMARKED, 24, "17:30")).toBe("17:30");
    expect(eveningFor(UNMARKED, 24, { clue1: "16:00" })).toMatchObject({ clue1: "16:00", clue2: "16:30", clue3: "17:00", reveal: "17:30" });
  });

  it("leaves the weekdays before it school days", () => {
    expect(dayKind(UNMARKED, 23)).toBe("school"); // Wednesday 23 December 2026
    expect(defaultClueTime(UNMARKED, 23)).toBe("17:30");
  });
});

describe("a time on the clock", () => {
  it("is hours and minutes on a 24 hour clock, with seconds allowed", () => {
    expect(isClockTime("00:00")).toBe(true);
    expect(isClockTime("17:30")).toBe(true);
    expect(isClockTime("23:59")).toBe(true);
    expect(isClockTime("17:30:00")).toBe(true);
  });

  it("is nothing else", () => {
    expect(isClockTime("24:00")).toBe(false);
    expect(isClockTime("17:60")).toBe(false);
    expect(isClockTime("7:30")).toBe(false);
    expect(isClockTime("17:30 ")).toBe(false);
    expect(isClockTime("5pm")).toBe(false);
    expect(isClockTime("")).toBe(false);
    expect(isClockTime(1730)).toBe(false);
    expect(isClockTime(null)).toBe(false);
  });
});

describe("when a door's clue comes out", () => {
  it("starts school days after school and work, and other days in the morning", () => {
    expect(defaultClueTime(SEASON, 7)).toBe("17:30");
    expect(defaultClueTime(SEASON, 5)).toBe("10:00");
    expect(defaultClueTime(SEASON, 22)).toBe("10:00");
  });

  it("uses the times staff have set for the season", () => {
    const season = { ...SEASON, schoolClueTime: "18:00", morningClueTime: "09:30:00" };
    expect(defaultClueTime(season, 7)).toBe("18:00");
    expect(defaultClueTime(season, 6)).toBe("09:30");
  });

  it("falls back to the usual times when the season's own are not real times", () => {
    const season = { ...SEASON, schoolClueTime: "teatime", morningClueTime: "" };
    expect(defaultClueTime(season, 7)).toBe("17:30");
    expect(defaultClueTime(season, 6)).toBe("10:00");
  });

  it("uses the time staff set for one door, and the default when they set none", () => {
    expect(clueTimeFor(SEASON, 7, "19:15")).toBe("19:15");
    expect(clueTimeFor(SEASON, 7, "19:15:00")).toBe("19:15");
    expect(clueTimeFor(SEASON, 7, null)).toBe("17:30");
    expect(clueTimeFor(SEASON, 7, undefined)).toBe("17:30");
    expect(clueTimeFor(SEASON, 5, "late")).toBe("10:00");
  });
});

describe("the moment a London time happens on a door's day", () => {
  it("is that clock time in London on that date", () => {
    expect(doorInstant(SEASON, 7, "17:30")?.toISOString()).toBe("2026-12-07T17:30:00.000Z");
    expect(doorInstant(SEASON, 5, "10:00")?.toISOString()).toBe("2026-12-05T10:00:00.000Z");
    expect(doorInstant(SEASON, 7, "21:00:00")?.toISOString()).toBe("2026-12-07T21:00:00.000Z");
  });

  it("is nothing for a time that is not a time, or a door that is not a door", () => {
    expect(doorInstant(SEASON, 7, "25:00")).toBeNull();
    expect(doorInstant(SEASON, 7, "5pm")).toBeNull();
    expect(doorInstant(SEASON, 7, "")).toBeNull();
    expect(doorInstant(SEASON, 25, "10:00")).toBeNull();
    expect(doorInstant(SEASON, 0, "10:00")).toBeNull();
  });
});

describe("the moment a door's place closes", () => {
  it("is the closing time on the door's day when that is after the clue", () => {
    expect(closingInstant(SEASON, 7, "17:30", "21:00")?.toISOString()).toBe("2026-12-07T21:00:00.000Z");
    expect(closingInstant(SEASON, 5, "10:00", "17:00:00")?.toISOString()).toBe("2026-12-05T17:00:00.000Z");
  });

  it("is the next day for a place that is open past midnight", () => {
    expect(closingInstant(SEASON, 7, "17:30", "01:00")?.toISOString()).toBe("2026-12-08T01:00:00.000Z");
    expect(closingInstant(SEASON, 23, "10:00", "00:30")?.toISOString()).toBe("2026-12-24T00:30:00.000Z");
  });

  it("is the next day for a place that shut before the clue came out, so the hunt carries on when it opens again", () => {
    expect(closingInstant(SEASON, 7, "17:30", "17:00")?.toISOString()).toBe("2026-12-08T17:00:00.000Z");
    expect(closingInstant(SEASON, 7, "17:30", "17:30")?.toISOString()).toBe("2026-12-08T17:30:00.000Z");
  });

  it("is 8pm when no closing time is set, or it is not a real time", () => {
    expect(DEFAULT_CLOSING_TIME).toBe("20:00");
    expect(closingInstant(SEASON, 7, "17:30", null)?.toISOString()).toBe("2026-12-07T20:00:00.000Z");
    expect(closingInstant(SEASON, 7, "17:30", undefined)?.toISOString()).toBe("2026-12-07T20:00:00.000Z");
    expect(closingInstant(SEASON, 7, "17:30", "late")?.toISOString()).toBe("2026-12-07T20:00:00.000Z");
    expect(closingInstant(SEASON, 7, "20:30", null)?.toISOString()).toBe("2026-12-08T20:00:00.000Z");
  });

  it("is never later than 8pm on Christmas Eve, so that every door is open in time for everyone to finish", () => {
    expect(LAST_REVEAL_TIME).toBe("20:00");
    expect(closingInstant(SEASON, 24, "10:00", "23:00")?.toISOString()).toBe("2026-12-24T20:00:00.000Z");
    expect(closingInstant(SEASON, 24, "10:00", "00:30")?.toISOString()).toBe("2026-12-24T20:00:00.000Z");
    expect(closingInstant(SEASON, 24, "10:00", null)?.toISOString()).toBe("2026-12-24T16:00:00.000Z");
    expect(closingInstant(SEASON, 24, "10:00", "16:00")?.toISOString()).toBe("2026-12-24T16:00:00.000Z");
    expect(closingInstant(SEASON, 23, "22:00", "21:00")?.toISOString()).toBe("2026-12-24T20:00:00.000Z");
  });

  // Plan 2c-2, ruling F2 (Jaimie, 12 November 2026: "I said 4pm for xmas eve"): places close early on
  // Christmas Eve, so door 24's place closes at 4pm unless a head elf types its own time. A typed time
  // still wins, earlier or later; only the 8pm cap above holds it back.
  it("is 4pm on Christmas Eve when door 24 has no closing time, or one that is not a real time", () => {
    expect(CHRISTMAS_EVE_CLOSING_TIME).toBe("16:00");
    expect(closingInstant(SEASON, 24, "10:00", undefined)?.toISOString()).toBe("2026-12-24T16:00:00.000Z");
    expect(closingInstant(SEASON, 24, "10:00", "late")?.toISOString()).toBe("2026-12-24T16:00:00.000Z");
    expect(closingInstant({ year: 2027 }, 24, "10:00", null)?.toISOString()).toBe("2027-12-24T16:00:00.000Z");
  });

  it("keeps a closing time typed on door 24, earlier or later than 4pm, under the 8pm cap", () => {
    expect(closingInstant(SEASON, 24, "10:00", "15:00")?.toISOString()).toBe("2026-12-24T15:00:00.000Z");
    expect(closingInstant(SEASON, 24, "10:00", "18:00")?.toISOString()).toBe("2026-12-24T18:00:00.000Z");
    expect(closingInstant(SEASON, 24, "10:00", "23:00")?.toISOString()).toBe("2026-12-24T20:00:00.000Z");
  });

  it("leaves every other door's place closing at 8pm when none is typed, the day before Christmas Eve too", () => {
    expect(closingInstant(SEASON, 23, "10:00", null)?.toISOString()).toBe("2026-12-23T20:00:00.000Z");
    expect(closingInstant(SEASON, 1, "17:30", null)?.toISOString()).toBe("2026-12-01T20:00:00.000Z");
  });

  it("closes door 24 at 8pm, the cap, when a head elf moves its clue to 4pm or later and types no closing time", () => {
    expect(closingInstant(SEASON, 24, "16:00", null)?.toISOString()).toBe("2026-12-24T20:00:00.000Z");
    expect(closingInstant(SEASON, 24, "15:59", null)?.toISOString()).toBe("2026-12-24T16:00:00.000Z");
  });

  it("is nothing for a clue at or after 8pm on Christmas Eve, which cannot work and must be refused", () => {
    expect(closingInstant(SEASON, 24, "20:00", null)).toBeNull();
    expect(closingInstant(SEASON, 24, "21:30", "23:00")).toBeNull();
    expect(closingInstant(SEASON, 24, "19:59", "23:00")?.toISOString()).toBe("2026-12-24T20:00:00.000Z");
  });

  it("is nothing when the door or its clue time is not real", () => {
    expect(closingInstant(SEASON, 25, "17:30", "21:00")).toBeNull();
    expect(closingInstant(SEASON, 7, "teatime", "21:00")).toBeNull();
  });
});

import { eveningFor, closesTooSoon, EVENING_PROBLEM_WORDS } from "../../src/elf/calendar";

describe("a door's evening", () => {
  const evSeason = { year: 2026, holidayDoors: [], schoolClueTime: "17:30", morningClueTime: "10:00" };

  it("fills the evening from the clue time", () => {
    expect(eveningFor(evSeason, 7, {})).toEqual({ clue1: "17:30", clue2: "18:00", clue3: "18:30", reveal: "19:00", problems: [] });
    expect(eveningFor(evSeason, 5, {})).toMatchObject({ clue1: "10:00", clue2: "10:30", clue3: "11:00", reveal: "11:30" });
    expect(eveningFor(evSeason, 7, { clue1: "17:00" })).toMatchObject({ clue2: "17:30", clue3: "18:00", reveal: "18:30" });
    expect(eveningFor(evSeason, 7, { clue2: "17:45" })).toMatchObject({ clue3: "18:15", reveal: "18:45", problems: [] });
  });

  it("reports times out of order", () => {
    expect(eveningFor(evSeason, 7, { clue2: "17:00" }).problems).toEqual(["clue2-not-after-clue1"]);
    expect(eveningFor(evSeason, 7, { reveal: "18:30" }).problems).toEqual(["reveal-not-after-clue3"]);
    expect(eveningFor(evSeason, 7, { clue3: "17:45" }).problems).toContain("clue3-not-after-clue2");
  });

  it("stops defaults at 23:59 and says so once", () => {
    const e = eveningFor(evSeason, 7, { clue1: "23:40" });
    expect(e.problems.filter((p) => p === "past-midnight")).toHaveLength(1);
    expect(e.reveal).toBe("23:59");
  });

  it("has a sentence for every problem", () => {
    expect(EVENING_PROBLEM_WORDS["past-midnight"]).toBe("Every time must be on the door's own day, before midnight.");
  });

  it("knows when a place closes too soon after clue 3", () => {
    expect(closesTooSoon(7, "19:30", "18:30")).toBe(false);
    expect(closesTooSoon(7, "19:29", "18:30")).toBe(true);
    expect(closesTooSoon(7, null, "18:30")).toBe(false);
    expect(closesTooSoon(7, "17:00", "18:30")).toBe(true);
  });

  // Ruling F2: door 24's place closes at 4pm when no time is typed, so that is the time to check against.
  it("checks door 24 against 4pm when it has no closing time typed, and against a typed time when it has one", () => {
    expect(closesTooSoon(24, null, "11:00")).toBe(false);
    expect(closesTooSoon(24, null, "15:00")).toBe(false);
    expect(closesTooSoon(24, null, "15:01")).toBe(true);
    expect(closesTooSoon(23, null, "15:01")).toBe(false);
    expect(closesTooSoon(24, "17:00", "15:30")).toBe(false);
    expect(closesTooSoon(24, "15:00", "11:00")).toBe(false);
  });
});
