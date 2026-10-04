# Elf Detective School, plan A1: the game rules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rules of NBCC Elf Detective School as pure, tested functions: the calendar and clue times, door states, guessing, claiming, stamps, progress and ranks, names, the approved facts, and the planning map's projection.

**Architecture:** One new folder, `src/elf/`, of small pure modules (no pool, no config, no clock: `now` is passed in), each with its own Vitest file in `test/unit/`. Nothing is mounted, listed or wired: this plan touches no shared file. It reuses three existing pure helpers by import only: `londonToInstant` (`src/tickets/model.ts`), `containsBlockedWord` (`src/donors/display-name-filter.ts`) and nothing else.

**Tech Stack:** TypeScript (strict, CommonJS), Vitest. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-04-elf-detective-school-design.md`, section "Rules, precisely".

**House rules that tests already enforce, so follow them in every file:**

- The building is always written `Elves' Workshop` (straight apostrophe after the s). `test/unit/elves-workshop-name.test.ts` scans every file under `src/`, comments included, and fails on any other spelling.
- Words people read have no dashes: no en or em dashes, and no hyphen between word characters ("aged twelve", never "twelve-year-old").
- Every name and word in a test is invented. The repo is public.
- Source files open with a `//` block saying what the file is for and why, that it is pure, and where it is tested.

**Running things.** From the worktree root (`.claude/worktrees/elf-detective`):
`npx vitest run test/unit/<file>` runs one test file; `npm run lint` and `npm run build` check the whole repo. This plan is Stage A: commit locally, never push, never open a PR.

## File structure

| File | Responsibility |
|---|---|
| `src/elf/calendar.ts` | Door numbers and dates, the kind of day, default and actual clue times |
| `src/elf/doors.ts` | A door's state (`shut`, `hunting`, `found`, `revealed`) and what each allows |
| `src/elf/guess.ts` | The places a family can guess from, whether a guess is allowed, whether it cracked the case |
| `src/elf/claim.ts` | The secret word comparison, whether a claim is valid, who was first |
| `src/elf/distance.ts` | Metres between two points, and "is this phone near this place" |
| `src/elf/stamps.ts` | Whether a visit earns a stamp, and on what proof |
| `src/elf/progress.ts` | Doors done, rank, graduate, gold seal, promotions |
| `src/elf/names.ts` | Festive surnames, elf names, secret word ideas, first name checks, detective names |
| `src/elf/facts.ts` | The 24 facts Jaimie approved, with the line for each door |
| `src/elf/map.ts` | The About us map's projection, miles on the map, and "far from every hiding place" |

---

### Task 1: The calendar and clue times

**Files:**
- Create: `src/elf/calendar.ts`
- Test: `test/unit/elf-calendar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-calendar.test.ts`
Expected: FAIL, cannot find module `../../src/elf/calendar`.

- [ ] **Step 3: Write the implementation**

```ts
import { londonToInstant } from "../tickets/model";

// NBCC Elf Detective School: which day each door belongs to and when its clue comes out. The design
// is docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// The clue time is what keeps the race fair, so it follows the kind of day: after school and work on
// a school day, in the morning at a weekend or in the school holidays. Staff can set any door's time
// by hand; these are only the times a door starts with.
//
// Pure: no pool, no config, no clock (times are passed in). Unit tested in
// test/unit/elf-calendar.test.ts.

export const DOOR_COUNT = 24;

export type DayKind = "school" | "weekend" | "holiday";

export interface ElfSeason {
  /** The December the hunt runs in. */
  year: number;
  /** Doors staff have marked as school holidays. Weekends are worked out, not listed. */
  holidayDoors: readonly number[];
  /** The clue time on a school day, "HH:MM" on a clock in London. */
  schoolClue: string;
  /** The clue time at a weekend or in the holidays. */
  morningClue: string;
}

export const DEFAULT_SCHOOL_CLUE = "17:30";
export const DEFAULT_MORNING_CLUE = "10:00";

/** Is this a door number, 1 to 24? */
export function isDoor(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= DOOR_COUNT;
}

/** The date a door belongs to, as YYYY-MM-DD. Door 7 is 7 December. */
export function doorDate(season: Pick<ElfSeason, "year">, door: number): string {
  return `${season.year}-12-${String(door).padStart(2, "0")}`;
}

/** The door a London date belongs to, or null outside 1 to 24 December of the season's year. */
export function doorOn(season: Pick<ElfSeason, "year">, londonDate: string): number | null {
  const m = /^(\d{4})-12-(\d{2})$/.exec(londonDate);
  if (!m || Number(m[1]) !== season.year) return null;
  const day = Number(m[2]);
  return isDoor(day) ? day : null;
}

/** A school day, a weekend, or a weekday staff have marked as a holiday. A weekend is always a weekend. */
export function dayKind(season: ElfSeason, door: number): DayKind {
  const weekday = new Date(Date.UTC(season.year, 11, door)).getUTCDay(); // 0 is Sunday, 6 is Saturday
  if (weekday === 0 || weekday === 6) return "weekend";
  return season.holidayDoors.includes(door) ? "holiday" : "school";
}

/** The clue time a door starts with, before staff change it. */
export function defaultClueTime(season: ElfSeason, door: number): string {
  return dayKind(season, door) === "school" ? season.schoolClue : season.morningClue;
}

/** The moment a door's clue comes out: its own day at a London clock time. Null if either is not real. */
export function clueInstant(season: Pick<ElfSeason, "year">, door: number, time: string): Date | null {
  if (!isDoor(door) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const iso = londonToInstant(`${doorDate(season, door)}T${time}`);
  return iso ? new Date(iso) : null;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-calendar.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/calendar.ts test/unit/elf-calendar.test.ts
git commit -m "Elf Detective School: the calendar and clue times"
```

---

### Task 2: Door states

**Files:**
- Create: `src/elf/doors.ts`
- Test: `test/unit/elf-doors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { doorState, isClaimable, isOpen, type DoorFacts } from "../../src/elf/doors";

// NBCC Elf Detective School: where a door is up to. Pure, checked here without a clock.

const CLUE = new Date("2026-12-07T17:30:00.000Z");
const CLOSES = new Date("2026-12-07T21:00:00.000Z");
const at = (iso: string) => new Date(iso);
const door = (over: Partial<DoorFacts> = {}): DoorFacts => ({ clueAt: CLUE, revealAt: CLOSES, foundAt: null, ...over });

describe("where a door is up to", () => {
  it("is shut until its clue comes out", () => {
    expect(doorState(door(), at("2026-12-07T17:29:59.000Z"))).toBe("shut");
    expect(doorState(door(), at("2026-12-01T09:00:00.000Z"))).toBe("shut");
  });

  it("is hunting from the moment the clue is out", () => {
    expect(doorState(door(), CLUE)).toBe("hunting");
    expect(doorState(door(), at("2026-12-07T20:59:59.000Z"))).toBe("hunting");
  });

  it("is found from the moment of the winning claim", () => {
    const found = door({ foundAt: at("2026-12-07T17:47:00.000Z") });
    expect(doorState(found, at("2026-12-07T17:46:59.000Z"))).toBe("hunting");
    expect(doorState(found, at("2026-12-07T17:47:00.000Z"))).toBe("found");
    expect(doorState(found, at("2026-12-20T12:00:00.000Z"))).toBe("found");
  });

  it("is revealed when the place closes with the elf still hiding", () => {
    expect(doorState(door(), CLOSES)).toBe("revealed");
    expect(doorState(door(), at("2026-12-08T09:00:00.000Z"))).toBe("revealed");
  });

  it("stays hunting overnight when the place has no closing time set", () => {
    expect(doorState(door({ revealAt: null }), at("2026-12-08T09:00:00.000Z"))).toBe("hunting");
  });

  it("is found, not revealed, once someone claims a revealed elf", () => {
    const late = door({ foundAt: at("2026-12-08T10:15:00.000Z") });
    expect(doorState(late, at("2026-12-08T10:00:00.000Z"))).toBe("revealed");
    expect(doorState(late, at("2026-12-08T10:15:00.000Z"))).toBe("found");
  });
});

describe("what a door's state allows", () => {
  it("shows the place once the door is found or revealed", () => {
    expect(isOpen("shut")).toBe(false);
    expect(isOpen("hunting")).toBe(false);
    expect(isOpen("found")).toBe(true);
    expect(isOpen("revealed")).toBe(true);
  });

  it("lets the elf be claimed while it is hunted or waiting at a revealed place", () => {
    expect(isClaimable("shut")).toBe(false);
    expect(isClaimable("hunting")).toBe(true);
    expect(isClaimable("revealed")).toBe(true);
    expect(isClaimable("found")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-doors.test.ts`
