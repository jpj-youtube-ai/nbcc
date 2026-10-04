import { describe, it, expect } from "vitest";
import {
  DOOR_COUNT,
  DEFAULT_MORNING_CLUE,
  DEFAULT_SCHOOL_CLUE,
  clueInstant,
  dayKind,
  defaultClueTime,
  doorDate,
  doorOn,
  isDoor,
  type ElfSeason,
} from "../../src/elf/calendar";

// NBCC Elf Detective School: which day each door belongs to and when its clue comes out. Pure, so
// every case is checked here without a database or a clock. December 2026 starts on a Tuesday.

const SEASON: ElfSeason = {
  year: 2026,
  holidayDoors: [21, 22, 23, 24],
  schoolClue: DEFAULT_SCHOOL_CLUE,
  morningClue: DEFAULT_MORNING_CLUE,
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
    expect(isDoor("7")).toBe(false);
  });

  it("finds the door for a date, and nothing outside 1 to 24 December of its own year", () => {
    expect(doorOn(SEASON, "2026-12-07")).toBe(7);
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

  it("calls a weekday staff have marked a holiday", () => {
    expect(dayKind(SEASON, 21)).toBe("holiday");
    expect(dayKind(SEASON, 24)).toBe("holiday");
  });

  it("keeps a weekend a weekend even when it is marked as a holiday", () => {
    expect(dayKind({ ...SEASON, holidayDoors: [19, 20] }, 19)).toBe("weekend");
  });
});

describe("when a door's clue comes out", () => {
  it("starts school days after school and work, and other days in the morning", () => {
    expect(defaultClueTime(SEASON, 7)).toBe("17:30");
    expect(defaultClueTime(SEASON, 5)).toBe("10:00");
    expect(defaultClueTime(SEASON, 22)).toBe("10:00");
  });

  it("uses the times staff have set for the season", () => {
    const season = { ...SEASON, schoolClue: "18:00", morningClue: "09:30" };
    expect(defaultClueTime(season, 7)).toBe("18:00");
    expect(defaultClueTime(season, 6)).toBe("09:30");
  });

  it("turns a London clock time on the door's day into the moment it happens", () => {
    expect(clueInstant(SEASON, 7, "17:30")?.toISOString()).toBe("2026-12-07T17:30:00.000Z");
    expect(clueInstant(SEASON, 5, "10:00")?.toISOString()).toBe("2026-12-05T10:00:00.000Z");
  });

  it("refuses a time that is not a time, and a door that is not a door", () => {
    expect(clueInstant(SEASON, 7, "25:00")).toBeNull();
    expect(clueInstant(SEASON, 7, "5pm")).toBeNull();
    expect(clueInstant(SEASON, 7, "")).toBeNull();
    expect(clueInstant(SEASON, 25, "10:00")).toBeNull();
  });
});
