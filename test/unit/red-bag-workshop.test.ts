import { describe, it, expect } from "vitest";
import { LADDERS, WORKSHOP_SIZES, workshopView } from "../../src/red-bag/workshop";
import { WORKSHOP_FIRST_STAGE } from "../../src/red-bag/render";

// The Workshop behind the night look (Jaimie, 5 and 6 November 2026): one bag on the shelves for every
// £50 given, twelve painted stages, opening stocked at stage 3, and a private size per company that
// paces the stages ("quick start, scaled"). No goal: past the last rung it just keeps counting.
const BAG = 5000;

describe("the ladders", () => {
  it("has one for each size and one for everyone, each nine rungs climbing", () => {
    expect(Object.keys(LADDERS).sort()).toEqual(["everyone", "large", "medium", "small"]);
    expect([...WORKSHOP_SIZES]).toEqual(["small", "medium", "large"]);
    for (const [name, rungs] of Object.entries(LADDERS)) {
      expect(rungs.length, name).toBe(12 - WORKSHOP_FIRST_STAGE);
      expect(rungs[0], name).toBe(name === "everyone" ? 2 : 1);
      for (let i = 1; i < rungs.length; i += 1) expect(rungs[i], `${name} ${i}`).toBeGreaterThan(rungs[i - 1]);
    }
  });

  it("is Jaimie's quick start for about a hundred people", () => {
    expect(LADDERS.medium).toEqual([1, 3, 6, 10, 16, 25, 40, 65, 100]);
  });
});

describe("what the Workshop shows", () => {
  it("opens stocked before any bag, with one bag to the first shelf", () => {
    expect(workshopView(0, "medium")).toEqual({ stage: WORKSHOP_FIRST_STAGE, bags: 0, nextIn: 1 });
  });

  it("counts a bag for every full £50, never a part one", () => {
    expect(workshopView(BAG - 1, "medium").bags).toBe(0);
    expect(workshopView(BAG, "medium").bags).toBe(1);
    expect(workshopView(BAG * 7 + 4999, "medium").bags).toBe(7);
  });

  it("moves up a stage at each rung, and says how many more fill the next shelf", () => {
    expect(workshopView(BAG * 1, "medium")).toEqual({ stage: 4, bags: 1, nextIn: 2 });
    expect(workshopView(BAG * 2, "medium")).toEqual({ stage: 4, bags: 2, nextIn: 1 });
    expect(workshopView(BAG * 3, "medium")).toEqual({ stage: 5, bags: 3, nextIn: 3 });
    expect(workshopView(BAG * 99, "medium")).toEqual({ stage: 11, bags: 99, nextIn: 1 });
  });

  it("is overflowing from the last rung on, and keeps counting with no goal", () => {
    expect(workshopView(BAG * 100, "medium")).toEqual({ stage: 12, bags: 100, nextIn: 0 });
    expect(workshopView(BAG * 4321, "medium")).toEqual({ stage: 12, bags: 4321, nextIn: 0 });
  });

  it("paces a small company faster and everyone slower", () => {
    expect(workshopView(BAG * 10, "small").stage).toBeGreaterThan(workshopView(BAG * 10, "medium").stage);
    expect(workshopView(BAG * 10, "everyone").stage).toBeLessThan(workshopView(BAG * 10, "medium").stage);
  });

  it("carries a company's name, and treats nonsense as nothing given", () => {
    expect(workshopView(BAG, "small", "GE Aviation").name).toBe("GE Aviation");
    expect(workshopView(Number.NaN, "medium")).toEqual({ stage: WORKSHOP_FIRST_STAGE, bags: 0, nextIn: 1 });
    expect(workshopView(-500, "medium").bags).toBe(0);
    expect(workshopView(BAG, "huge" as never).stage).toBe(workshopView(BAG, "everyone").stage);
  });
});