Expected: FAIL, cannot find module `../../src/elf/doors`.

- [ ] **Step 3: Write the implementation**

```ts
// NBCC Elf Detective School: where a door is up to. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// A door is shut until its clue comes out, then the elf is hunted. It opens, which means its place
// is shown, in one of two ways: someone finds the elf, or the place closes for the day with the elf
// still hiding. In the second case the elf waits there and the first valid claim still wins.
//
// Pure: no pool, no config, no clock (the time is passed in). Unit tested in
// test/unit/elf-doors.test.ts.

export type DoorState = "shut" | "hunting" | "found" | "revealed";

export interface DoorFacts {
  /** When the clue comes out. */
  clueAt: Date;
  /** When the place closes on its day. Null means no time is set, so the door hunts until found. */
  revealAt: Date | null;
  /** When the winning claim was made, or null while nobody has found the elf. */
  foundAt: Date | null;
}

/** The door's state at a moment. Found beats everything, because a revealed elf can still be claimed. */
export function doorState(door: DoorFacts, now: Date): DoorState {
  const t = now.getTime();
  if (door.foundAt && door.foundAt.getTime() <= t) return "found";
  if (t < door.clueAt.getTime()) return "shut";
  if (door.revealAt && t >= door.revealAt.getTime()) return "revealed";
  return "hunting";
}

/** Is the place shown? True once the elf is found or the place has been revealed. */
export function isOpen(state: DoorState): boolean {
  return state === "found" || state === "revealed";
}

/** Can the elf still be claimed? True while it is hunted, and while it waits at a revealed place. */
export function isClaimable(state: DoorState): boolean {
  return state === "hunting" || state === "revealed";
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-doors.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/doors.ts test/unit/elf-doors.test.ts
git commit -m "Elf Detective School: door states"
```

---

### Task 3: Guessing

**Files:**
- Create: `src/elf/guess.ts`
- Test: `test/unit/elf-guess.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { cracked, decideGuess, guessOptions } from "../../src/elf/guess";

// NBCC Elf Detective School: the daily guess. Every place here is invented.

const PLACES = ["toy-shop", "bakery", "cinema", "cafe"];

describe("the places a family can guess from", () => {
  it("offers every hiding place whose own door is not open", () => {
    expect(guessOptions(PLACES, ["bakery"])).toEqual(["toy-shop", "cinema", "cafe"]);
    expect(guessOptions(PLACES, [])).toEqual(PLACES);
  });

  it("offers nothing when every place is open", () => {
    expect(guessOptions(PLACES, PLACES)).toEqual([]);
  });
});

describe("locking in a guess", () => {
  const ctx = { doorState: "hunting", placeIds: PLACES, openPlaceIds: ["bakery"] } as const;

  it("takes a guess while the elf is being hunted", () => {
    expect(decideGuess(ctx, "cinema")).toEqual({ ok: true });
  });

  it("refuses a guess before the clue is out", () => {
    expect(decideGuess({ ...ctx, doorState: "shut" }, "cinema")).toEqual({ ok: false, reason: "not-hunting" });
  });

  it("refuses a guess once the door is open", () => {
    expect(decideGuess({ ...ctx, doorState: "found" }, "cinema")).toEqual({ ok: false, reason: "not-hunting" });
    expect(decideGuess({ ...ctx, doorState: "revealed" }, "cinema")).toEqual({ ok: false, reason: "not-hunting" });
  });

  it("refuses a place that is not on this year's list", () => {
    expect(decideGuess(ctx, "swimming-pool")).toEqual({ ok: false, reason: "unknown-place" });
  });

  it("refuses a place whose own door is already open", () => {
    expect(decideGuess(ctx, "bakery")).toEqual({ ok: false, reason: "place-already-open" });
  });
});

describe("cracking the case", () => {
  it("counts a guess that names the door's real place", () => {
    expect(cracked("cinema", "cinema")).toBe(true);
  });

  it("does not count a wrong guess, or no guess at all", () => {
    expect(cracked("bakery", "cinema")).toBe(false);
    expect(cracked(null, "cinema")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-guess.test.ts`
Expected: FAIL, cannot find module `../../src/elf/guess`.

- [ ] **Step 3: Write the implementation**

```ts
import type { DoorState } from "./doors";

// NBCC Elf Detective School: the daily guess. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Each family locks in one guess a day, picked from this year's hiding places, and can change it
// until the door opens. It is how a child who lives too far away to race still plays every day. The
// list they pick from gets shorter as elves are found, which suits the little ones.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-guess.test.ts.

export type GuessRefusal = "not-hunting" | "unknown-place" | "place-already-open";
export type GuessDecision = { ok: true } | { ok: false; reason: GuessRefusal };

export interface GuessContext {
  /** The state of the door being guessed. */
  doorState: DoorState;
  /** Every hiding place this year. */
  placeIds: readonly string[];
  /** The places whose own door is already open. */
  openPlaceIds: readonly string[];
}

/** The places a family can still choose: every hiding place whose own door is not open, in list order. */
export function guessOptions(placeIds: readonly string[], openPlaceIds: readonly string[]): string[] {
  const open = new Set(openPlaceIds);
  return placeIds.filter((id) => !open.has(id));
}

/** May this guess be locked in? Only while the elf is hunted, and only for a place still in play. */
export function decideGuess(ctx: GuessContext, placeId: string): GuessDecision {
  if (ctx.doorState !== "hunting") return { ok: false, reason: "not-hunting" };
  if (!ctx.placeIds.includes(placeId)) return { ok: false, reason: "unknown-place" };
  if (ctx.openPlaceIds.includes(placeId)) return { ok: false, reason: "place-already-open" };
  return { ok: true };
}

/** Did the family crack the case? Only a guess that names the door's real place counts. */
export function cracked(guessPlaceId: string | null, doorPlaceId: string): boolean {
  return guessPlaceId !== null && guessPlaceId === doorPlaceId;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-guess.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/guess.ts test/unit/elf-guess.test.ts
git commit -m "Elf Detective School: the daily guess"
```

---

### Task 4: Claiming an elf

**Files:**
- Create: `src/elf/claim.ts`
- Test: `test/unit/elf-claim.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { decideClaim, earliest, normaliseWord, type ClaimContext } from "../../src/elf/claim";

// NBCC Elf Detective School: claiming an elf with its secret word. Every id and word is invented.

describe("the secret word", () => {
  it("ignores capitals, spaces and punctuation", () => {
    expect(normaliseWord(" Snow Ball! ")).toBe("snowball");
    expect(normaliseWord("SNOW-BALL")).toBe("snowball");
    expect(normaliseWord("snowball")).toBe("snowball");
  });

  it("keeps digits", () => {
    expect(normaliseWord("Elf 24")).toBe("elf24");
  });

  it("treats nothing typed as an empty word", () => {
    expect(normaliseWord("")).toBe("");
    expect(normaliseWord(undefined as unknown as string)).toBe("");
  });
});

describe("claiming an elf", () => {
  const ctx: ClaimContext = {
    doorState: "hunting",
    secretWord: "Snowball",
    familyDetectiveIds: ["d1", "d2"],
    familyHasWon: false,
  };
  const claim = { detectiveIds: ["d1"], word: "snowball" };

  it("accepts the right word from a family's own detectives", () => {
    expect(decideClaim(ctx, claim)).toEqual({ ok: true });
    expect(decideClaim(ctx, { detectiveIds: ["d1", "d2"], word: " SNOW ball " })).toEqual({ ok: true });
  });

  it("accepts a claim on a revealed door, because the elf is still waiting", () => {
    expect(decideClaim({ ...ctx, doorState: "revealed" }, claim)).toEqual({ ok: true });
  });

  it("refuses before the clue is out", () => {
    expect(decideClaim({ ...ctx, doorState: "shut" }, claim)).toEqual({ ok: false, reason: "too-early" });
  });

  it("refuses once the elf has been found", () => {
    expect(decideClaim({ ...ctx, doorState: "found" }, claim)).toEqual({ ok: false, reason: "already-found" });
  });

  it("refuses with no detective chosen", () => {
    expect(decideClaim(ctx, { detectiveIds: [], word: "snowball" })).toEqual({ ok: false, reason: "no-detectives" });
  });

  it("refuses a detective from another family", () => {
    expect(decideClaim(ctx, { detectiveIds: ["d1", "d9"], word: "snowball" })).toEqual({
      ok: false,
      reason: "not-your-detective",
    });
  });

  it("refuses the wrong word, and an elf with no word set", () => {
    expect(decideClaim(ctx, { detectiveIds: ["d1"], word: "snowman" })).toEqual({ ok: false, reason: "wrong-word" });
    expect(decideClaim(ctx, { detectiveIds: ["d1"], word: "" })).toEqual({ ok: false, reason: "wrong-word" });
    expect(decideClaim({ ...ctx, secretWord: "" }, { detectiveIds: ["d1"], word: "" })).toEqual({
      ok: false,
      reason: "wrong-word",
    });
  });

  it("refuses a family that has already won an elf, even with the right word", () => {
    expect(decideClaim({ ...ctx, familyHasWon: true }, claim)).toEqual({ ok: false, reason: "already-won" });
  });
});

describe("who was first", () => {
  const a = { family: "a", at: new Date("2026-12-07T17:47:03.000Z") };
  const b = { family: "b", at: new Date("2026-12-07T17:47:01.000Z") };
  const c = { family: "c", at: new Date("2026-12-07T17:47:01.000Z") };

  it("picks the earliest claim", () => {
    expect(earliest([a, b])).toBe(b);
  });

  it("keeps the order they arrived in when two claims share a moment", () => {
    expect(earliest([a, b, c])).toBe(b);
    expect(earliest([c, b])).toBe(c);
  });

  it("has no winner with no claims", () => {
    expect(earliest([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-claim.test.ts`
