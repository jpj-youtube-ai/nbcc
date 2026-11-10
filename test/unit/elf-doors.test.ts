import { describe, it, expect } from "vitest";
import {
  canGuess,
  cluesOut,
  doorState,
  isClaimable,
  isDone,
  isOpen,
  nextClueAt,
  openedAt,
  shownAt,
  type DoorFacts,
} from "../../src/elf/doors";
import { closingInstant, doorInstant } from "../../src/elf/calendar";

// NBCC Elf Detective School: where a door is up to. Pure, checked here without a clock. Door 7 is
// 7 December 2026; its default evening is clue 1 at 17:30, clue 2 at 18:00, clue 3 at 18:30, the
// place shown at 19:00 and the place closing at 20:00 (December London time is GMT).

const SEASON = { year: 2026 };
const evening = { clue1: "17:30", clue2: "18:00", clue3: "18:30", reveal: "19:00" };
const instant = (time: string): Date => {
  const d = doorInstant(SEASON, 7, time);
  if (!d) throw new Error("bad test time " + time);
  return d;
};
const CLOSES = closingInstant(SEASON, 7, evening.clue1, "20:00") as Date;
const day7 = (time: string): Date => instant(time);

const door = (over: Partial<DoorFacts> = {}): DoorFacts => ({
  clue1At: instant(evening.clue1),
  clue2At: instant(evening.clue2),
  clue3At: instant(evening.clue3),
  revealAt: instant(evening.reveal),
  closesAt: CLOSES,
  foundAt: null,
  snowDay: false,
  goneHome: false,
  ...over,
});

describe("the evening the tests use", () => {
  it("is the defaults for door 7", () => {
    expect([evening.clue1, evening.clue2, evening.clue3, evening.reveal]).toEqual(["17:30", "18:00", "18:30", "19:00"]);
    expect(CLOSES.toISOString()).toBe("2026-12-07T20:00:00.000Z");
  });
});

describe("where a door is up to", () => {
  it("is shut until clue 1 comes out", () => {
    expect(doorState(door(), day7("17:29"))).toBe("shut");
    expect(doorState(door(), new Date("2026-12-01T09:00:00.000Z"))).toBe("shut");
  });

  it("is hunting from clue 1", () => {
    expect(doorState(door(), day7("17:30"))).toBe("hunting");
    expect(doorState(door(), day7("18:59"))).toBe("hunting");
  });

  it("is found-hidden when found before the place is shown, then found at the reveal", () => {
    const found = door({ foundAt: day7("17:47") });
    expect(doorState(found, day7("17:46"))).toBe("hunting");
    expect(doorState(found, day7("18:10"))).toBe("found-hidden");
    expect(doorState(found, day7("18:59"))).toBe("found-hidden");
    expect(doorState(found, day7("19:00"))).toBe("found");
    expect(openedAt(found, day7("19:00"))?.toISOString()).toBe("2026-12-07T19:00:00.000Z");
  });

  it("is found at once when found after the reveal", () => {
    const late = door({ foundAt: day7("19:20") });
    expect(doorState(late, day7("19:19"))).toBe("hunting");
    expect(doorState(late, day7("19:20"))).toBe("found");
    expect(openedAt(late, day7("19:20"))?.toISOString()).toBe("2026-12-07T19:20:00.000Z");
  });

  it("is still hunting between the reveal and closing, then revealed", () => {
    expect(doorState(door(), day7("19:30"))).toBe("hunting");
    expect(doorState(door(), day7("19:59"))).toBe("hunting");
    expect(doorState(door(), day7("20:00"))).toBe("revealed");
    expect(openedAt(door(), day7("20:00"))?.toISOString()).toBe("2026-12-07T20:00:00.000Z");
    expect(openedAt(door(), day7("19:30"))).toBeNull();
  });

  it("is found, not revealed, once someone claims a revealed elf", () => {
    const late = door({ foundAt: new Date("2026-12-08T10:15:00.000Z") });
    expect(doorState(late, new Date("2026-12-08T10:00:00.000Z"))).toBe("revealed");
    expect(doorState(late, new Date("2026-12-08T10:15:00.000Z"))).toBe("found");
    expect(openedAt(late, new Date("2026-12-08T11:00:00.000Z"))?.toISOString()).toBe("2026-12-07T20:00:00.000Z");
  });

  it("stays shut when clue 1 is not a real date", () => {
    const broken = door({ clue1At: new Date(Number.NaN) });
    expect(doorState(broken, day7("18:00"))).toBe("shut");
    expect(doorState(broken, new Date("2026-12-20T18:00:00.000Z"))).toBe("shut");
  });

  it("is snow from clue 1 on a snow day, and shut before it", () => {
    const snowed = door({ snowDay: true });
    expect(doorState(snowed, day7("17:29"))).toBe("shut");
    expect(doorState(snowed, day7("17:30"))).toBe("snow");
    expect(doorState(snowed, new Date("2026-12-20T12:00:00.000Z"))).toBe("snow");
    expect(openedAt(snowed, day7("18:30"))).toBeNull();
    expect(openedAt(snowed, new Date("2026-12-20T12:00:00.000Z"))).toBeNull();
    expect(cluesOut(snowed, day7("18:30"))).toBe(0);
    expect(nextClueAt(snowed, day7("17:45"))).toBeNull();
  });
});

