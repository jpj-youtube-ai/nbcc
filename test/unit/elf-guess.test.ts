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