Expected: FAIL, cannot find module `../../src/elf/claim`.

- [ ] **Step 3: Write the implementation**

```ts
import { isClaimable, type DoorState } from "./doors";

// NBCC Elf Detective School: claiming an elf. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Each elf wears a tag with a secret word. The finder scans the business's poster and types the
// word, so an elf can only be claimed by someone holding it: a photo of the poster passed round
// online is not enough. One elf per family, so that more families win.
//
// These functions say whether a claim is valid. Which valid claim was FIRST is settled where the
// claims are stored, by the order they arrive; `earliest` states the same rule for anything working
// from a list.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-claim.test.ts.

/** The secret word as it is compared: letters and digits only, in lower case. */
export function normaliseWord(typed: string): string {
  return String(typed ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export type ClaimRefusal =
  | "too-early"
  | "already-found"
  | "no-detectives"
  | "not-your-detective"
  | "wrong-word"
  | "already-won";
export type ClaimDecision = { ok: true } | { ok: false; reason: ClaimRefusal };

export interface ClaimContext {
  /** The state of the door whose elf is being claimed. */
  doorState: DoorState;
  /** The word on this elf's tag. */
  secretWord: string;
  /** Every detective in the claiming family. */
  familyDetectiveIds: readonly string[];
  /** Has this family already won an elf this year? */
  familyHasWon: boolean;
}

export interface ClaimAttempt {
  /** The detectives who are there. */
  detectiveIds: readonly string[];
  /** The word they typed. */
  word: string;
}

/** Is this claim valid? The word is checked before the one elf per family rule, so a family that has
 *  already won is told so kindly rather than told their word is wrong. */
export function decideClaim(ctx: ClaimContext, attempt: ClaimAttempt): ClaimDecision {
  if (ctx.doorState === "shut") return { ok: false, reason: "too-early" };
  if (!isClaimable(ctx.doorState)) return { ok: false, reason: "already-found" };
  if (attempt.detectiveIds.length === 0) return { ok: false, reason: "no-detectives" };
  if (!attempt.detectiveIds.every((id) => ctx.familyDetectiveIds.includes(id))) {
    return { ok: false, reason: "not-your-detective" };
  }
  const want = normaliseWord(ctx.secretWord);
  if (want === "" || normaliseWord(attempt.word) !== want) return { ok: false, reason: "wrong-word" };
  if (ctx.familyHasWon) return { ok: false, reason: "already-won" };
  return { ok: true };
}

/** Of several claims on one door, the first: the earliest, and on a tie the one that arrived first. */
export function earliest<T extends { at: Date }>(claims: readonly T[]): T | null {
  let first: T | null = null;
  for (const claim of claims) {
    if (first === null || claim.at.getTime() < first.at.getTime()) first = claim;
  }
  return first;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-claim.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/claim.ts test/unit/elf-claim.test.ts
git commit -m "Elf Detective School: claiming an elf with its secret word"
```

---

### Task 5: Distance

**Files:**
- Create: `src/elf/distance.ts`
- Test: `test/unit/elf-distance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { MAX_ACCURACY_ALLOWANCE_METRES, NEAR_METRES, isLatLng, isNear, metresBetween } from "../../src/elf/distance";

// NBCC Elf Detective School: how far a phone is from a hiding place. The points are invented.

const PLACE = { lat: 55.458, lng: -4.629 };
// One degree of latitude is 111,195 metres on the sphere this uses, so this many degrees north is N metres.
const north = (metres: number) => ({ lat: PLACE.lat + metres / 111_195, lng: PLACE.lng });

describe("the distance between two points", () => {
  it("is nothing between a point and itself", () => {
    expect(metresBetween(PLACE, PLACE)).toBe(0);
  });

  it("is about 111 kilometres for one degree of latitude", () => {
    expect(metresBetween({ lat: 55, lng: -4 }, { lat: 56, lng: -4 })).toBeCloseTo(111_195, -1);
  });

  it("shrinks with latitude for one degree of longitude", () => {
    expect(metresBetween({ lat: 60, lng: 0 }, { lat: 60, lng: 1 })).toBeCloseTo(55_597, -1);
  });

  it("is the same in either direction", () => {
    const a = { lat: 55.611, lng: -4.495 };
    expect(metresBetween(PLACE, a)).toBeCloseTo(metresBetween(a, PLACE), 6);
  });
});

describe("a real position", () => {
  it("is two finite numbers within the globe", () => {
    expect(isLatLng(PLACE)).toBe(true);
    expect(isLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isLatLng({ lat: 0, lng: 181 })).toBe(false);
    expect(isLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isLatLng({ lat: "55", lng: "-4" })).toBe(false);
    expect(isLatLng(null)).toBe(false);
    expect(isLatLng("here")).toBe(false);
  });
});

describe("being near a hiding place", () => {
  it("allows 300 metres by default", () => {
    expect(NEAR_METRES).toBe(300);
    expect(isNear(PLACE, north(200))).toBe(true);
    expect(isNear(PLACE, north(299))).toBe(true);
    expect(isNear(PLACE, north(400))).toBe(false);
  });

  it("allows for a phone that says its own position is rough", () => {
    expect(isNear(PLACE, { ...north(400), accuracyMetres: 150 })).toBe(true);
    expect(isNear(PLACE, { ...north(400), accuracyMetres: 50 })).toBe(false);
  });

  it("caps that allowance, so a wildly unsure phone cannot check in from across town", () => {
    expect(MAX_ACCURACY_ALLOWANCE_METRES).toBe(500);
    expect(isNear(PLACE, { ...north(700), accuracyMetres: 5000 })).toBe(true);
    expect(isNear(PLACE, { ...north(900), accuracyMetres: 5000 })).toBe(false);
  });

  it("ignores a negative accuracy", () => {
    expect(isNear(PLACE, { ...north(400), accuracyMetres: -200 })).toBe(false);
  });

  it("uses the distance staff have set", () => {
    expect(isNear(PLACE, north(400), 500)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-distance.test.ts`
Expected: FAIL, cannot find module `../../src/elf/distance`.

- [ ] **Step 3: Write the implementation**

```ts
// NBCC Elf Detective School: how far a phone is from a hiding place. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// A stamp needs proof of being there, because every business keeps its poster up all month and a
// photo of it could be passed round online. The phone's position is checked once against the place
// and then thrown away: nothing about where anyone is gets stored. Phones are often vague indoors,
// so the phone's own estimate of how rough its position is widens the allowance, up to a cap.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-distance.test.ts.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METRES = 6_371_000;

/** How close counts as being there. */
export const NEAR_METRES = 300;

/** The most a phone's own uncertainty can add to that. */
export const MAX_ACCURACY_ALLOWANCE_METRES = 500;

/** Is this a real position: two finite numbers within the globe? */
export function isLatLng(value: unknown): value is LatLng {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** The distance between two points over the ground, in metres (the haversine formula). */
export function metresBetween(a: LatLng, b: LatLng): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Is the phone near the place? Within the radius, widened by the phone's own uncertainty up to the cap. */
export function isNear(
  place: LatLng,
  phone: LatLng & { accuracyMetres?: number },
  radiusMetres: number = NEAR_METRES,
): boolean {
  const allowance = Math.min(Math.max(phone.accuracyMetres ?? 0, 0), MAX_ACCURACY_ALLOWANCE_METRES);
  return metresBetween(place, phone) <= radiusMetres + allowance;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-distance.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/distance.ts test/unit/elf-distance.test.ts
git commit -m "Elf Detective School: distance from a hiding place"
```

