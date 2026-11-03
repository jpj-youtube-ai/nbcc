import { describe, it, expect } from "vitest";
import { redBag } from "../../src/red-bag/catalogue";

// Fill a Red Bag (design: docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md). The list, the
// themes, the £50 bag value and the sums live in ONE module, assets/js/red-bag-catalogue.js, which the
// page loads in the browser and the server reads through src/red-bag/catalogue.ts. These are the
// rules Jaimie agreed: prices in pence, a bag fills towards £50, at most five drawn, and the words
// the status line says. Nothing here touches a database.

const rb = redBag();
const oneOfEverything = () => Object.fromEntries(rb.items().map((i) => [i.key, 1]));

describe("the list, as agreed", () => {
  it("uses the printed sheet's own four headings, in its order", () => {
    expect(rb.GROUPS.map((g) => g.heading)).toEqual(["Home comforts", "Play & downtime", "Books & creativity", "Clothing"]);
  });

  // The Toy is £15 from 5 October 2026 (it started at £5). Every other price is as first agreed.
  it("has the thirteen items at their agreed prices", () => {
    expect(rb.items().map((i) => [i.name, i.pence])).toEqual([
      ["Blanket", 800],
      ["Insulated cup", 700],
      ["Toiletry & fragrance gift set", 500],
      ["Toy", 1500],
      ["Soft toy", 400],
      ["Headphones", 900],
      ["Book", 300],
      ["Colouring book", 200],
      ["Pencil", 10],
      ["Notebook", 100],
      ["Pyjamas (ages 13 & under)", 500],
      ["Socks (pair)", 100],
      ["Hat & gloves", 400],
    ]);
  });

  it("gives every item and example a key of its own", () => {
    const keys = [...rb.items().map((i) => i.key), ...rb.examples().map((e) => e.key)];
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]+$/);
  });

  it("values one bag at £50, asks for £2 at least, and draws five bags at most", () => {
    expect(rb.BAG_VALUE_PENCE).toBe(5000);
    expect(rb.MIN_PENCE).toBe(200);
    expect(rb.MAX_BAGS_DRAWN).toBe(5);
    expect(rb.MAX_QUANTITY).toBe(99);
  });
});

describe("the three themes, as agreed", () => {
  // "Red Bags Full of Joy" was a fourth theme. Jaimie took it out on 4 October 2026: people are
  // already filling a bag from the list, so its £10, £25 and £50 examples said the same thing twice.
  it("has three themes of three examples each, with their amounts, in this order", () => {
    expect(rb.THEMES.map((t) => [t.title, t.sub, t.examples.map((e) => e.pence)])).toEqual([
      ["After a crisis", "Helping families start again", [1500, 3000, 6000]],
      ["Clothing & school", "When families can't stretch to it", [2500, 3500, 4000]],
      ["A hand at rock bottom", "When it matters most", [2000, 7500, 15000]],
    ]);
  });

  it("words every example with could, never will", () => {
    for (const e of rb.examples()) {
      expect(e.words, e.key).toMatch(/^could help /);
      expect(e.words, e.key).not.toMatch(/\bwill\b/i);
    }
  });

  it("keeps the agreed wording", () => {
    const words = rb.examples().map((e) => `${rb.pounds(e.pence)} ${e.words}`);
    expect(words).toContain("£15 could help replace a child's favourite cuddly toy");
    expect(words).toContain("£60 could help a family with kitchen basics to start again");
    expect(words).toContain("£40 could help a child start school in a uniform that fits");
    expect(words).toContain("£150 could help towards a bed or cooker for someone moving into a home with nothing");
  });

  it("no longer has the Red Bags Full of Joy theme or its examples", () => {
    expect(rb.THEMES.map((t) => t.key)).toEqual(["crisis", "school", "hand"]);
    expect(rb.examples().length).toBe(9);
    expect(rb.examples().some((e) => /^joy/.test(e.key))).toBe(false);
    expect(rb.totalPence({}, ["joy-10", "joy-25", "joy-50"])).toBe(0);
  });
});

