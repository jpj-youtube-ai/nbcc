import { describe, it, expect } from "vitest";
import { allInFamily, chosenDetectives } from "../../src/elf/detectives";

// NBCC Elf Detective School: which detectives a form is talking about. Every id is invented.

describe("the detectives ticked on a form", () => {
  it("takes a list, each detective once, in the order they were ticked", () => {
    expect(chosenDetectives(["d2", "d1", "d2"])).toEqual(["d2", "d1"]);
  });

  it("takes one ticked box, which a form sends as a single value", () => {
    expect(chosenDetectives("d1")).toEqual(["d1"]);
    expect(chosenDetectives(14)).toEqual(["14"]);
  });

  it("is nobody when no box is ticked, which a form sends as nothing at all", () => {
    expect(chosenDetectives(undefined)).toEqual([]);
    expect(chosenDetectives(null)).toEqual([]);
    expect(chosenDetectives([])).toEqual([]);
    expect(chosenDetectives("")).toEqual([]);
    expect(chosenDetectives("   ")).toEqual([]);
  });

  it("reads ids that arrive as numbers as text, and tidies the spaces round them", () => {
    expect(chosenDetectives([14, " 15 ", 14])).toEqual(["14", "15"]);
  });

  it("drops anything that is not an id", () => {
    expect(chosenDetectives(["d1", {}, null, Number.NaN, true, ["d2"]])).toEqual(["d1"]);
    expect(chosenDetectives({ 0: "d1" })).toEqual([]);
  });
});

describe("belonging to the family", () => {
  it("is true only when every chosen detective is one of the family's", () => {
    expect(allInFamily(["d1", "d2"], ["d1", "d2", "d3"])).toBe(true);
    expect(allInFamily(["d1", "d9"], ["d1", "d2", "d3"])).toBe(false);
  });

  it("compares ids as text, so a number from the database matches the same id from a form", () => {
    expect(allInFamily(["14"], [14, 15])).toBe(true);
  });

  it("is false for a family with no detectives, or with none given", () => {
    expect(allInFamily(["d1"], [])).toBe(false);
    expect(allInFamily(["d1"], null)).toBe(false);
  });
});
