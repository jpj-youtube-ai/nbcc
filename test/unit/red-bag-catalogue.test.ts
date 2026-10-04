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

  it("has the thirteen items at their starting prices", () => {
    expect(rb.items().map((i) => [i.name, i.pence])).toEqual([
      ["Blanket", 800],
      ["Insulated cup", 700],
      ["Toiletry & fragrance gift set", 500],
      ["Toy", 500],
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

describe("the four themes, as agreed", () => {
  it("has four themes of three examples each, with their amounts", () => {
    expect(rb.THEMES.map((t) => [t.title, t.sub, t.examples.map((e) => e.pence)])).toEqual([
      ["Red Bags Full of Joy", "For those going without at Christmas", [1000, 2500, 5000]],
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
    expect(words).toContain("£10 could help with cosy essentials like a hat, gloves and socks");
    expect(words).toContain("£60 could help a family with kitchen basics to start again");
    expect(words).toContain("£40 could help a child start school in a uniform that fits");
    expect(words).toContain("£150 could help towards a bed or cooker for someone moving into a home with nothing");
  });
});

describe("the total, in pence", () => {
  it("is nothing for an empty bag", () => {
    expect(rb.totalPence({}, [])).toBe(0);
  });

  it("is £54.10 for one of everything", () => {
    expect(rb.totalPence(oneOfEverything(), [])).toBe(5410);
  });

  it("never drifts: 99 pencils at 10p are exactly £9.90, and three are 30p", () => {
    expect(rb.totalPence({ pencil: 99 }, [])).toBe(990);
    expect(rb.totalPence({ pencil: 3 }, [])).toBe(30);
    expect(Number.isInteger(rb.totalPence({ pencil: 7, book: 3, socks: 11 }, ["joy-10"]))).toBe(true);
  });

  it("adds the examples tapped to the items", () => {
    expect(rb.totalPence({ socks: 2 }, ["joy-10", "crisis-15"])).toBe(200 + 1000 + 1500);
  });

  it("counts an example once however often it is named, and ignores what it does not know", () => {
    expect(rb.totalPence({ nonsense: 4 }, ["joy-10", "joy-10", "nope"])).toBe(1000);
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