describe("the total, in pence", () => {
  it("is nothing for an empty bag", () => {
    expect(rb.totalPence({}, [])).toBe(0);
  });

  it("is £64.10 for one of everything", () => {
    expect(rb.totalPence(oneOfEverything(), [])).toBe(6410);
  });

  it("never drifts: 99 pencils at 10p are exactly £9.90, and three are 30p", () => {
    expect(rb.totalPence({ pencil: 99 }, [])).toBe(990);
    expect(rb.totalPence({ pencil: 3 }, [])).toBe(30);
    expect(Number.isInteger(rb.totalPence({ pencil: 7, book: 3, socks: 11 }, ["hand-20"]))).toBe(true);
  });

  it("adds the examples tapped to the items", () => {
    expect(rb.totalPence({ socks: 2 }, ["hand-20", "crisis-15"])).toBe(200 + 2000 + 1500);
  });

  it("counts an example once however often it is named, and ignores what it does not know", () => {
    expect(rb.totalPence({ nonsense: 4 }, ["hand-20", "hand-20", "nope"])).toBe(2000);
  });

  it("keeps a quantity between 0 and 99, whole", () => {
    expect(rb.clampQuantity("7")).toBe(7);
    expect(rb.clampQuantity(-3)).toBe(0);
    expect(rb.clampQuantity(250)).toBe(99);
    expect(rb.clampQuantity("2.9")).toBe(2);
    expect(rb.clampQuantity("")).toBe(0);
    expect(rb.clampQuantity("abc")).toBe(0);
    expect(rb.totalPence({ socks: 500 }, [])).toBe(9900);
  });
});

describe("the bags", () => {
  const drawn = (pence: number) => rb.bags(pence).drawn.map((f) => Math.round(f * 1000) / 1000);

  it("is one empty bag at nothing", () => {
    expect(rb.bags(0)).toEqual({ full: 0, drawn: [0], more: 0 });
  });

  it("fills one bag towards £50", () => {
    expect(drawn(199)).toEqual([0.04]);
    expect(drawn(200)).toEqual([0.04]);
    expect(drawn(2500)).toEqual([0.5]);
    expect(rb.bags(4999).full).toBe(0);
    expect(rb.bags(4999).drawn[0]).toBeLessThan(1);
  });

  it("is exactly one full bag at £50, with no second started", () => {
    expect(rb.bags(5000)).toEqual({ full: 1, drawn: [1], more: 0 });
  });

  it("keeps the full bag and starts the next beside it", () => {
    expect(rb.bags(5410).full).toBe(1);
    expect(drawn(5410)).toEqual([1, 0.082]);
  });

  it("draws five at most", () => {
    expect(rb.bags(25000)).toEqual({ full: 5, drawn: [1, 1, 1, 1, 1], more: 0 });
    expect(drawn(24000)).toEqual([1, 1, 1, 1, 0.8]);
    expect(rb.bags(25410)).toEqual({ full: 5, drawn: [1, 1, 1, 1, 1], more: 0 });
  });

  it("then counts the whole bags it did not draw", () => {
    expect(rb.bags(30000)).toEqual({ full: 6, drawn: [1, 1, 1, 1, 1], more: 1 });
    expect(rb.bags(62000)).toEqual({ full: 12, drawn: [1, 1, 1, 1, 1], more: 7 });
  });
});

