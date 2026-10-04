import { describe, it, expect } from "vitest";
import {
  DOOR_COUNT,
  DEFAULT_MORNING_CLUE_TIME,
  DEFAULT_SCHOOL_CLUE_TIME,
  closingInstant,
  clueTimeFor,
  dayKind,
  defaultClueTime,
  doorDate,
  doorInstant,
  doorOn,
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
    expect(closingInstant(SEASON, 24, "10:00", "00:30")?.toISOString()).toBe("2026-12-25T00:30:00.000Z");
  });

  it("is the next day for a place that shut before the clue came out, so the hunt carries on when it opens again", () => {
    expect(closingInstant(SEASON, 7, "17:30", "17:00")?.toISOString()).toBe("2026-12-08T17:00:00.000Z");
    expect(closingInstant(SEASON, 7, "17:30", "17:30")?.toISOString()).toBe("2026-12-08T17:30:00.000Z");
  });

  it("is midnight at the end of the door's day when no closing time is set, or it is not a real time", () => {
    expect(closingInstant(SEASON, 7, "17:30", null)?.toISOString()).toBe("2026-12-08T00:00:00.000Z");
    expect(closingInstant(SEASON, 7, "17:30", undefined)?.toISOString()).toBe("2026-12-08T00:00:00.000Z");
    expect(closingInstant(SEASON, 7, "17:30", "late")?.toISOString()).toBe("2026-12-08T00:00:00.000Z");
  });

  it("is nothing when the door or its clue time is not real", () => {
    expect(closingInstant(SEASON, 25, "17:30", "21:00")).toBeNull();
    expect(closingInstant(SEASON, 7, "teatime", "21:00")).toBeNull();
  });
});
