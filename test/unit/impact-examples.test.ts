import { describe, it, expect } from "vitest";
import {
  BIG_TOTAL_PENCE,
  IMPACT_FOOTNOTE,
  STARTING_EXAMPLES,
  exampleAtOrBelow,
  exampleExactly,
  giveFormExamples,
  impactAmountSchema,
  impactWordingSchema,
  meterImpactLine,
  sortExamples,
  type ImpactExample,
} from "../../src/impact/examples";

// What gifts could do (Jaimie, 2026-10-03): one shared list of "could" examples, set in
// Admin > Fundraising, shown under the give amounts and the meter on fundraiser, event and team
// pages, and later on a Fill a Red Bag page. OSCR-safe wording only: "could", never "will buy".

const list = (): ImpactExample[] => STARTING_EXAMPLES.map((e, i) => ({ ...e, id: i + 1 }));

describe("the starting examples", () => {
  it("are the five Jaimie approved, in order", () => {
    expect(STARTING_EXAMPLES.map((e) => [e.amountPence, e.wording])).toEqual([
      [500, "could help put a cosy pair of pyjamas in a Red Bag"],
      [1000, "could help put pyjamas, socks, a hat and gloves in a Red Bag"],
      [2500, "could help buy a pair of school shoes"],
      [5000, "could help fill a whole Red Bag Full of Joy"],
      [4000, "could help a child start school in a uniform that fits"],
    ]);
  });

  it("keep the £40 one for big totals only, and give the meter its two", () => {
    const forty = STARTING_EXAMPLES.find((e) => e.amountPence === 4000)!;
    expect(forty.onGiveForm).toBe(false);
    expect(forty.meterLine).toBe("uniforms");
    expect(STARTING_EXAMPLES.find((e) => e.amountPence === 5000)!.meterLine).toBe("red_bags");
    expect(STARTING_EXAMPLES.filter((e) => e.meterLine === null)).toHaveLength(3);
    expect(STARTING_EXAMPLES.every((e) => e.active)).toBe(true);
  });
});

describe("the give form's examples", () => {
  it("are the ones switched on and meant for the give form, smallest first", () => {
    expect(giveFormExamples(list()).map((e) => e.amountPence)).toEqual([500, 1000, 2500, 5000]);
  });

  it("leave out one switched off", () => {
    const l = list().map((e) => (e.amountPence === 2500 ? { ...e, active: false } : e));
    expect(giveFormExamples(l).map((e) => e.amountPence)).toEqual([500, 1000, 5000]);
  });

  it("keep one per amount: the first in the list's order", () => {
    const l = [...list(), { ...list()[0], id: 99, sortOrder: 99, wording: "could help buy a warm hat" }];
    expect(giveFormExamples(l).filter((e) => e.amountPence === 500).map((e) => e.id)).toEqual([1]);
  });
});

describe("the example for an amount", () => {
  it("is the exact one for a preset, or none", () => {
    expect(exampleExactly(1000, list())!.wording).toBe("could help put pyjamas, socks, a hat and gloves in a Red Bag");
    expect(exampleExactly(2000, list())).toBeNull();
  });

  it("is the largest at or below an amount typed", () => {
    expect(exampleAtOrBelow(500, list())!.amountPence).toBe(500);
    expect(exampleAtOrBelow(2499, list())!.amountPence).toBe(1000);
    expect(exampleAtOrBelow(3000, list())!.amountPence).toBe(2500);
    // £45: the £40 is for big totals only, so it is the school shoes.
    expect(exampleAtOrBelow(4500, list())!.amountPence).toBe(2500);
    expect(exampleAtOrBelow(100000, list())!.amountPence).toBe(5000);
  });

  it("is nothing below £5", () => {
    expect(exampleAtOrBelow(499, list())).toBeNull();
    expect(exampleAtOrBelow(0, list())).toBeNull();
  });
});