describe("the status line", () => {
  it("invites a start when the bag is empty", () => {
    expect(rb.statusLine(0)).toBe("Your bag is empty. Pop something in.");
  });

  it("nudges, kindly, below £2", () => {
    expect(rb.statusLine(10)).toBe("Add a little more to reach £2. Maybe some socks?");
    expect(rb.statusLine(199)).toBe(rb.WORDS.nudge);
  });

  it("says how full the bag is, from £2 to just under £50", () => {
    expect(rb.statusLine(200)).toBe("Your bag is starting to fill.");
    expect(rb.statusLine(1250)).toBe("Your bag is about a quarter full.");
    expect(rb.statusLine(2500)).toBe("Your bag is about half full.");
    expect(rb.statusLine(3750)).toBe("Your bag is about three quarters full.");
    expect(rb.statusLine(4999)).toBe("Your bag is nearly full.");
  });

  it("names a whole Red Bag at £50", () => {
    expect(rb.statusLine(5000)).toBe("That's around the value of a whole Red Bag Full of Joy.");
  });

  it("says another is filling when there is some left over", () => {
    expect(rb.statusLine(5410)).toBe("That's around the value of a whole Red Bag Full of Joy. Another one is filling.");
  });

  it("counts the bags from two up", () => {
    expect(rb.statusLine(10000)).toBe("That's around the value of 2 Red Bags Full of Joy.");
    expect(rb.statusLine(25410)).toBe("That's around the value of 5 Red Bags Full of Joy. Another one is filling.");
  });

  it("never promises: no status says will", () => {
    for (const p of [0, 10, 200, 1250, 2500, 3750, 4999, 5000, 5410, 10000, 25410]) {
      expect(rb.statusLine(p)).not.toMatch(/\bwill\b/i);
      expect(rb.statusLine(p)).not.toMatch(/[–—]/);
    }
  });
});

// The round-up (Jaimie's idea, 4 October 2026): one button by the total offering the NEXT milestone
// only: half a bag (£25), then a full bag (£50), then the next whole bag. It is simply extra money.
// It keeps its TARGET: the extra is whatever takes the donor's own items up to that target.
describe("rounding up: the next milestone", () => {
  it("is nothing for an empty bag", () => {
    expect(rb.nextMilestone(0)).toBe(0);
    expect(rb.roundUpOffer(0)).toBeNull();
    expect(rb.nextMilestone(-5)).toBe(0);
  });

  it("is half a bag from 1p to just under £25", () => {
    expect(rb.roundUpOffer(1)).toEqual({ target: 2500, add: 2499, words: "Round up to half a bag" });
    expect(rb.roundUpOffer(199)).toEqual({ target: 2500, add: 2301, words: "Round up to half a bag" });
    expect(rb.roundUpOffer(200)).toEqual({ target: 2500, add: 2300, words: "Round up to half a bag" });
    expect(rb.roundUpOffer(1800)).toEqual({ target: 2500, add: 700, words: "Round up to half a bag" });
    expect(rb.roundUpOffer(2499)).toEqual({ target: 2500, add: 1, words: "Round up to half a bag" });
  });

  it("is a full bag from £25 to just under £50", () => {
    expect(rb.roundUpOffer(2500)).toEqual({ target: 5000, add: 2500, words: "Round up to a full bag" });
    expect(rb.roundUpOffer(2501)).toEqual({ target: 5000, add: 2499, words: "Round up to a full bag" });
    expect(rb.roundUpOffer(4999)).toEqual({ target: 5000, add: 1, words: "Round up to a full bag" });
  });

  it("is always the next whole bag from £50", () => {
    expect(rb.roundUpOffer(5000)).toEqual({ target: 10000, add: 5000, words: "Round up to 2 full bags" });
    expect(rb.roundUpOffer(5001)).toEqual({ target: 10000, add: 4999, words: "Round up to 2 full bags" });
    expect(rb.roundUpOffer(9999)).toEqual({ target: 10000, add: 1, words: "Round up to 2 full bags" });
    expect(rb.roundUpOffer(10000)).toEqual({ target: 15000, add: 5000, words: "Round up to 3 full bags" });
    expect(rb.roundUpOffer(36000)).toEqual({ target: 40000, add: 4000, words: "Round up to 8 full bags" });
  });

  it("never offers nothing, and never the milestone the total already sits on", () => {
    for (const p of [1, 199, 200, 2499, 2500, 2501, 4999, 5000, 5001, 9999, 10000, 123456]) {
      const offer = rb.roundUpOffer(p)!;
      expect(offer.add, String(p)).toBeGreaterThan(0);
      expect(offer.target, String(p)).toBe(p + offer.add);
      expect(offer.target, String(p)).toBe(rb.nextMilestone(p));
      expect(Number.isInteger(offer.add), String(p)).toBe(true);
    }
  });

  it("names each milestone plainly", () => {
    expect(rb.milestoneWords(2500)).toBe("half a bag");
    expect(rb.milestoneWords(5000)).toBe("a full bag");
    expect(rb.milestoneWords(10000)).toBe("2 full bags");
    expect(rb.milestoneWords(15000)).toBe("3 full bags");
  });

  it("is honest: the round-up is extra money, and buys nothing", () => {
    expect(rb.WORDS.roundUp).toBe("A little extra to round up");
    for (const p of [1, 2500, 5000, 10000]) expect(rb.roundUpOffer(p)!.words).not.toMatch(/\b(will|buy|buys|pay|pays)\b/i);
  });
});

