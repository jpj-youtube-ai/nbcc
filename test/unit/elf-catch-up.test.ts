import { describe, it, expect, vi } from "vitest";

// runOf sits beside the game's SQL, so the pool is mocked: nothing here touches a database.
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { runOf, type DoorRun } from "../../src/db/elf-game";
import type { Door } from "../../src/elf/calendar";
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";
import type { DoorState } from "../../src/elf/doors";
import type { SavedGuess } from "../../src/elf/guess";
import {
  christmasDay,
  closingShown,
  decideGo,
  doorsKnown,
  doorsToCrack,
  goesOpen,
  knowsPlace,
  mayHaveAGo,
  newYearsDay,
  placesPublic,
  type FamilyKnowledge,
} from "../../src/elf/catch-up";

// NBCC Elf Detective School: catching up on missed doors. The one rule for who can see a door's place,
// having a go, the Christmas window and the closing time the clues show. Pure, checked here without a
// clock. 7 December 2026 is a Monday: a school day, so clue 1 is at 5:30pm, then 6pm and 6:30pm, the
// place is shown at 7pm and it closes at 8pm (December London time is GMT). Every place, elf and family
// here is invented.

const at = (iso: string) => new Date(iso);
const SIX_47 = at("2026-12-07T18:47:00Z");
const SEVEN_05 = at("2026-12-07T19:05:00Z");
const CHRISTMAS_DAY = at("2026-12-25T00:00:00Z");
const MARCH = at("2027-03-01T12:00:00Z");

/** A door set up with an invented place, elf and tag word. */
function setup(door: number, over: Partial<DoorSetup> = {}): DoorSetup {
  return {
    ...emptyDoor(door as Door, `code${door}`),
    placeName: "Corner Bakehouse",
    placeTown: "Snowford",
    names: [{ id: 1, name: "The Bakehouse" }],
    tagWord: "SNOWBALL",
    elfName: "Twinkle",
    ...over,
  };
}
const run = (door: number, now: Date, over: Partial<DoorSetup> = {}): DoorRun => runOf(2026, setup(door, over), now);
const guess = (saved: Date): SavedGuess => ({ text: "Corner Bakehouse", norm: "cornerbakehouse", at: saved, late: false });
/** What a family has done: the doors it has a guess at, and the doors where a detective typed the tag's word. */
const knowing = (o: { guessed?: number[]; typed?: number[] }): FamilyKnowledge => ({
  guesses: new Map((o.guessed ?? []).map((door) => [door, guess(at("2026-12-01T18:00:00Z"))])),
  typed: new Set(o.typed ?? []),
});