---

### Task 6: Stamps

**Files:**
- Create: `src/elf/stamps.ts`
- Test: `test/unit/elf-stamps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { decideStamp, type StampContext } from "../../src/elf/stamps";

// NBCC Elf Detective School: earning a candy cane stamp for visiting. Every id and place is invented.

const PLACE = { lat: 55.458, lng: -4.629 };
const HERE = { lat: 55.4585, lng: -4.629 }; // about 55 metres north
const FAR = { lat: 55.5, lng: -4.629 }; // about 4.7 kilometres north

const ctx: StampContext = {
  doorState: "found",
  place: PLACE,
  familyDetectiveIds: ["d1", "d2", "d3"],
  alreadyStamped: [],
};

describe("earning a stamp", () => {
  it("stamps the detectives who are there when the phone is near the place", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1", "d2"], location: HERE, hasPhoto: false })).toEqual({
      ok: true,
      detectiveIds: ["d1", "d2"],
      proof: "location",
    });
  });

  it("works on a revealed door too", () => {
    const got = decideStamp({ ...ctx, doorState: "revealed" }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false });
    expect(got.ok).toBe(true);
  });

  it("takes a photo instead when no location is shared", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: null, hasPhoto: true })).toEqual({
      ok: true,
      detectiveIds: ["d1"],
      proof: "photo",
    });
  });

  it("takes a photo when the location is too far, and says the photo was the proof", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: FAR, hasPhoto: true })).toEqual({
      ok: true,
      detectiveIds: ["d1"],
      proof: "photo",
    });
  });

  it("prefers the location when both are given and the phone is near", () => {
    const got = decideStamp(ctx, { detectiveIds: ["d1"], location: HERE, hasPhoto: true });
    expect(got).toEqual({ ok: true, detectiveIds: ["d1"], proof: "location" });
  });

  it("only stamps the detectives who do not have this stamp yet, each once", () => {
    const got = decideStamp(
      { ...ctx, alreadyStamped: ["d1"] },
      { detectiveIds: ["d1", "d2", "d2"], location: HERE, hasPhoto: false },
    );
    expect(got).toEqual({ ok: true, detectiveIds: ["d2"], proof: "location" });
  });

  it("uses the distance staff have set", () => {
    const tight = decideStamp({ ...ctx, radiusMetres: 20 }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false });
    expect(tight).toEqual({ ok: false, reason: "too-far" });
  });
});

describe("not earning a stamp", () => {
  it("refuses until the door is open", () => {
    expect(decideStamp({ ...ctx, doorState: "hunting" }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "door-not-open",
    });
    expect(decideStamp({ ...ctx, doorState: "shut" }, { detectiveIds: ["d1"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "door-not-open",
    });
  });

  it("refuses with no detective chosen", () => {
    expect(decideStamp(ctx, { detectiveIds: [], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "no-detectives",
    });
  });

  it("refuses a detective from another family", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d9"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "not-your-detective",
    });
  });

  it("says so when everyone chosen already has this stamp", () => {
    expect(decideStamp({ ...ctx, alreadyStamped: ["d1", "d2"] }, { detectiveIds: ["d1", "d2"], location: HERE, hasPhoto: false })).toEqual({
      ok: false,
      reason: "nothing-new",
    });
  });

  it("refuses a phone that is too far away with no photo", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: FAR, hasPhoto: false })).toEqual({
      ok: false,
      reason: "too-far",
    });
  });

  it("refuses with neither a location nor a photo", () => {
    expect(decideStamp(ctx, { detectiveIds: ["d1"], location: null, hasPhoto: false })).toEqual({
      ok: false,
      reason: "no-proof",
    });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-stamps.test.ts`
Expected: FAIL, cannot find module `../../src/elf/stamps`.

- [ ] **Step 3: Write the implementation**

```ts
import { isOpen, type DoorState } from "./doors";
import { NEAR_METRES, isNear, type LatLng } from "./distance";

// NBCC Elf Detective School: earning a candy cane stamp for visiting a hiding place. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Once a door is open, any detective who visits the place earns its stamp, any day until Christmas
// Eve. Stamps lead to graduation and to the grand prize, so a visit needs proof: the phone being
// near the place, or a photo taken there for anyone who would rather not share their location.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-stamps.test.ts.

export type StampRefusal = "door-not-open" | "no-detectives" | "not-your-detective" | "nothing-new" | "too-far" | "no-proof";

export type StampDecision =
  | { ok: true; detectiveIds: string[]; proof: "location" | "photo" }
  | { ok: false; reason: StampRefusal };

export interface StampContext {
  /** The state of the door for this place. */
  doorState: DoorState;
  /** Where the place is. */
  place: LatLng;
  /** Every detective in the visiting family. */
  familyDetectiveIds: readonly string[];
  /** The family's detectives who already have this stamp. */
  alreadyStamped: readonly string[];
  /** How close counts, when staff have changed it. */
  radiusMetres?: number;
}

export interface StampAttempt {
  /** The detectives who are there. */
  detectiveIds: readonly string[];
  /** The phone's position if it was shared, checked here and never kept. */
  location: (LatLng & { accuracyMetres?: number }) | null;
  /** Was a photo taken at the place sent with it? */
  hasPhoto: boolean;
}

/** Does this visit earn stamps, for whom, and on what proof? A near phone is preferred to a photo. */
export function decideStamp(ctx: StampContext, attempt: StampAttempt): StampDecision {
  if (!isOpen(ctx.doorState)) return { ok: false, reason: "door-not-open" };
  if (attempt.detectiveIds.length === 0) return { ok: false, reason: "no-detectives" };
  if (!attempt.detectiveIds.every((id) => ctx.familyDetectiveIds.includes(id))) {
    return { ok: false, reason: "not-your-detective" };
  }
  const fresh = [...new Set(attempt.detectiveIds)].filter((id) => !ctx.alreadyStamped.includes(id));
  if (fresh.length === 0) return { ok: false, reason: "nothing-new" };
  if (attempt.location && isNear(ctx.place, attempt.location, ctx.radiusMetres ?? NEAR_METRES)) {
    return { ok: true, detectiveIds: fresh, proof: "location" };
  }
  if (attempt.hasPhoto) return { ok: true, detectiveIds: fresh, proof: "photo" };
  return { ok: false, reason: attempt.location ? "too-far" : "no-proof" };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-stamps.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/stamps.ts test/unit/elf-stamps.test.ts
git commit -m "Elf Detective School: stamps for visiting"
```

---

### Task 7: Progress and ranks

**Files:**
- Create: `src/elf/progress.ts`
- Test: `test/unit/elf-progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { RANKS, progressOf, promotionsBetween, rankAt } from "../../src/elf/progress";

// NBCC Elf Detective School: how far a detective has got. Pure, so every threshold is checked here.

const doors = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("doors done", () => {
  it("starts a new detective as a Trainee with six doors to the first promotion", () => {
    expect(progressOf([], [])).toEqual({
      doorsDone: 0,
      cracked: 0,
      visited: 0,
      rank: "Trainee",
      graduate: false,
      goldSeal: false,
      next: { rank: "Junior Detective", at: 6, toGo: 6 },
    });
  });

  it("counts a door once whether it was cracked, visited or both", () => {
    const p = progressOf([1, 2, 3], [3, 4]);
    expect(p.doorsDone).toBe(4);
    expect(p.cracked).toBe(3);
    expect(p.visited).toBe(2);
  });

  it("ignores repeats and anything that is not a door", () => {
    const p = progressOf([1, 1, 0, 25, 2.5], [1, 99]);
    expect(p.doorsDone).toBe(1);
    expect(p.cracked).toBe(1);
    expect(p.visited).toBe(1);
  });
});

describe("ranks", () => {
  it("promotes at 6, 12, 18 and 24 doors", () => {
    expect(RANKS.map((r) => [r.rank, r.at])).toEqual([
      ["Trainee", 0],
      ["Junior Detective", 6],
      ["Detective", 12],
      ["Senior Detective", 18],
      ["Graduate", 24],
    ]);
    expect(rankAt(5)).toBe("Trainee");
    expect(rankAt(6)).toBe("Junior Detective");
    expect(rankAt(11)).toBe("Junior Detective");
    expect(rankAt(12)).toBe("Detective");
    expect(rankAt(18)).toBe("Senior Detective");
    expect(rankAt(23)).toBe("Senior Detective");
    expect(rankAt(24)).toBe("Graduate");
  });

  it("says what comes next and how many doors away it is", () => {
    expect(progressOf(doors(1, 7), []).next).toEqual({ rank: "Detective", at: 12, toGo: 5 });
    expect(progressOf(doors(1, 24), []).next).toBeNull();
  });
});

describe("the two finishes", () => {
  it("graduates a detective with all 24 doors done, cracked or visited", () => {
    const p = progressOf(doors(1, 20), doors(18, 24));
    expect(p.doorsDone).toBe(24);
    expect(p.graduate).toBe(true);
    expect(p.rank).toBe("Graduate");
    expect(p.goldSeal).toBe(false);
  });

  it("gives the gold seal only for visiting all 24 places", () => {
    expect(progressOf(doors(1, 24), doors(1, 23)).goldSeal).toBe(false);
    expect(progressOf([], doors(1, 24)).goldSeal).toBe(true);
    expect(progressOf([], doors(1, 24)).graduate).toBe(true);
  });

  it("does not graduate at 23", () => {
    const p = progressOf(doors(1, 23), []);
    expect(p.graduate).toBe(false);
    expect(p.rank).toBe("Senior Detective");
  });
});

describe("promotions between two counts", () => {
  it("lists each rank newly reached, in order", () => {
    expect(promotionsBetween(5, 6)).toEqual(["Junior Detective"]);
    expect(promotionsBetween(5, 13)).toEqual(["Junior Detective", "Detective"]);
    expect(promotionsBetween(0, 24)).toEqual(["Junior Detective", "Detective", "Senior Detective", "Graduate"]);
  });

  it("lists nothing when no threshold is crossed", () => {
    expect(promotionsBetween(6, 6)).toEqual([]);
    expect(promotionsBetween(6, 11)).toEqual([]);
    expect(promotionsBetween(12, 7)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-progress.test.ts`
