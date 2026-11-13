import { describe, it, expect } from "vitest";
import { clockWords, countdownWords, dayWords, findOutWhenFoundWords, findOutWords, listWords, longDayWords, sameDay, sleepsUntil, things } from "../../src/elf/words";

// NBCC Elf Detective School: times, dates and lists as people read them. December is winter time in
// London, so a time on the clock there is the same as in UTC; one summer case checks the clocks.

const at = (iso: string) => new Date(iso);

describe("a time on the clock", () => {
  it("is written the way people say it", () => {
    expect(clockWords(at("2026-12-07T17:30:00.000Z"))).toBe("5:30pm");
    expect(clockWords(at("2026-12-05T10:00:00.000Z"))).toBe("10am");
    expect(clockWords(at("2026-12-05T09:05:00.000Z"))).toBe("9:05am");
    expect(clockWords(at("2026-12-07T20:00:00.000Z"))).toBe("8pm");
  });

  it("calls twelve o'clock noon or midnight, so nobody has to work out which 12 it is", () => {
    expect(clockWords(at("2026-12-07T12:00:00.000Z"))).toBe("12 noon");
    expect(clockWords(at("2026-12-07T00:00:00.000Z"))).toBe("midnight");
    expect(clockWords(at("2026-12-07T12:15:00.000Z"))).toBe("12:15pm");
    expect(clockWords(at("2026-12-07T00:30:00.000Z"))).toBe("12:30am");
  });

  it("is the time in London, whatever the clocks are doing", () => {
    expect(clockWords(at("2026-07-01T16:30:00.000Z"))).toBe("5:30pm");
  });

  it("is nothing for a date that is not a date", () => {
    expect(clockWords(new Date(Number.NaN))).toBe("");
  });
});

describe("a day", () => {
  it("is short on a door and in full in a sentence", () => {
    expect(dayWords(at("2026-12-07T17:30:00.000Z"))).toBe("Mon 7 Dec");
    expect(dayWords(at("2026-12-24T10:00:00.000Z"))).toBe("Thu 24 Dec");
    expect(longDayWords(at("2026-12-07T17:30:00.000Z"))).toBe("Monday 7 December");
  });

  it("is the day in London, so late on a summer evening it is already tomorrow there", () => {
    expect(dayWords(at("2026-07-01T23:30:00.000Z"))).toBe("Thu 2 Jul");
  });

  it("is nothing for a date that is not a date", () => {
    expect(dayWords(new Date(Number.NaN))).toBe("");
    expect(longDayWords(new Date(Number.NaN))).toBe("");
  });
});

describe("a countdown", () => {
  it("shows hours, minutes and seconds", () => {
    expect(countdownWords((2 * 3600 + 14 * 60 + 9) * 1000)).toBe("2:14:09");
    expect(countdownWords(3600 * 1000)).toBe("1:00:00");
  });

  it("drops the hours when there are none", () => {
    expect(countdownWords((14 * 60 + 9) * 1000)).toBe("14:09");
    expect(countdownWords(5 * 1000)).toBe("0:05");
  });

  it("stops at nought", () => {
    expect(countdownWords(0)).toBe("0:00");
    expect(countdownWords(-5000)).toBe("0:00");
    expect(countdownWords(Number.NaN)).toBe("0:00");
  });

  it("rounds a part second up, so it reaches nought exactly when the time comes", () => {
    expect(countdownWords(4001)).toBe("0:05");
    expect(countdownWords(1)).toBe("0:01");
  });
});

describe("sleeps to go", () => {
  it("counts the nights between two days in London", () => {
    expect(sleepsUntil(at("2026-11-08T09:00:00.000Z"), at("2026-12-01T17:30:00.000Z"))).toBe(23);
    expect(sleepsUntil(at("2026-11-30T23:59:00.000Z"), at("2026-12-01T17:30:00.000Z"))).toBe(1);
  });

  it("is none on the day itself, and none once it has passed", () => {
    expect(sleepsUntil(at("2026-12-01T00:05:00.000Z"), at("2026-12-01T17:30:00.000Z"))).toBe(0);
    expect(sleepsUntil(at("2026-12-03T10:00:00.000Z"), at("2026-12-01T17:30:00.000Z"))).toBe(0);
    expect(sleepsUntil(new Date(Number.NaN), at("2026-12-01T17:30:00.000Z"))).toBe(0);
  });
});

describe("the same day", () => {
  it("is the same date in London, whatever the time", () => {
    expect(sameDay(at("2026-12-07T00:05:00.000Z"), at("2026-12-07T23:55:00.000Z"))).toBe(true);
    expect(sameDay(at("2026-12-07T23:55:00.000Z"), at("2026-12-08T00:05:00.000Z"))).toBe(false);
  });

  it("goes by London's clocks in summer too", () => {
    expect(sameDay(at("2026-07-01T23:30:00.000Z"), at("2026-07-02T10:00:00.000Z"))).toBe(true);
  });

  it("is never true of a date that is not a date", () => {
    expect(sameDay(new Date(Number.NaN), new Date(Number.NaN))).toBe(false);
  });
});

describe("a list", () => {
  it("reads as a sentence would have it", () => {
    expect(listWords([])).toBe("");
    expect(listWords(["Ruby"])).toBe("Ruby");
    expect(listWords(["Ruby", "Sam"])).toBe("Ruby and Sam");
    expect(listWords(["Ruby", "Sam", "Mia"])).toBe("Ruby, Sam and Mia");
  });
});

describe("a count of things", () => {
  it("says one thing or several", () => {
    expect(things(1, "door")).toBe("1 door");
    expect(things(3, "door")).toBe("3 doors");
    expect(things(0, "door")).toBe("0 doors");
    expect(things(2, "elf", "elves")).toBe("2 elves");
    expect(things(1, "elf", "elves")).toBe("1 elf");
  });
});

// Plan 2c-1, Task 9: a place is shown only to a family that has had its guess, so the clue email, the calendar
// and Detective HQ say when a family finds out whether it cracked the case, all in these words.
describe("when a family finds out", () => {
  it("says the time, and that it may be later while the elf could still be hiding then", () => {
    expect(findOutWords("7pm", false)).toBe("You find out whether you cracked it at 7pm.");
    expect(findOutWords("7pm", true)).toBe("You find out whether you cracked it at 7pm, or later if the elf is still hiding then.");
  });

  // Fix round 1: once the reveal time has passed with the elf still hiding, its place is shown when it is found,
  // or at the place's closing time at the latest (shownAt), so both are said.
  it("says, once the reveal has passed, as soon as the elf is found or at the closing time at the latest", () => {
    expect(findOutWhenFoundWords("8pm")).toBe("You find out whether you cracked it as soon as the elf is found, or at 8pm at the latest.");
    // With no time to say (not a real one), the find alone.
    expect(findOutWhenFoundWords("")).toBe("You find out whether you cracked it as soon as the elf is found.");
  });
});
