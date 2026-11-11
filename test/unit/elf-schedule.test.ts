import { describe, it, expect } from "vitest";
import { dueNow, proudKeys, type Due } from "../../src/elf/schedule";
import { progressOf } from "../../src/elf/progress";
import type { DoorRun } from "../../src/db/elf-game";
import type { DoorFacts } from "../../src/elf/doors";

// NBCC Elf Detective School wave 2: what the elf worker sends, and when (src/elf/schedule.ts). Pure, so
// every window is pinned here with literal times. December has no clock change, so London is UTC: door 7
// is Monday 7 December 2026, a school day, with its clues at 5:30pm, 6pm and 6:30pm and its place shown
// at 7pm; door 6 is Sunday 6 December, a morning door, found at 10:20am. Every place here is invented.

const at = (iso: string) => new Date(iso);

/** A door as loadDoorRuns gives it: hand made, so the times the schedule reads are the ones written here. */
function run(door: 6 | 7, over: { facts?: Partial<DoorFacts>; contactEmail?: string | null } = {}): DoorRun {
  const times =
    door === 7
      ? { clue1At: at("2026-12-07T17:30:00Z"), clue2At: at("2026-12-07T18:00:00Z"), clue3At: at("2026-12-07T18:30:00Z"), revealAt: at("2026-12-07T19:00:00Z"), closesAt: at("2026-12-07T20:00:00Z") }
      : { clue1At: at("2026-12-06T10:00:00Z"), clue2At: at("2026-12-06T10:30:00Z"), clue3At: at("2026-12-06T11:00:00Z"), revealAt: at("2026-12-06T11:30:00Z"), closesAt: at("2026-12-06T17:00:00Z") };
  const facts: DoorFacts = { ...times, foundAt: null, snowDay: false, goneHome: false, ...over.facts };
  return {
    year: 2026,
    door,
    facts,
    calendarAt: facts.clue1At,
    state: "hunting",
    placeName: door === 7 ? "The Example Bakehouse" : "The Example Mill",
    placeTown: "Snowford",
    names: [],
    contactEmail: over.contactEmail === undefined ? `door${door}@example.org` : over.contactEmail,
    closesAt: null,
    tagWord: "SNOWBALL 472",
    elfName: "Pip",
    prize: "A pretend sledge",
    prizeShowOff: false,
    posterCode: door === 7 ? "abcdefghijkm" : "c3d4e5f6g7h8",
    clues: [],
    foundFamilyId: null,
  };
}

const due = (now: string, runs: DoorRun[] = [run(7)], doorsOn = true): Due[] => dueNow({ year: 2026, runs, now: at(now), doorsOn });
const kinds = (list: Due[], kind: Due["kind"]) => list.filter((d) => d.kind === kind);

describe("the clue email", () => {
  it("is due from a door's first clue for six hours", () => {
    expect(kinds(due("2026-12-07T17:29:59Z"), "clue")).toEqual([]);
    expect(kinds(due("2026-12-07T17:31:00Z"), "clue")).toEqual([{ kind: "clue", key: "2026-7", door: 7 }]);
    expect(kinds(due("2026-12-07T23:29:00Z"), "clue")).toEqual([{ kind: "clue", key: "2026-7", door: 7 }]);
    expect(kinds(due("2026-12-07T23:31:00Z"), "clue")).toEqual([]);
  });

  it("never goes for a snow day, and neither does the place's reminder", () => {
    const snow = [run(7, { facts: { snowDay: true } })];
    for (const now of ["2026-12-07T09:05:00Z", "2026-12-07T17:31:00Z", "2026-12-07T19:30:00Z"]) {
      expect(kinds(due(now, snow), "clue"), now).toEqual([]);
      expect(kinds(due(now, snow), "reminder"), now).toEqual([]);
    }
  });
});

describe("the place's reminder", () => {
  it("is due from 9am on the door's own day for three hours", () => {
    expect(kinds(due("2026-12-07T08:59:00Z"), "reminder")).toEqual([]);
    expect(kinds(due("2026-12-07T09:05:00Z"), "reminder")).toEqual([{ kind: "reminder", key: "2026-7", door: 7 }]);
    expect(kinds(due("2026-12-07T11:59:00Z"), "reminder")).toEqual([{ kind: "reminder", key: "2026-7", door: 7 }]);
    expect(kinds(due("2026-12-07T12:01:00Z"), "reminder")).toEqual([]);
    // Another day's 9am is not this door's.
    expect(kinds(due("2026-12-06T09:05:00Z"), "reminder")).toEqual([]);
  });

  it("is never due for a place with no email to send it to", () => {
    expect(kinds(due("2026-12-07T09:05:00Z", [run(7, { contactEmail: null })]), "reminder")).toEqual([]);
  });
});