Expected: FAIL, cannot find module `../../src/elf/progress`.

- [ ] **Step 3: Write the implementation**

```ts
import { DOOR_COUNT, isDoor } from "./calendar";

// NBCC Elf Detective School: how far a detective has got. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 8).
//
// The hiding places are spread across the whole area, so only very keen families will visit all 24.
// A door therefore counts when it is cracked OR visited, and promotions come along the way, so every
// child has something to aim for. Two finishes: Graduate for all 24 doors done either way, and the
// gold seal for visiting all 24 places, which is what leads to the grand prize.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-progress.test.ts.

export const RANKS = [
  { rank: "Trainee", at: 0 },
  { rank: "Junior Detective", at: 6 },
  { rank: "Detective", at: 12 },
  { rank: "Senior Detective", at: 18 },
  { rank: "Graduate", at: 24 },
] as const;

export type Rank = (typeof RANKS)[number]["rank"];

export interface Progress {
  /** Doors cracked or visited, each counted once. */
  doorsDone: number;
  cracked: number;
  visited: number;
  rank: Rank;
  /** All 24 doors done, either way. */
  graduate: boolean;
  /** All 24 places visited. */
  goldSeal: boolean;
  /** The next promotion and how many doors away it is, or null for a Graduate. */
  next: { rank: Rank; at: number; toGo: number } | null;
}

const doorSet = (doors: readonly number[]): Set<number> => new Set(doors.filter(isDoor));

/** The rank a number of doors done has earned. */
export function rankAt(doorsDone: number): Rank {
  let rank: Rank = RANKS[0].rank;
  for (const r of RANKS) {
    if (doorsDone >= r.at) rank = r.rank;
  }
  return rank;
}

/** Everything about a detective's progress, from the doors they have cracked and the doors they have visited. */
export function progressOf(crackedDoors: readonly number[], visitedDoors: readonly number[]): Progress {
  const cracked = doorSet(crackedDoors);
  const visited = doorSet(visitedDoors);
  const doorsDone = new Set([...cracked, ...visited]).size;
  const upcoming = RANKS.find((r) => r.at > doorsDone) ?? null;
  return {
    doorsDone,
    cracked: cracked.size,
    visited: visited.size,
    rank: rankAt(doorsDone),
    graduate: doorsDone >= DOOR_COUNT,
    goldSeal: visited.size >= DOOR_COUNT,
    next: upcoming ? { rank: upcoming.rank, at: upcoming.at, toGo: upcoming.at - doorsDone } : null,
  };
}

/** The ranks newly reached going from one count of doors done to another, in order. */
export function promotionsBetween(before: number, after: number): Rank[] {
  return RANKS.filter((r) => r.at > before && r.at <= after).map((r) => r.rank);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-progress.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/progress.ts test/unit/elf-progress.test.ts
git commit -m "Elf Detective School: progress, ranks and the two finishes"
```

---

### Task 8: Names

**Files:**
- Create: `src/elf/names.ts`
- Test: `test/unit/elf-names.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  ELF_NAMES,
  FESTIVE_SURNAMES,
  SECRET_WORD_IDEAS,
  cleanFirstName,
  detectiveName,
  detectiveNames,
  isFestiveSurname,
} from "../../src/elf/names";
import { normaliseWord } from "../../src/elf/claim";
import { containsBlockedWord } from "../../src/donors/display-name-filter";

// NBCC Elf Detective School: the names children appear by. Every first name here is invented.

describe("the festive surnames a detective picks from", () => {
  it("offers plenty, each a single word of letters, with no repeats", () => {
    expect(FESTIVE_SURNAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FESTIVE_SURNAMES).size).toBe(FESTIVE_SURNAMES.length);
    for (const s of FESTIVE_SURNAMES) expect(s).toMatch(/^[A-Z][a-z]+$/);
  });

  it("offers nothing the public name filter would refuse", () => {
    expect(FESTIVE_SURNAMES.filter((s) => containsBlockedWord(s))).toEqual([]);
  });

  it("knows its own list", () => {
    expect(isFestiveSurname("Tinselfoot")).toBe(true);
    expect(isFestiveSurname("tinselfoot")).toBe(false);
    expect(isFestiveSurname("Smith")).toBe(false);
  });
});

describe("the elves", () => {
  it("has a different name for each of the 24 doors", () => {
    expect(ELF_NAMES.length).toBe(24);
    expect(new Set(ELF_NAMES).size).toBe(24);
    for (const n of ELF_NAMES) expect(n).toMatch(/^[A-Z][a-z]+$/);
    expect(ELF_NAMES.filter((n) => containsBlockedWord(n))).toEqual([]);
  });
});

describe("secret word ideas", () => {
  it("offers at least one for every door, each a single word in capitals that survives typing", () => {
    expect(SECRET_WORD_IDEAS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(SECRET_WORD_IDEAS).size).toBe(SECRET_WORD_IDEAS.length);
    for (const w of SECRET_WORD_IDEAS) {
      expect(w).toMatch(/^[A-Z]{4,11}$/);
      expect(normaliseWord(w)).toBe(w.toLowerCase());
    }
  });
});

describe("a detective's first name", () => {
  it("tidies the spaces round and inside it", () => {
    expect(cleanFirstName("  Ruby ")).toEqual({ ok: true, name: "Ruby" });
    expect(cleanFirstName("Mary   Kate")).toEqual({ ok: true, name: "Mary Kate" });
  });

  it("takes accents, hyphens and apostrophes", () => {
    expect(cleanFirstName("Zoë")).toEqual({ ok: true, name: "Zoë" });
    expect(cleanFirstName("Lily-Mae")).toEqual({ ok: true, name: "Lily-Mae" });
    expect(cleanFirstName("D'Arcy")).toEqual({ ok: true, name: "D'Arcy" });
  });

  it("refuses nothing at all", () => {
    expect(cleanFirstName("")).toEqual({ ok: false, reason: "empty" });
    expect(cleanFirstName("   ")).toEqual({ ok: false, reason: "empty" });
    expect(cleanFirstName(undefined)).toEqual({ ok: false, reason: "empty" });
    expect(cleanFirstName(42)).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses more than 20 characters", () => {
    expect(cleanFirstName("A".repeat(20))).toEqual({ ok: true, name: "A".repeat(20) });
    expect(cleanFirstName("A".repeat(21))).toEqual({ ok: false, reason: "too-long" });
  });

  it("refuses digits, symbols, and a name that does not start with a letter", () => {
    expect(cleanFirstName("Ruby7")).toEqual({ ok: false, reason: "letters-only" });
    expect(cleanFirstName("Ruby <3")).toEqual({ ok: false, reason: "letters-only" });
    expect(cleanFirstName("-Ruby")).toEqual({ ok: false, reason: "letters-only" });
  });

  it("refuses a word the public name filter blocks", () => {
    expect(cleanFirstName("Bollocks")).toEqual({ ok: false, reason: "blocked" });
  });
});

describe("how a detective appears", () => {
  it("is Detective, the first name, then the festive surname", () => {
    expect(detectiveName("Ruby", "Tinselfoot")).toBe("Detective Ruby Tinselfoot");
  });

  it("joins a family's detectives into one line", () => {
    const ruby = { firstName: "Ruby", surname: "Tinselfoot" };
    const sam = { firstName: "Sam", surname: "Snowsleuth" };
    const mia = { firstName: "Mia", surname: "Gingersnap" };
    expect(detectiveNames([ruby])).toBe("Detective Ruby Tinselfoot");
    expect(detectiveNames([ruby, sam])).toBe("Detectives Ruby Tinselfoot and Sam Snowsleuth");
    expect(detectiveNames([ruby, sam, mia])).toBe("Detectives Ruby Tinselfoot, Sam Snowsleuth and Mia Gingersnap");
    expect(detectiveNames([])).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-names.test.ts`