describe("when the place is shown", () => {
  it("is closing when nobody has found the elf", () => {
    expect(shownAt(door()).toISOString()).toBe("2026-12-07T20:00:00.000Z");
  });
  it("is the reveal when the elf is found before it", () => {
    expect(shownAt(door({ foundAt: day7("17:47") })).toISOString()).toBe("2026-12-07T19:00:00.000Z");
  });
  it("is the find when it comes after the reveal and before closing", () => {
    expect(shownAt(door({ foundAt: day7("19:20") })).toISOString()).toBe("2026-12-07T19:20:00.000Z");
  });
  it("is closing when the find comes later still", () => {
    expect(shownAt(door({ foundAt: new Date("2026-12-08T10:15:00.000Z") })).toISOString()).toBe("2026-12-07T20:00:00.000Z");
  });
});

describe("the clues out", () => {
  it("count 0, 1, 2, 3 as each comes out", () => {
    expect(cluesOut(door(), day7("17:29"))).toBe(0);
    expect(cluesOut(door(), day7("17:30"))).toBe(1);
    expect(cluesOut(door(), day7("18:00"))).toBe(2);
    expect(cluesOut(door(), day7("18:30"))).toBe(3);
  });
  it("name the next one still to come", () => {
    expect(nextClueAt(door(), day7("17:45"))?.toISOString()).toBe("2026-12-07T18:00:00.000Z");
    expect(nextClueAt(door(), day7("17:00"))?.toISOString()).toBe("2026-12-07T17:30:00.000Z");
    expect(nextClueAt(door(), day7("18:30"))).toBeNull();
  });
});

describe("what a door's state allows", () => {
  it("shows the place once the door is found or revealed", () => {
    expect(isOpen("shut")).toBe(false);
    expect(isOpen("hunting")).toBe(false);
    expect(isOpen("found-hidden")).toBe(false);
    expect(isOpen("snow")).toBe(false);
    expect(isOpen("found")).toBe(true);
    expect(isOpen("revealed")).toBe(true);
  });

  it("lets the elf be claimed while hunted or waiting at a revealed place", () => {
    expect(isClaimable("shut")).toBe(false);
    expect(isClaimable("hunting")).toBe(true);
    expect(isClaimable("revealed")).toBe(true);
    expect(isClaimable("found")).toBe(false);
    expect(isClaimable("found-hidden")).toBe(false);
    expect(isClaimable("snow")).toBe(false);
  });

  it("lets a guess be typed only while hunting or found-hidden", () => {
    expect(canGuess("hunting")).toBe(true);
    expect(canGuess("found-hidden")).toBe(true);
    for (const s of ["shut", "found", "revealed", "snow"] as const) expect(canGuess(s)).toBe(false);
  });

  it("counts a snow day as done", () => {
    expect(isDone("snow")).toBe(true);
    expect(isDone("found")).toBe(true);
    expect(isDone("revealed")).toBe(true);
    expect(isDone("hunting")).toBe(false);
    expect(isDone("found-hidden")).toBe(false);
    expect(isDone("shut")).toBe(false);
  });
});
