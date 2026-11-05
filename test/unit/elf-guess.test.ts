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
  const OPENED = new Date("2026-12-07T17:47:00.000Z");
  const BEFORE = new Date("2026-12-07T17:40:00.000Z");
  const open = { state: "found", placeId: "cinema", openedAt: OPENED } as const;

  it("counts a guess saved before the door opened that names the door's real place", () => {
    expect(cracked(open, { placeId: "cinema", at: BEFORE })).toBe(true);
    expect(cracked({ ...open, state: "revealed" }, { placeId: "cinema", at: BEFORE })).toBe(true);
  });

  it("does not count a wrong guess, or no guess at all", () => {
    expect(cracked(open, { placeId: "bakery", at: BEFORE })).toBe(false);
    expect(cracked(open, null)).toBe(false);
  });

  it("never says yes while the elf is still hidden, so a screen cannot confirm a guess early", () => {
    expect(cracked({ state: "hunting", placeId: "cinema", openedAt: null }, { placeId: "cinema", at: BEFORE })).toBe(false);
    expect(cracked({ state: "shut", placeId: "cinema", openedAt: null }, { placeId: "cinema", at: BEFORE })).toBe(false);
  });

  it("does not count a guess saved at or after the moment the door opened", () => {
    expect(cracked(open, { placeId: "cinema", at: OPENED })).toBe(false);
    expect(cracked(open, { placeId: "cinema", at: new Date("2026-12-07T17:50:00.000Z") })).toBe(false);
  });

  it("does not count anything for an open door with no opening moment", () => {
    expect(cracked({ ...open, openedAt: null }, { placeId: "cinema", at: BEFORE })).toBe(false);
  });
});