Expected: FAIL, cannot find module `../../src/elf/names`.

- [ ] **Step 3: Write the implementation**

```ts
import { containsBlockedWord } from "../donors/display-name-filter";

// NBCC Elf Detective School: the names children appear by. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 11).
//
// A child is shown on the public calendar only as a detective name: their first name plus a festive
// surname they pick from this list. Never a real surname, a school or an age. The surname comes from
// a fixed list so nothing typed by a member of the public is shown except a checked first name.
//
// Also here: a name for each day's elf, and ideas for the secret word on each elf's tag, so staff
// have something to start from.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-names.test.ts.

export const FESTIVE_SURNAMES = [
  "Tinselfoot",
  "Snowsleuth",
  "Jinglesnoop",
  "Frostwhistle",
  "Sparkleboots",
  "Hollyhunt",
  "Gingersnap",
  "Twinkletoes",
  "Berrybright",
  "Candycane",
  "Puddingpaws",
  "Bellringer",
  "Snowdrift",
  "Starcatcher",
  "Cocoacup",
  "Sleighbell",
  "Merrymittens",
  "Snugglescarf",
  "Glitterglove",
  "Peppermint",
  "Sugarplum",
  "Ivywink",
  "Wintersleuth",
  "Cluefinder",
  "Frostyprint",
  "Lanternlight",
  "Tartantrail",
  "Thistledown",
  "Robinwatch",
  "Shortbread",
  "Snowpaw",
  "Baublespy",
  "Crackerjack",
  "Marzipan",
  "Nutmegnose",
  "Icicletrail",
  "Stockingspy",
  "Garlandgaze",
  "Hushfoot",
  "Ribboncurl",
] as const;

/** One name for each day's elf, door 1 first. */
export const ELF_NAMES = [
  "Twinkle",
  "Jingle",
  "Tinsel",
  "Pudding",
  "Sprout",
  "Holly",
  "Bauble",
  "Cracker",
  "Snowdrop",
  "Pip",
  "Nutmeg",
  "Cocoa",
  "Glitter",
  "Fizz",
  "Bramble",
  "Biscuit",
  "Sparkle",
  "Pickle",
  "Muddle",
  "Tumble",
  "Wobble",
  "Giggle",
  "Fidget",
  "Mischief",
] as const;

/** Ideas for the word on an elf's tag: easy for a child to read, spell and type. */
export const SECRET_WORD_IDEAS = [
  "SNOWBALL",
  "TINSEL",
  "JINGLE",
  "COCOA",
  "MITTENS",
  "SLEIGH",
  "REINDEER",
  "STOCKING",
  "BAUBLE",
  "CRACKER",
  "GINGERBREAD",
  "SNOWFLAKE",
  "CHIMNEY",
  "LANTERN",
  "PUDDING",
  "CAROL",
  "ICICLE",
  "MARZIPAN",
  "SHORTBREAD",
  "HOLLY",
  "ROBIN",
  "SNOWMAN",
  "PRESENT",
  "RIBBON",
  "CANDLE",
  "BELLS",
  "ANGEL",
  "TOFFEE",
  "CINNAMON",
  "PENGUIN",
] as const;

export type FirstNameRefusal = "empty" | "too-long" | "letters-only" | "blocked";
export type FirstNameResult = { ok: true; name: string } | { ok: false; reason: FirstNameRefusal };

const FIRST_NAME_MAX = 20;
// Starts with a letter; then letters, spaces, hyphens and apostrophes. Letters in any alphabet.
const FIRST_NAME = /^\p{L}[\p{L}' -]*$/u;

/** A first name as it will be shown: trimmed, single spaces, at most 20 characters, letters only, not blocked. */
export function cleanFirstName(input: unknown): FirstNameResult {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (name === "") return { ok: false, reason: "empty" };
  if ([...name].length > FIRST_NAME_MAX) return { ok: false, reason: "too-long" };
  if (!FIRST_NAME.test(name)) return { ok: false, reason: "letters-only" };
  if (containsBlockedWord(name)) return { ok: false, reason: "blocked" };
  return { ok: true, name };
}

/** Is this one of the festive surnames, exactly as listed? */
export function isFestiveSurname(surname: string): boolean {
  return (FESTIVE_SURNAMES as readonly string[]).includes(surname);
}

/** How one detective appears in public: "Detective Ruby Tinselfoot". */
export function detectiveName(firstName: string, surname: string): string {
  return `Detective ${firstName} ${surname}`;
}

/** How a family's detectives appear together: "Detectives Ruby Tinselfoot and Sam Snowsleuth". */
export function detectiveNames(detectives: readonly { firstName: string; surname: string }[]): string {
  const names = detectives.map((d) => `${d.firstName} ${d.surname}`);
  if (names.length === 0) return "";
  if (names.length === 1) return `Detective ${names[0]}`;
  return `Detectives ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-names.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/names.ts test/unit/elf-names.test.ts
git commit -m "Elf Detective School: detective names, elf names and secret word ideas"
```

---

### Task 9: The approved facts

**Files:**
- Create: `src/elf/facts.ts`
- Test: `test/unit/elf-facts.test.ts`

The wording below is exactly what Jaimie approved on 4 October 2026, with two house style fixes the
site's own tests demand: the building is written `Elves' Workshop`, and no word is hyphenated.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FACTS, factFor } from "../../src/elf/facts";

// NBCC Elf Detective School: the 24 facts Jaimie approved on 4 October 2026, one for each door, with
// a short line for children. These tests hold the house style, not the wording itself.