describe("the Christmas window", () => {
  it("starts at midnight in London as Christmas Day begins, and ends as 1 January begins", () => {
    expect(christmasDay(2026)).toBeInstanceOf(Date);
    expect(christmasDay(2026).toISOString()).toBe("2026-12-25T00:00:00.000Z");
    expect(newYearsDay(2026)).toBeInstanceOf(Date);
    expect(newYearsDay(2026).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("shows every place to everyone from Christmas Day until 1 January", () => {
    expect(placesPublic(2026, at("2026-12-24T23:59:59Z"))).toBe(false);
    expect(placesPublic(2026, CHRISTMAS_DAY)).toBe(true);
    expect(placesPublic(2026, at("2026-12-31T23:59:59Z"))).toBe(true);
    expect(placesPublic(2026, at("2027-01-01T00:00:00Z"))).toBe(false);
  });

  it("never shows the practice door's place to everyone", () => {
    expect(placesPublic(0, at("2026-12-26T12:00:00Z"))).toBe(false);
  });

  it("keeps having a go open until Christmas Day, and closed from then on", () => {
    expect(goesOpen(2026, at("2026-12-24T23:59:59Z"))).toBe(true);
    expect(goesOpen(2026, CHRISTMAS_DAY)).toBe(false);
    expect(goesOpen(2026, at("2027-01-01T00:00:00Z"))).toBe(false);
  });

  it("never closes having a go at the practice door", () => {
    expect(goesOpen(0, MARCH)).toBe(true);
    expect(goesOpen(0, at("2026-12-26T12:00:00Z"))).toBe(true);
  });
});

describe("the one rule: who can see a door's place", () => {
  it("is a family with a guess at an open door, or one whose detective typed the tag's word", () => {
    expect(knowsPlace({ state: "found", guessed: true, typed: false })).toBe(true);
    expect(knowsPlace({ state: "found-hidden", guessed: true, typed: false })).toBe(false);
    expect(knowsPlace({ state: "hunting", guessed: false, typed: true })).toBe(true);
    expect(knowsPlace({ state: "revealed", guessed: false, typed: false })).toBe(false);
    expect(knowsPlace({ state: "snow", guessed: false, typed: false })).toBe(false);
  });

  it("counts a door as open only once its place is shown: found or revealed", () => {
    const states: DoorState[] = ["shut", "hunting", "found-hidden", "found", "revealed", "snow"];
    expect(states.filter((state) => knowsPlace({ state, guessed: true, typed: false }))).toEqual(["found", "revealed"]);
  });
});

describe("having a go", () => {
  // Door 7's elf was found at 6:47pm, so its place was shown at 7pm.
  const door7 = run(7, SEVEN_05, { foundAt: SIX_47 });
  const go = { year: 2026, state: door7.state, guessed: false, typed: false, now: SEVEN_05 };

  it("is offered at an open door the family has neither guessed nor been to", () => {
    expect(door7.state).toBe("found");
    expect(mayHaveAGo(go)).toBe(true);
  });

  it("is not offered from Christmas Day", () => {
    expect(mayHaveAGo({ ...go, now: CHRISTMAS_DAY })).toBe(false);
  });

  it("is not offered to a family that has guessed, or whose detective typed the tag's word", () => {
    expect(mayHaveAGo({ ...go, guessed: true })).toBe(false);
    expect(mayHaveAGo({ ...go, typed: true })).toBe(false);
  });

  it("is not offered while the place is hidden, or on a snow day", () => {
    expect(mayHaveAGo({ ...go, state: "found-hidden" })).toBe(false);
    expect(mayHaveAGo({ ...go, state: "snow" })).toBe(false);
  });

  it("is offered at the practice door at any time of year", () => {
    expect(mayHaveAGo({ ...go, year: 0, now: MARCH })).toBe(true);
  });
});

describe("the doors a family can still crack, and the doors whose place it knows", () => {
  // 8 December 2026 at 7:05pm. Nobody has found door 8's elf, so its place is not shown until it closes at 8pm.
  const NOW = at("2026-12-08T19:05:00Z");
  const runs = [
    run(3, NOW, { foundAt: at("2026-12-03T18:47:00Z") }),
    run(4, NOW, { snowDayAt: at("2026-12-04T17:30:00Z") }),
    run(5, NOW),
    run(6, NOW, { foundAt: at("2026-12-06T10:47:00Z") }),
    run(7, NOW, { foundAt: SIX_47 }),
    run(8, NOW),
  ];
  const family = knowing({ guessed: [6], typed: [7] });

  it("starts from doors found, snowed in, revealed and hunting", () => {
    expect(runs.map((r) => r.state)).toEqual(["found", "snow", "revealed", "found", "found", "hunting"]);
  });

  it("offers a go at every open door the family has neither guessed nor been to, newest first", () => {
    expect(doorsToCrack({ runs, knowledge: family, now: NOW }).map((r) => r.door)).toEqual([5, 3]);
  });

  it("knows the open doors the family guessed or typed the word at, in door order", () => {
    expect(doorsKnown({ runs, knowledge: family, now: NOW })).toEqual([6, 7]);
    expect(doorsKnown({ runs: [...runs].reverse(), knowledge: family, now: NOW })).toEqual([6, 7]);
  });

  it("leaves out a door whose place is still hidden, even when a detective typed its word", () => {
    // Door 8's elf found at 6:47pm, with its place shown at 7:30pm: at 7:05pm the place is still hidden.
    const hidden = run(8, NOW, { foundAt: at("2026-12-08T18:47:00Z"), revealTime: "19:30" });
    expect(hidden.state).toBe("found-hidden");
    expect(doorsKnown({ runs: [...runs.slice(0, 5), hidden], knowledge: knowing({ guessed: [6], typed: [7, 8] }), now: NOW })).toEqual([6, 7]);
  });

  it("counts only found and revealed doors as open, whatever the family has done", () => {
    const shut = run(9, NOW);
    expect(shut.state).toBe("shut");
    const everything = knowing({ guessed: [3, 4, 5, 6, 7, 8, 9], typed: [3, 4, 5, 6, 7, 8, 9] });
    expect(doorsKnown({ runs: [...runs, shut], knowledge: everything, now: NOW })).toEqual([3, 5, 6, 7]);
  });

  it("works each door out at now, not when the runs were read", () => {
    // At 8:05pm door 8's place has been shown since it closed at 8pm, with its elf still hiding.
    const later = at("2026-12-08T20:05:00Z");
    expect(doorsToCrack({ runs, knowledge: family, now: later }).map((r) => r.door)).toEqual([8, 5, 3]);
    expect(doorsKnown({ runs, knowledge: knowing({ guessed: [6], typed: [7, 8] }), now: later })).toEqual([6, 7, 8]);
  });

  it("offers no go from Christmas Day", () => {
    expect(doorsToCrack({ runs, knowledge: family, now: CHRISTMAS_DAY })).toEqual([]);
  });

  it("leaves the practice door out of both", () => {
    const practice: DoorRun = { ...run(3, NOW, { foundAt: at("2026-12-03T18:47:00Z") }), year: 0, door: 0 };
    expect(doorsToCrack({ runs: [practice], knowledge: knowing({}), now: NOW })).toEqual([]);
    expect(doorsKnown({ runs: [practice], knowledge: knowing({ guessed: [0], typed: [0] }), now: NOW })).toEqual([]);
  });
});

describe("deciding a go", () => {
  const ctx = { year: 2026, state: "found" as DoorState, guessed: false, typed: false, now: SEVEN_05 };

  it("checks in a fixed order, so a family gets the same answer whatever it typed", () => {
    const everything = { guessed: true, typed: true, now: CHRISTMAS_DAY };
    expect(decideGo({ ...ctx, ...everything, state: "found-hidden" }, "")).toEqual({ ok: false, reason: "not-open" });
    expect(decideGo({ ...ctx, ...everything }, "")).toEqual({ ok: false, reason: "closed" });
    expect(decideGo({ ...ctx, guessed: true, typed: true }, "")).toEqual({ ok: false, reason: "already" });
    expect(decideGo({ ...ctx, typed: true }, "")).toEqual({ ok: false, reason: "been-there" });
    expect(decideGo(ctx, "   ")).toEqual({ ok: false, reason: "empty" });
    expect(decideGo(ctx, "a".repeat(81))).toEqual({ ok: false, reason: "too-long" });
  });

  it("is not open at a door whose place is not shown", () => {
    for (const state of ["shut", "hunting", "found-hidden", "snow"] as DoorState[]) {
      expect(decideGo({ ...ctx, state }, "Corner Bakehouse"), state).toEqual({ ok: false, reason: "not-open" });
    }
  });

  it("takes one guess, trimmed, and says how it will be matched", () => {
    expect(decideGo(ctx, "  Corner Bakehouse ")).toEqual({ ok: true, text: "Corner Bakehouse", norm: "cornerbakehouse" });
    expect(decideGo({ ...ctx, state: "revealed" }, "Corner Bakehouse").ok).toBe(true);
  });

  it("counts the letters once trimmed, up to 80", () => {
    expect(decideGo(ctx, "a".repeat(80)).ok).toBe(true);
    expect(decideGo(ctx, `  ${"a".repeat(80)}  `)).toEqual({ ok: true, text: "a".repeat(80), norm: "a".repeat(80) });
  });

  it("asks for a place when nothing was typed", () => {
    expect(decideGo(ctx, undefined)).toEqual({ ok: false, reason: "empty" });
  });

  it("takes a go at the practice door at any time of year", () => {
    expect(decideGo({ ...ctx, year: 0, now: MARCH }, "Corner Bakehouse").ok).toBe(true);
  });
});

describe("the closing time the clues show", () => {
  const FIVE_29 = at("2026-12-07T17:29:00Z");
  const SIX_10 = at("2026-12-07T18:10:00Z");
  const EIGHT_PM = "2026-12-07T20:00:00.000Z";
  const door7 = (now: Date, over: Partial<DoorSetup> = {}) => run(7, now, { closesAt: "20:00", ...over });
  const closingAt = (now: Date, over: Partial<DoorSetup> = {}) => closingShown(door7(now, over), now);

  it("is the place's closing time on the door's own day, from clue 1", () => {
    expect(closingAt(SIX_10)).toBeInstanceOf(Date);
    expect(closingAt(SIX_10)?.toISOString()).toBe(EIGHT_PM);
  });

  it("stays until the place has closed, once the elf is found too", () => {
    expect(closingAt(at("2026-12-07T19:30:00Z"), { foundAt: SIX_47 })?.toISOString()).toBe(EIGHT_PM);
    expect(closingAt(at("2026-12-07T19:59:59Z"))?.toISOString()).toBe(EIGHT_PM);
    expect(closingAt(at("2026-12-07T20:00:00Z"))).toBeNull();
    expect(closingAt(at("2026-12-07T20:01:00Z"))).toBeNull();
  });

  it("is not shown before clue 1", () => {
    expect(closingAt(FIVE_29)).toBeNull();
  });

  it("works the door out at now, not when it was read", () => {
    expect(closingShown(door7(FIVE_29), SIX_10)?.toISOString()).toBe(EIGHT_PM);
  });

  it("is never the 8pm a door falls back to when no closing time is typed", () => {
    expect(closingAt(SIX_10, { closesAt: null })).toBeNull();
  });

  it("is not shown on a snow day", () => {
    expect(closingAt(SIX_10, { snowDayAt: at("2026-12-07T17:30:00Z") })).toBeNull();
  });

  it("is not shown when the place closes on the next day", () => {
    expect(closingAt(SIX_10, { closesAt: "01:00" })).toBeNull();
  });

  // Rulings on Plan 2c-1, from Task 6's review: once the elf has gone home a visit is refused, so the place
  // is no longer worth a trip and no screen or email says when it closes.
  it("is not shown once the elf has gone home, found or not", () => {
    const SEVEN_30 = at("2026-12-07T19:30:00Z");
    expect(closingAt(SEVEN_30, { foundAt: SIX_47 })?.toISOString()).toBe(EIGHT_PM);
    expect(closingAt(SEVEN_30, { foundAt: SIX_47, goneHomeAt: at("2026-12-07T19:20:00Z") })).toBeNull();
    expect(closingAt(SEVEN_30, { goneHomeAt: at("2026-12-07T19:20:00Z") })).toBeNull();
  });

  // Plan 2c-2, ruling F4 (Jaimie: "Once the clues are out, they can tell when the place closes"). Door 24's
  // place closes at 4pm unless a head elf types a time (src/elf/calendar.ts), so its clues say so; the 8pm
  // every other door falls back to is still never said. Thursday 24 December 2026: clue 1 at 10am.
  describe("on Christmas Eve, door 24", () => {
    const TEN_05 = at("2026-12-24T10:05:00Z");
    const FOUR_PM = "2026-12-24T16:00:00.000Z";
    const eve = (now: Date, over: Partial<DoorSetup> = {}) => closingShown(run(24, now, over), now);

    it("says 4pm when no closing time is typed, from clue 1 until 4pm", () => {
      expect(eve(TEN_05)?.toISOString()).toBe(FOUR_PM);
      expect(eve(at("2026-12-24T15:59:59Z"))?.toISOString()).toBe(FOUR_PM);
      expect(eve(at("2026-12-24T16:00:00Z"))).toBeNull();
      expect(eve(at("2026-12-24T09:59:00Z"))).toBeNull();
    });

    it("says the time a head elf typed instead", () => {
      expect(eve(TEN_05, { closesAt: "15:00" })?.toISOString()).toBe("2026-12-24T15:00:00.000Z");
    });

    it("says nothing on its snow day, or once its elf has gone home", () => {
      expect(eve(TEN_05, { snowDayAt: at("2026-12-24T10:00:00Z") })).toBeNull();
      expect(eve(TEN_05, { goneHomeAt: at("2026-12-24T10:01:00Z") })).toBeNull();
    });

    it("leaves the day before Christmas Eve saying nothing with no closing time typed", () => {
      const evening = at("2026-12-23T17:35:00Z");
      expect(closingShown(run(23, evening), evening)).toBeNull();
    });
  });
});
