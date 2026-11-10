import { describe, expect, it } from "vitest";
import {
  SLEIGH_MIN_PENCE,
  SLEIGH_OLD_PATH,
  SLEIGH_PATH,
  SLEIGH_SOURCE,
  SLEIGH_THANKS_PATH,
  dayLabel,
  roadStop,
  sleighPhase,
  timesLabel,
  type SleighNight,
} from "../../src/sleigh/model";

// The seven Kilmarnock nights of 2026, as the poster has them (timings to be confirmed).
const NIGHTS: SleighNight[] = [
  ["2026-12-15", "New Farm"],
  ["2026-12-16", "Wardneuk, Onthank & Altonhill"],
  ["2026-12-17", "Bellfield & Shortlees"],
  ["2026-12-18", "Fardalehill, Margaret Parker, Whisky"],
  ["2026-12-20", "Southcraig & surrounding"],
  ["2026-12-21", "Gargieston & Moorfield"],
  ["2026-12-22", "Caprington & Grange"],
].map(([nightOn, areas], i) => ({ id: i + 1, nightOn, areas, startsAt: null, endsAt: null }));

describe("the Santa Sleigh's fixed values", () => {
  it("lives at /sleigh, with the long address forwarding to it", () => {
    expect(SLEIGH_PATH).toBe("/sleigh");
    expect(SLEIGH_OLD_PATH).toBe("/santa-sleigh");
    expect(SLEIGH_THANKS_PATH).toBe("/sleigh/thank-you");
    expect(SLEIGH_SOURCE).toBe("santa_sleigh");
    expect(SLEIGH_MIN_PENCE).toBe(200);
  });
});

describe("sleighPhase", () => {
  const off = "2027-01-31";
  it("is before ahead of the first night and on a gap day", () => {
    expect(sleighPhase("2026-11-10", NIGHTS, off)).toBe("before");
    expect(sleighPhase("2026-12-14", NIGHTS, off)).toBe("before");
    expect(sleighPhase("2026-12-19", NIGHTS, off)).toBe("before");
  });
  it("is on during a night", () => {
    expect(sleighPhase("2026-12-15", NIGHTS, off)).toBe("on");
    expect(sleighPhase("2026-12-22", NIGHTS, off)).toBe("on");
  });
  it("is after once the last night has gone, until the switch off day", () => {
    expect(sleighPhase("2026-12-23", NIGHTS, off)).toBe("after");
    expect(sleighPhase("2027-01-30", NIGHTS, off)).toBe("after");
  });
  it("is off from the switch off day", () => {
    expect(sleighPhase("2027-01-31", NIGHTS, off)).toBe("off");
    expect(sleighPhase("2027-03-01", NIGHTS, off)).toBe("off");
  });
  it("with no nights at all is before, until switched off", () => {
    expect(sleighPhase("2026-12-01", [], off)).toBe("before");
    expect(sleighPhase("2027-02-01", [], off)).toBe("off");
  });
});

describe("roadStop", () => {
  it("waits at the first house before the first night", () => {
    expect(roadStop("2026-11-10", NIGHTS)).toBe(0);
  });
  it("is tonight's house on a night", () => {
    expect(roadStop("2026-12-18", NIGHTS)).toBe(3);
  });
  it("is the next house on a gap day", () => {
    expect(roadStop("2026-12-19", NIGHTS)).toBe(4);
  });
  it("is past the last house afterwards", () => {
    expect(roadStop("2026-12-23", NIGHTS)).toBe(7);
  });
  it("reads the nights in date order whatever order they come in", () => {
    expect(roadStop("2026-12-18", [...NIGHTS].reverse())).toBe(3);
  });
});

describe("timesLabel", () => {
  it("says Timings TBC until both times are set", () => {
    expect(timesLabel(NIGHTS[0])).toBe("Timings TBC");
    expect(timesLabel({ ...NIGHTS[0], startsAt: "18:00" })).toBe("Timings TBC");
  });
  it("says the times in words, with no dash", () => {
    expect(timesLabel({ ...NIGHTS[0], startsAt: "18:00", endsAt: "20:30" })).toBe("6pm to 8.30pm");
    expect(timesLabel({ ...NIGHTS[0], startsAt: "12:15", endsAt: "00:00" })).toBe("12.15pm to 12am");
  });
});

describe("dayLabel", () => {
  it("names the day, the date and the month", () => {
    expect(dayLabel("2026-12-15")).toEqual({ day: "Tue", date: "15", month: "Dec" });
    expect(dayLabel("2026-12-20")).toEqual({ day: "Sun", date: "20", month: "Dec" });
  });
});