describe("the morning email to head elves", () => {
  it("is due from 8am London, keyed by the London date", () => {
    expect(kinds(due("2026-12-07T07:59:00Z"), "morning")).toEqual([]);
    expect(kinds(due("2026-12-07T08:00:00Z"), "morning")).toEqual([{ kind: "morning", key: "2026-12-07", door: null }]);
    // Still that day's, if the worker was down at 8am.
    expect(kinds(due("2026-12-07T22:30:00Z"), "morning")).toEqual([{ kind: "morning", key: "2026-12-07", door: null }]);
  });

  it("goes each day from 30 November to 25 December, and on no other", () => {
    expect(kinds(due("2026-11-29T09:00:00Z", []), "morning")).toEqual([]);
    expect(kinds(due("2026-11-30T09:00:00Z", []), "morning")).toEqual([{ kind: "morning", key: "2026-11-30", door: null }]);
    expect(kinds(due("2026-12-25T09:00:00Z", []), "morning")).toEqual([{ kind: "morning", key: "2026-12-25", door: null }]);
    expect(kinds(due("2026-12-26T09:00:00Z", []), "morning")).toEqual([]);
    // Another year's December is not this school year's.
    expect(kinds(due("2025-12-07T09:00:00Z", []), "morning")).toEqual([]);
  });
});

describe("the find alert", () => {
  it("is due for a door whose elf has been found, keyed by its door", () => {
    const runs = [run(6, { facts: { foundAt: at("2026-12-06T10:20:00Z") } }), run(7)];
    expect(kinds(due("2026-12-07T17:31:00Z", runs), "find")).toEqual([{ kind: "find", key: "2026-6", door: 6 }]);
  });
});

describe("the sweep for proud moments", () => {
  it("is due on every tick, its key changing every ten minutes", () => {
    expect(kinds(due("2026-12-07T17:31:00Z"), "sweep")).toEqual([{ kind: "sweep", key: "2026:2994441", door: null }]);
    expect(kinds(due("2026-12-07T17:39:59Z"), "sweep")).toEqual([{ kind: "sweep", key: "2026:2994441", door: null }]);
    expect(kinds(due("2026-12-07T17:40:00Z"), "sweep")).toEqual([{ kind: "sweep", key: "2026:2994442", door: null }]);
  });
});

describe("a tick's order", () => {
  // The clue email is the one families wait for, so a tick sends it before anything else.
  it("is the clue emails, then the reminders, the morning email, the find alerts and the sweep", () => {
    // 10:30am on Sunday 6 December: door 6's first clue is out, its place's reminder is due, and it was
    // found at 10:20am.
    const runs = [run(6, { facts: { foundAt: at("2026-12-06T10:20:00Z") } })];
    expect(due("2026-12-06T10:30:00Z", runs).map((d) => d.kind)).toEqual(["clue", "reminder", "morning", "find", "sweep"]);
  });
});

describe("with December's doors switched off", () => {
  it("nothing is due on 7 December, whatever the doors hold", () => {
    const runs = [run(6, { facts: { foundAt: at("2026-12-06T10:20:00Z") } }), run(7)];
    for (const now of ["2026-12-07T08:00:00Z", "2026-12-07T09:05:00Z", "2026-12-07T17:31:00Z"]) {
      expect(due(now, runs, false), now).toEqual([]);
    }
  });
});

describe("proud moments", () => {
  const doors = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  it("are none before the first promotion", () => {
    expect(proudKeys(2026, 5, progressOf({ cracked: doors(1, 5), visited: [], snow: [] }))).toEqual([]);
  });

  it("name the rank a detective has reached at six doors", () => {
    expect(proudKeys(2026, 5, progressOf({ cracked: [1, 2, 3, 4, 5, 6], visited: [], snow: [] }))).toEqual(["rank:5:Junior Detective"]);
  });

  it("count a snow day and a visit towards a rank, as progress does", () => {
    expect(proudKeys(2026, 9, progressOf({ cracked: [1, 2], visited: doors(3, 11), snow: [12] }))).toEqual(["rank:9:Junior Detective", "rank:9:Detective"]);
  });

  // Graduating is its own moment: a detective who has done every door gets the graduation, never a
  // promotion to Graduate as well, so a family is not sent two emails for one thing.
  it("give a graduate every promotion and the graduation, once", () => {
    const keys = proudKeys(2026, 5, progressOf({ cracked: doors(1, 20), visited: [], snow: doors(21, 24) }));
    expect(keys).toContain("grad:5");
    expect(keys).toEqual(["rank:5:Junior Detective", "rank:5:Detective", "rank:5:Senior Detective", "grad:5"]);
  });
});
