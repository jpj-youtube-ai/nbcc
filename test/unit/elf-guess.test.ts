import { describe, it, expect } from "vitest";
import { GUESS_MAX, cracked, decideGuess, type GuessContext, type SavedGuess } from "../../src/elf/guess";

// NBCC Elf Detective School: the typed guess. Every place here is invented.

const hunting: GuessContext = { doorState: "hunting", openPlaces: [], hasGuess: false, mayHaveAGo: false };

describe("saving a typed guess", () => {
  it("trims the text and says how it will be matched", () => {
    expect(decideGuess(hunting, "  The Corner Bakehouse ")).toEqual({ ok: true, text: "The Corner Bakehouse", norm: "cornerbakehouse" });
  });

  it("refuses nothing, and too much", () => {
    expect(GUESS_MAX).toBe(80);
    expect(decideGuess(hunting, "")).toEqual({ ok: false, reason: "empty" });
    expect(decideGuess(hunting, "   ")).toEqual({ ok: false, reason: "empty" });
    expect(decideGuess(hunting, undefined)).toEqual({ ok: false, reason: "empty" });
    expect(decideGuess(hunting, "a".repeat(81))).toEqual({ ok: false, reason: "too-long" });
    expect(decideGuess(hunting, "a".repeat(80)).ok).toBe(true);
  });

  it("takes guesses while hunting and while found with the place hidden, and no other time", () => {
    expect(decideGuess({ ...hunting, doorState: "found" }, "Anywhere")).toEqual({ ok: false, reason: "not-hunting" });
    expect(decideGuess({ ...hunting, doorState: "shut" }, "Anywhere")).toEqual({ ok: false, reason: "not-hunting" });
    expect(decideGuess({ ...hunting, doorState: "found-hidden" }, "Anywhere").ok).toBe(true);
  });

  it("kindly refuses a place that is already open, with that door's number", () => {
    const ctx: GuessContext = { ...hunting, openPlaces: [{ door: 3, names: ["Pine Cone Café"] }] };
    expect(decideGuess(ctx, "pine cone cafe")).toEqual({ ok: false, reason: "place-already-open", door: 3 });
  });

  it("takes an open door's place as an ordinary guess when the family cannot see that place", () => {
    expect(decideGuess(hunting, "pine cone cafe")).toEqual({ ok: true, text: "pine cone cafe", norm: "pineconecafe" });
  });

  it("checks in a fixed order, so every other text gets the same answer", () => {
    const ctx: GuessContext = { ...hunting, doorState: "found", openPlaces: [{ door: 3, names: ["Pine Cone Café"] }] };
    expect(decideGuess(ctx, "")).toEqual({ ok: false, reason: "empty" });
    expect(decideGuess(ctx, "a".repeat(81))).toEqual({ ok: false, reason: "too-long" });
    expect(decideGuess(ctx, "pine cone cafe")).toEqual({ ok: false, reason: "not-hunting" });
  });
});

describe("a guess once the place is shown", () => {
  const found: GuessContext = { ...hunting, doorState: "found" };

  it("tells a family with a guess that it is locked in", () => {
    expect(decideGuess({ ...found, hasGuess: true }, "Anywhere")).toEqual({ ok: false, reason: "locked-in" });
    expect(decideGuess({ ...found, hasGuess: true, mayHaveAGo: true }, "Anywhere")).toEqual({ ok: false, reason: "locked-in" });
  });

  it("sends a family that may have a go to have it", () => {
    expect(decideGuess({ ...found, mayHaveAGo: true }, "Anywhere")).toEqual({ ok: false, reason: "have-a-go" });
    expect(decideGuess({ ...found, doorState: "revealed", mayHaveAGo: true }, "Anywhere")).toEqual({ ok: false, reason: "have-a-go" });
  });

  it("has nothing to guess for any other family", () => {
    expect(decideGuess(found, "Anywhere")).toEqual({ ok: false, reason: "not-hunting" });
  });

  it("still asks for a place, and for a shorter one, first", () => {
    expect(decideGuess({ ...found, hasGuess: true }, "")).toEqual({ ok: false, reason: "empty" });
    expect(decideGuess({ ...found, mayHaveAGo: true }, "")).toEqual({ ok: false, reason: "empty" });
    expect(decideGuess({ ...found, mayHaveAGo: true }, "a".repeat(81))).toEqual({ ok: false, reason: "too-long" });
  });

  it("never says locked in or have a go at a door whose place is not shown", () => {
    const either = { hasGuess: true, mayHaveAGo: true };
    expect(decideGuess({ ...hunting, ...either, doorState: "shut" }, "Anywhere")).toEqual({ ok: false, reason: "not-hunting" });
    expect(decideGuess({ ...hunting, ...either, doorState: "snow" }, "Anywhere")).toEqual({ ok: false, reason: "not-hunting" });
    expect(decideGuess({ ...hunting, ...either }, "Anywhere").ok).toBe(true);
    expect(decideGuess({ ...hunting, ...either, doorState: "found-hidden" }, "Anywhere").ok).toBe(true);
  });
});

describe("cracking the case", () => {
  const at = (hms: string) => new Date(`2026-12-07T${hms}.000Z`);
  const door = { state: "found" as const, openedAt: at("19:00:00"), names: ["Corner Bakehouse", "The Bakehouse"] };
  const guess = (when: string, norm = "bakehouse"): SavedGuess => ({ text: "x", norm, at: at(when), late: false });
  /** A go: one guess made once the place was shown. */
  const go = (when: string, norm = "bakehouse"): SavedGuess => ({ ...guess(when, norm), late: true });

  it("is true for a guess saved strictly before the place was shown", () => {
    expect(cracked(door, guess("18:59:59"))).toBe(true);
    expect(cracked({ ...door, state: "revealed" }, guess("18:59:59"))).toBe(true);
  });

  it("is false at the moment it was shown, and after", () => {
    expect(cracked(door, guess("19:00:00"))).toBe(false);
    expect(cracked(door, guess("19:00:01"))).toBe(false);
  });

  it("is false while the place is hidden, with no guess, no opening moment, or the wrong place", () => {
    expect(cracked({ ...door, state: "found-hidden" }, guess("18:59:59"))).toBe(false);
    expect(cracked(door, null)).toBe(false);
    expect(cracked({ ...door, openedAt: null }, guess("18:59:59"))).toBe(false);
    expect(cracked(door, guess("18:59:59", "bakery"))).toBe(false);
  });

  it("is true for a go made once the place was shown, from that very moment", () => {
    expect(cracked(door, go("19:05:00"))).toBe(true);
    expect(cracked(door, go("19:00:00"))).toBe(true);
    expect(cracked({ ...door, state: "revealed" }, go("19:05:00"))).toBe(true);
  });

  it("is false for a go saved before the place was shown", () => {
    expect(cracked(door, go("18:59:59"))).toBe(false);
  });

  it("is false for a go while the place is hidden, with no opening moment, or the wrong place", () => {
    expect(cracked({ ...door, state: "found-hidden" }, go("19:05:00"))).toBe(false);
    expect(cracked({ ...door, openedAt: null }, go("19:05:00"))).toBe(false);
    expect(cracked(door, go("19:05:00", "bakery"))).toBe(false);
  });
});