describe("rounding up: the top-up for a target", () => {
  it("is what takes the donor's own items up to the target, in whole pence", () => {
    expect(rb.roundUpPence(1800, 2500)).toBe(700);
    expect(rb.roundUpPence(1, 2500)).toBe(2499);
    expect(rb.roundUpPence(10, 2500)).toBe(2490);
    expect(rb.roundUpPence(1890, 2500)).toBe(610);
    expect(rb.roundUpPence(2499, 2500)).toBe(1);
    expect(rb.roundUpPence(5001, 10000)).toBe(4999);
  });

  it("shrinks as items go in, and grows back as they come out, so the total stays at the target", () => {
    for (const own of [1800, 1900, 2400, 2499, 1000, 10, 1]) expect(own + rb.roundUpPence(own, 2500), String(own)).toBe(2500);
  });

  // Jaimie, 4 October 2026: emptying the bag clears the round-up. There is nothing to round up.
  it("never stands alone: with none of the donor's own choices in the bag it is nothing", () => {
    expect(rb.roundUpPence(0, 2500)).toBe(0);
    expect(rb.roundUpPence(0, 5000)).toBe(0);
    expect(rb.roundUpPence(0, 10000)).toBe(0);
    expect(rb.roundUpPence(-5, 2500)).toBe(0);
  });

  it("is nothing once the donor's own items reach or pass the target", () => {
    expect(rb.roundUpPence(2500, 2500)).toBe(0);
    expect(rb.roundUpPence(2501, 2500)).toBe(0);
    expect(rb.roundUpPence(9900, 5000)).toBe(0);
  });

  it("is nothing with no target", () => {
    expect(rb.roundUpPence(1800, 0)).toBe(0);
    expect(rb.roundUpPence(1800, undefined as unknown as number)).toBe(0);
    expect(rb.roundUpPence(1800, -2500)).toBe(0);
  });

  it("never stacks: a bigger round-up replaces the smaller, it is not added to it", () => {
    const own = 1800;
    const first = rb.roundUpOffer(own)!; // half a bag
    const afterFirst = own + rb.roundUpPence(own, first.target);
    expect(afterFirst).toBe(2500);
    const second = rb.roundUpOffer(afterFirst)!; // a full bag, offered on the rounded total
    expect(second).toEqual({ target: 5000, add: 2500, words: "Round up to a full bag" });
    expect(own + rb.roundUpPence(own, second.target)).toBe(5000);
    expect(rb.roundUpPence(own, second.target)).toBe(3200);
  });
});

describe("the words that must not change", () => {
  it("has the elves line word for word", () => {
    expect(rb.WORDS.elves).toBe(
      "Our elves use your gift wherever it's needed most, so the items are a taste of what it could do, not a shopping list.",
    );
  });

  it("names who it is for, word for word", () => {
    expect(rb.WORDS.audience).toBe("children, young people and vulnerable adults");
  });

  it("has the nudge word for word", () => {
    expect(rb.WORDS.nudge).toBe("Add a little more to reach £2. Maybe some socks?");
  });

  it("shows pounds plainly", () => {
    expect(rb.pounds(0)).toBe("£0");
    expect(rb.pounds(10)).toBe("10p");
    expect(rb.pounds(800)).toBe("£8");
    expect(rb.pounds(5410)).toBe("£54.10");
    expect(rb.pounds(125000)).toBe("£1,250");
  });
});
