import { describe, it, expect } from "vitest";
import { GUESS_MAX, cracked, decideGuess, type GuessContext } from "../../src/elf/guess";

// NBCC Elf Detective School: the typed guess. Every place here is invented.

const hunting: GuessContext = { doorState: "hunting", openPlaces: [] };

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
    const ctx: GuessContext = { doorState: "hunting", openPlaces: [{ door: 3, names: ["Pine Cone Café"] }] };
    expect(decideGuess(ctx, "pine cone cafe")).toEqual({ ok: false, reason: "place-already-open", door: 3 });
  });

  it("checks in a fixed order, so every other text gets the same answer", () => {
    const ctx: GuessContext = { doorState: "found", openPlaces: [{ door: 3, names: ["Pine Cone Café"] }] };
    expect(decideGuess(ctx, "")).toEqual({ ok: false, reason: "empty" });
    expect(decideGuess(ctx, "a".repeat(81))).toEqual({ ok: false, reason: "too-long" });
    expect(decideGuess(ctx, "pine cone cafe")).toEqual({ ok: false, reason: "not-hunting" });
  });
});

describe("cracking the case", () => {
  const at = (hms: string) => new Date(`2026-12-07T${hms}.000Z`);
  const door = { state: "found" as const, openedAt: at("19:00:00"), names: ["Corner Bakehouse", "The Bakehouse"] };
  const guess = (when: string, norm = "bakehouse") => ({ text: "x", norm, at: at(when) });

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
});