describe("the line under the meter", () => {
  it("says every pound could help below £50", () => {
    expect(meterImpactLine(0, list())).toBe("Every pound could help fill a Red Bag Full of Joy");
    expect(meterImpactLine(4999, list())).toBe("Every pound could help fill a Red Bag Full of Joy");
  });

  it("counts Red Bags from £50, one in the singular", () => {
    expect(meterImpactLine(5000, list())).toBe("What's been raised so far could fill around 1 Red Bag Full of Joy");
    expect(meterImpactLine(9999, list())).toBe("What's been raised so far could fill around 1 Red Bag Full of Joy");
    expect(meterImpactLine(15000, list())).toBe("What's been raised so far could fill around 3 Red Bags Full of Joy");
  });

  it("adds the school uniforms from £400", () => {
    expect(BIG_TOTAL_PENCE).toBe(40000);
    expect(meterImpactLine(39999, list())).toBe("What's been raised so far could fill around 7 Red Bags Full of Joy");
    expect(meterImpactLine(40000, list())).toBe(
      "What's been raised so far could fill around 8 Red Bags Full of Joy, or help 10 children start school in a uniform that fits",
    );
    expect(meterImpactLine(123456, list())).toContain("around 24 Red Bags Full of Joy, or help 30 children");
  });

  it("never says help 0 children: the uniforms come in only once one is covered", () => {
    const l = list().map((e) => (e.meterLine === "uniforms" ? { ...e, amountPence: 50000 } : e));
    expect(meterImpactLine(45000, l)).toBe("What's been raised so far could fill around 9 Red Bags Full of Joy");
    expect(meterImpactLine(50000, l)).toBe(
      "What's been raised so far could fill around 10 Red Bags Full of Joy, or help 1 child start school in a uniform that fits",
    );
  });

  it("drops the uniforms when that example is switched off", () => {
    const l = list().map((e) => (e.meterLine === "uniforms" ? { ...e, active: false } : e));
    expect(meterImpactLine(50000, l)).toBe("What's been raised so far could fill around 10 Red Bags Full of Joy");
  });

  it("is not there at all when the Red Bag example is switched off", () => {
    const l = list().map((e) => (e.meterLine === "red_bags" ? { ...e, active: false } : e));
    expect(meterImpactLine(50000, l)).toBeNull();
    expect(meterImpactLine(0, [])).toBeNull();
  });

  it("follows the amount staff set on the example", () => {
    const l = list().map((e) => (e.meterLine === "red_bags" ? { ...e, amountPence: 6000 } : e));
    expect(meterImpactLine(5999, l)).toBe("Every pound could help fill a Red Bag Full of Joy");
    expect(meterImpactLine(12000, l)).toBe("What's been raised so far could fill around 2 Red Bags Full of Joy");
  });
});

describe("the footnote", () => {
  it("says what the examples are", () => {
    expect(IMPACT_FOOTNOTE).toBe("These show what gifts could do. Every gift goes where it's needed most.");
  });
});

describe("the list's order", () => {
  it("is by sort order, then by when it was added", () => {
    const l = list().map((e) => ({ ...e, sortOrder: e.amountPence === 4000 ? 0 : 5 }));
    expect(sortExamples(l).map((e) => e.amountPence)).toEqual([4000, 500, 1000, 2500, 5000]);
  });
});

describe("the wording staff type", () => {
  const parse = (v: unknown) => impactWordingSchema.safeParse(v);

  it("is tidied: trimmed, single spaced, and Could made could", () => {
    expect(parse("  Could help  buy a  warm coat ")).toEqual({ success: true, data: "could help buy a warm coat" });
  });

  it("must start with could", () => {
    for (const words of ["helps buy a warm coat", "it could help buy a warm coat", "a warm coat, which could help"]) {
      const r = parse(words);
      expect(r.success, words).toBe(false);
      expect(r.success ? "" : r.error.issues[0].message).toMatch(/Start with could/);
    }
    expect(parse("COULD help buy a warm coat")).toEqual({ success: true, data: "could help buy a warm coat" });
  });

  it("refuses words that promise, even starting with could", () => {
    for (const words of [
      "will buy a warm coat, could be blue",
      "could help, and will pay for a coat",
      "could help: WILL  BUY a coat",
      "could help, it will cover a coat",
      "could help, it will fund a coat",
      "could help, it will provide a coat",
      "could help, and pays for a coat",
      "could help, and buys a coat",
    ]) {
      const r = parse(words);
      expect(r.success, words).toBe(false);
      expect(r.success ? "" : r.error.issues[0].message).toMatch(/will buy/);
    }
  });

  it("counts could as a word, not inside another", () => {
    expect(parse("couldron of soup for everyone").success).toBe(false);
  });

  it("is between 10 and 160 characters", () => {
    expect(parse("could").success).toBe(false);
    expect(parse(`could ${"a".repeat(160)}`).success).toBe(false);
  });
});

describe("the amount staff set", () => {
  it("is whole pence from £1 to £10,000", () => {
    expect(impactAmountSchema.safeParse(2500).success).toBe(true);
    expect(impactAmountSchema.safeParse(99).success).toBe(false);
    expect(impactAmountSchema.safeParse(1_000_001).success).toBe(false);
    expect(impactAmountSchema.safeParse(25.5).success).toBe(false);
    expect(impactAmountSchema.safeParse("2500").success).toBe(false);
  });
});