describe("the 24 facts", () => {
  it("has one for each door, in order", () => {
    expect(FACTS.map((f) => f.door)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("gives every fact a title, a fact for the grown up's email and a line for the door", () => {
    for (const f of FACTS) {
      expect(f.title.trim(), `door ${f.door} title`).not.toBe("");
      expect(f.grownUp.trim(), `door ${f.door} fact`).not.toBe("");
      expect(f.doorLine.trim(), `door ${f.door} door line`).not.toBe("");
    }
  });

  it("keeps the door line short enough to sit on a door", () => {
    for (const f of FACTS) expect(f.doorLine.length, `door ${f.door}`).toBeLessThanOrEqual(80);
  });

  it("keeps the email fact to a few sentences", () => {
    for (const f of FACTS) expect(f.grownUp.length, `door ${f.door}`).toBeLessThanOrEqual(320);
  });

  it("uses no dashes, and no hyphen between words", () => {
    for (const f of FACTS) {
      const text = `${f.title} ${f.grownUp} ${f.doorLine}`;
      expect(text, `door ${f.door}`).not.toMatch(/[–—]/);
      expect(text, `door ${f.door}`).not.toMatch(/[A-Za-z0-9]-[A-Za-z0-9]/);
    }
  });

  it("writes the building one way", () => {
    const all = FACTS.map((f) => `${f.title} ${f.grownUp} ${f.doorLine}`).join(" ");
    const spellings = all.match(/\bel(?:f|ve)[^\s<>]{0,12}\s+workshop/gi) ?? [];
    expect(spellings.length).toBeGreaterThan(0);
    expect(spellings.filter((s) => s !== "Elves' Workshop")).toEqual([]);
  });
});

describe("looking a fact up", () => {
  it("finds the fact for a door", () => {
    expect(factFor(7)?.title).toBe("7,657 Red Bags");
    expect(factFor(24)?.title).toBe("The Night Before Christmas");
  });

  it("has nothing for a number that is not a door", () => {
    expect(factFor(0)).toBeNull();
    expect(factFor(25)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-facts.test.ts`
Expected: FAIL, cannot find module `../../src/elf/facts`.

- [ ] **Step 3: Write the implementation**

```ts
// NBCC Elf Detective School: the 24 facts about NBCC, one for each door. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 17).
//
// The daily email goes to the grown up, so it is the best place to tell families who have never
// heard of NBCC who we are. The facts tell a four week story: who NBCC is, who we help and where,
// behind the scenes, and how to help. Each has a short, fun line for children that sits on the door.
//
// Jaimie approved every word on 4 October 2026, a week at a time, and confirmed the founding details
// (2015, Tygan aged twelve, 90 boxes, 593 bags). Every number comes from the public About us, home
// and donate pages. Change the wording only with Jaimie's yes.
//
// Pure data. Unit tested in test/unit/elf-facts.test.ts, which holds the house style: no dashes, no
// hyphenated words, and the building written one way.

export interface ElfFact {
  /** The door this fact belongs to, 1 to 24. */
  door: number;
  /** A short heading. */
  title: string;
  /** The fact as the grown up reads it in the daily email. */
  grownUp: string;
  /** The short line for children, shown on the door once it opens. */
  doorLine: string;
}

export const FACTS: readonly ElfFact[] = [
  // Week 1: who NBCC is.
  {
    door: 1,
    title: "It started with a question",
    grownUp:
      'In 2015 Tygan, aged twelve, from Annbank asked her mum Jodie and her gran: "Do all children get a Christmas Eve box like I do?" The three of them set out to change that, and the Night Before Christmas Campaign was born.',
    doorLine: "NBCC began with a question from a girl aged 12 in Annbank.",
  },
  {
    door: 2,
    title: "90 boxes",
    grownUp: "In their very first year, Tygan, her mum and her gran delivered 90 boxes filled with love and gifts.",
    doorLine: "In its first year, NBCC delivered 90 boxes of Christmas joy.",
  },
  {
    door: 3,
    title: "Doing more",
    grownUp:
      "Seeing people sleeping rough on a cold morning in Glasgow pushed the family to do more, and to register NBCC as a charity.",
    doorLine: "NBCC became a proper charity so it could help even more people.",
  },
  {
    door: 4,
    title: "All volunteers",
    grownUp:
      "Every one of us at NBCC is a volunteer. Your money goes on thoughtful gifts and essential support, not salaries.",
    doorLine: "Every NBCC elf is a volunteer. They help because they love it.",
  },
  {
    door: 5,
    title: "A real Head Elf",
    grownUp:
      "NBCC really does have a Head Elf: Jodie, Tygan's mum, who is also one of the charity's trustees. The volunteers are known as the NBCC elves.",
    doorLine: "NBCC has a real Head Elf. Her name is Jodie!",
  },
  {
    door: 6,
    title: "Growing every year",
    grownUp: "From 593 bags to more than 7,000, the campaign has grown every year, and so has the need.",
    doorLine: "NBCC went from 593 bags to more than 7,000. That's a lot of bags!",
  },
  // Week 2: who NBCC helps, and where.
  {
    door: 7,
    title: "7,657 Red Bags",
    grownUp:
      "In 2025, 7,657 Red Bags Full of Joy went out across South West Scotland. Every one went to a real person who knew they had not been forgotten.",
    doorLine: "Last Christmas, NBCC's elves sent out 7,657 Red Bags Full of Joy!",
  },
  {
    door: 8,
    title: "From babies to grown ups",
    grownUp: "NBCC's Red Bags reach every age. In 2025, 182 went to babies under one, and 528 to adults over 18.",
    doorLine: "Red Bags go to everyone, from tiny babies to grown ups.",
  },
  {
    door: 9,
    title: "The biggest group",
    grownUp:
      "Children aged 8 to 11 were the biggest group NBCC reached in 2025, with 1,990 Red Bags. Next came 4 to 7 year olds, with 1,663.",
    doorLine: "Last year, 1,990 children aged 8 to 11 got a Red Bag.",
  },
  {
    door: 10,
    title: "Teenagers too",
    grownUp:
      "Teenagers are never forgotten. In 2025, 1,719 Red Bags went to 12 to 15 year olds, and 587 to 16 and 17 year olds.",
    doorLine: "Teenagers get Red Bags too!",
  },
  {
    door: 11,
    title: "Girvan to Largs",
    grownUp:
      "NBCC helps children, young people and vulnerable adults across South West Scotland, from Girvan to Largs.",
    doorLine: "NBCC's elves spread joy from Girvan all the way to Largs.",
  },
  {
    door: 12,
    title: "Top communities",
    grownUp:
      "Ayr received the most Red Bags in 2025, 2,096 of them, followed by Kilwinning with 692 and Stevenston with 547.",
    doorLine: "Ayr got the most Red Bags last year: 2,096!",
  },
  {
    door: 13,
    title: "Here all year",
    grownUp:
      "You know us at Christmas. We're here all year. NBCC helps whenever the need comes, with support after a house fire, clothing and school supplies, or a hand at rock bottom.",
    doorLine: "NBCC's elves help all year round, not just at Christmas.",
  },
  // Week 3: behind the scenes.
  {
    door: 14,
    title: "The Elves' Workshop is real",
    grownUp:
      "NBCC's home is the Elves' Workshop at Annbank Village Hall, where volunteers hand over Red Bags Full of Joy by the Christmas tree.",
    doorLine: "The Elves' Workshop is real. It's in Annbank Village Hall!",
  },
  {
    door: 15,
    title: "Made for one person",
    grownUp:
      "Red Bags Full of Joy are NBCC's signature programme: thoughtful, personalised gifts that bring dignity, comfort and moments of joy to people who might otherwise go without at Christmas.",
    doorLine: "Every Red Bag is packed for one special person.",
  },
  {
    door: 16,
    title: "Freddie's dinosaurs",
    grownUp:
      "When NBCC's volunteers heard Freddie loved dinosaurs and monster trucks, they hunted everywhere until his Red Bag was packed full of them. His dad said it gave him a reason to keep going.",
    doorLine: "One boy loved dinosaurs, so the elves filled his bag with them!",
  },
  {
    door: 17,
    title: "Around £50",
    grownUp: "Each Red Bag Full of Joy gives support around the value of £50.",
    doorLine: "Each Red Bag holds about £50 of Christmas joy.",
  },
  {
    door: 18,
    title: "The elves' jobs",
    grownUp:
      "Behind every bag is a team of volunteers with real jobs: a Head Elf, procurement, finance, a project manager and marketing, plus a whole list of volunteer elves.",
    doorLine: "Even elves have jobs, from finding gifts to counting the pennies.",
  },
  {
    door: 19,
    title: "Not forgotten",
    grownUp: "Every pound helps remind someone that they have not been forgotten.",
    doorLine: "Every Red Bag says: you have not been forgotten.",
  },
  {
    door: 20,
    title: "A real person",
    grownUp: "Whether you call or email, you'll reach a real person at NBCC, never a call centre.",
    doorLine: "Phone NBCC and a real elf answers!",
  },
  // Week 4: how you can help.
  {
    door: 21,
    title: "Turn £1 into £1.25",
    grownUp:
      "If you're a UK taxpayer, NBCC can turn every £1 you give into £1.25 on eligible donations, at no cost to you. It's called Gift Aid.",
    doorLine: "Grown ups who pay tax can turn £1 into £1.25 for NBCC!",
  },
  {
    door: 22,
    title: "A little every month",
    grownUp:
      "Monthly gifts help NBCC all year round. £25 a month is halfway to a Red Bag Full of Joy, and £50 a month is one Christmas made brighter.",
    doorLine: "Some grown ups give a little every month to fill Red Bags.",
  },
  {
    door: 23,
    title: "Raise money your way",
    grownUp:
      "Raise money your way, and we will help. Hold a bake sale, take on a challenge or run an event, and NBCC can send posters, leaflets, collection buckets and the rest.",
    doorLine: "You could hold a bake sale for NBCC!",
  },
  {
    door: 24,
    title: "The Night Before Christmas",
    grownUp:
      "Tonight is the Night Before Christmas. It all began with a Christmas Eve box and a question from a girl aged twelve. Thank you for helping NBCC make sure nobody feels forgotten. You know us at Christmas. We're here all year.",
    doorLine: "It's the Night Before Christmas! Thank you, Detective.",
  },
];

/** The fact for a door, or null if the number is not a door. */
export function factFor(door: number): ElfFact | null {
  return FACTS.find((f) => f.door === door) ?? null;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-facts.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/facts.ts test/unit/elf-facts.test.ts
git commit -m "Elf Detective School: the 24 approved facts"
```

---

### Task 10: The planning map

**Files:**
- Create: `src/elf/map.ts`
- Test: `test/unit/elf-map.test.ts`

The About us map (`about.html`, `<svg class="map" viewBox="0 0 499 456">`) has no projection in the
repo. Its eleven town circles fit one exactly: equirectangular from 55.860 N, 5.460 W, at 625 pixels
per degree of latitude and 353.8 per degree of longitude. The test pins all eleven so the fit cannot
drift.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GAP_MILES, MAP, farFromAll, fromMap, milesBetween, milesToPx, onMap, toMap } from "../../src/elf/map";

// NBCC Elf Detective School: the planning map. The towns below are the eleven marked on the public
// About us map, with the circle centres copied from about.html, so the projection is pinned to the
// drawing staff already know.

const TOWNS = [
  { name: "Largs", lat: 55.795, lng: -4.87, x: 208.8, y: 40.6 },
  { name: "Ayr", lat: 55.458, lng: -4.629, x: 294.0, y: 251.3 },
  { name: "Kilwinning", lat: 55.655, lng: -4.703, x: 267.8, y: 128.1 },
  { name: "Stevenston", lat: 55.645, lng: -4.758, x: 248.4, y: 134.4 },
  { name: "Kilmarnock", lat: 55.611, lng: -4.495, x: 341.4, y: 155.6 },
  { name: "Auchinleck", lat: 55.47, lng: -4.295, x: 412.2, y: 243.8 },
  { name: "Maybole", lat: 55.356, lng: -4.68, x: 276.0, y: 315.0 },
  { name: "Dalmellington", lat: 55.324, lng: -4.406, x: 372.9, y: 335.0 },
  { name: "Ardrossan", lat: 55.642, lng: -4.809, x: 230.3, y: 136.2 },
  { name: "Irvine", lat: 55.612, lng: -4.669, x: 279.9, y: 155.0 },
  { name: "Girvan", lat: 55.241, lng: -4.859, x: 212.6, y: 386.9 },
];
const town = (name: string) => TOWNS.find((t) => t.name === name)!;

describe("the About us map's projection", () => {
  it("matches the map's own size", () => {
    const html = readFileSync(resolve(__dirname, "../../about.html"), "utf8");
    expect(html).toContain(`viewBox="0 0 ${MAP.width} ${MAP.height}"`);
  });

  it("puts each of the eleven towns where the map draws it", () => {
    for (const t of TOWNS) {
      const p = toMap(t);
      expect(p.x, `${t.name} x`).toBeCloseTo(t.x, 0);
      expect(p.y, `${t.name} y`).toBeCloseTo(t.y, 0);
      expect(Math.abs(p.x - t.x), `${t.name} x`).toBeLessThan(0.3);
      expect(Math.abs(p.y - t.y), `${t.name} y`).toBeLessThan(0.3);
    }
  });

  it("still finds those circles in about.html", () => {
    const html = readFileSync(resolve(__dirname, "../../about.html"), "utf8");
    for (const t of TOWNS) expect(html, t.name).toContain(`cx="${t.x.toFixed(1)}" cy="${t.y.toFixed(1)}"`);
  });

  it("turns a point on the map back into a position", () => {
    for (const t of TOWNS) {
      const back = fromMap(toMap(t).x, toMap(t).y);
      expect(back.lat).toBeCloseTo(t.lat, 6);
      expect(back.lng).toBeCloseTo(t.lng, 6);
    }
  });

  it("knows what is on the map and what is off it", () => {
    expect(onMap(town("Ayr"))).toBe(true);
    expect(onMap({ lat: 55.95, lng: -3.19 })).toBe(false); // far to the east
    expect(onMap({ lat: 57.5, lng: -4.6 })).toBe(false); // far to the north
  });
});

describe("miles", () => {
  it("measures the miles between two places", () => {
    expect(milesBetween(town("Ayr"), town("Kilmarnock"))).toBeCloseTo(11.8, 0);
    expect(milesBetween(town("Ayr"), town("Ayr"))).toBe(0);
  });

  it("draws ten miles as about ninety pixels", () => {
    expect(milesToPx(10)).toBeCloseTo(90.5, 0);
    expect(milesToPx(0)).toBe(0);
  });
});

describe("the gaps staff need to see", () => {
  it("flags anywhere more than ten miles from every hiding place", () => {
    expect(GAP_MILES).toBe(10);
    expect(farFromAll(town("Girvan"), [town("Ayr")])).toBe(true);
    expect(farFromAll(town("Maybole"), [town("Ayr")])).toBe(false);
  });

  it("is covered by any one place close enough", () => {
    expect(farFromAll(town("Girvan"), [town("Ayr"), town("Maybole")])).toBe(true);
    expect(farFromAll(town("Girvan"), [town("Ayr"), town("Girvan")])).toBe(false);
  });

  it("flags everywhere when there are no hiding places yet", () => {
    expect(farFromAll(town("Ayr"), [])).toBe(true);
  });

  it("uses the distance staff choose", () => {
    expect(farFromAll(town("Maybole"), [town("Ayr")], 5)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run test/unit/elf-map.test.ts`
Expected: FAIL, cannot find module `../../src/elf/map`.

- [ ] **Step 3: Write the implementation**

```ts
import { metresBetween, type LatLng } from "./distance";

// NBCC Elf Detective School: the planning map. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 19).
//
// While staff sign up businesses they need to see where the hiding places are and where the gaps
// are, on the map they already know: the one on the About us page. That drawing came with no
// projection, but its eleven town circles fit one exactly, so a hiding place can be pinned from its
// position, and a click on the map can be turned back into a position.
//
// The gap staff asked to see: anywhere more than about ten miles from every hiding place.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-map.test.ts, which pins all
// eleven towns to the circles in about.html.

/** The About us map: its size, the position of its top left corner, and its scale in pixels per degree. */
export const MAP = { width: 499, height: 456, lat0: 55.86, lng0: -5.46, pxPerLat: 625, pxPerLng: 353.8 } as const;

const METRES_PER_MILE = 1609.344;
/** One degree of latitude over the ground, on the sphere src/elf/distance.ts uses. */
const METRES_PER_DEGREE_LAT = 111_194.93;

/** How far from every hiding place counts as a gap. */
export const GAP_MILES = 10;

/** Where a position falls on the map, in the map's own pixels. */
export function toMap(p: LatLng): { x: number; y: number } {
  return { x: (p.lng - MAP.lng0) * MAP.pxPerLng, y: (MAP.lat0 - p.lat) * MAP.pxPerLat };
}

/** The position under a point on the map: what a click becomes. */
export function fromMap(x: number, y: number): LatLng {
  return { lat: MAP.lat0 - y / MAP.pxPerLat, lng: MAP.lng0 + x / MAP.pxPerLng };
}

/** Does this position fall inside the drawing? */
export function onMap(p: LatLng): boolean {
  const { x, y } = toMap(p);
  return x >= 0 && x <= MAP.width && y >= 0 && y <= MAP.height;
}

/** The miles between two positions, over the ground. */
export function milesBetween(a: LatLng, b: LatLng): number {
  return metresBetween(a, b) / METRES_PER_MILE;
}

/** How many of the map's pixels a distance in miles covers. */
export function milesToPx(miles: number): number {
  return (miles * METRES_PER_MILE * MAP.pxPerLat) / METRES_PER_DEGREE_LAT;
}

/** Is this position more than `miles` from every hiding place? True everywhere when there are none. */
export function farFromAll(point: LatLng, places: readonly LatLng[], miles: number = GAP_MILES): boolean {
  return places.every((place) => milesBetween(point, place) > miles);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run test/unit/elf-map.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/elf/map.ts test/unit/elf-map.test.ts
git commit -m "Elf Detective School: the planning map's projection and gaps"
```

---

### Task 11: Check the whole thing

**Files:** none changed unless a check fails.

- [ ] **Step 1: Run every elf test together**

Run: `npx vitest run test/unit/elf-`
Expected: PASS, 10 files.

- [ ] **Step 2: Run the house style guard that scans `src/`**

Run: `npx vitest run test/unit/elves-workshop-name.test.ts`
Expected: PASS. A failure names the file and the wrong spelling: write it `Elves' Workshop`.

- [ ] **Step 3: Lint and build**

Run: `npm run lint` then `npm run build`
Expected: both exit 0 with no output about `src/elf` or `test/unit/elf-`.

- [ ] **Step 4: Confirm nothing shared was touched**

Run: `git diff --stat origin/main...HEAD`
Expected: only `docs/superpowers/`, `src/elf/` and `test/unit/elf-*.test.ts`.

- [ ] **Step 5: Commit anything the checks made you fix**

```bash
git add src/elf test/unit
git commit -m "Elf Detective School: game rules pass lint and build"
```

(Skip the commit if there was nothing to fix.)
