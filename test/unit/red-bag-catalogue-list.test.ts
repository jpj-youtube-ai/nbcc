import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

// Fill a Red Bag: the catalogue script (assets/js/red-bag-catalogue.js) and the list staff publish.
// The server draws a small block of data into the page beside the rows; the script reads it as it
// starts. Here the script is run fresh each time, as a browser would run it, with and without a
// block, with a block that is wrong, and beside older and newer pages. Every name is invented.

const ROOT = resolve(__dirname, "../..");
const SOURCE = readFileSync(resolve(ROOT, "assets/js/red-bag-catalogue.js"), "utf8");

type Rb = Record<string, any>;

/** Run the script as a page would: `block` is the text of the data block, or undefined for none. */
function inBrowser(block?: string, source: string = SOURCE): Rb {
  const window: Record<string, unknown> = {};
  const document = {
    getElementById: (id: string) => (id === "rb-list-data" && block !== undefined ? { textContent: block } : null),
  };
  vm.runInNewContext(source, { window, document });
  return window.NBCCRedBag as Rb;
}

const published = () => ({
  groups: [
    { key: "home", items: [{ key: "blanket", name: "Blanket", pence: 800, art: "blanket" }, { key: "notebook", name: "Notebook", pence: 100, art: "notebook" }] },
    { key: "play", items: [{ key: "toy", name: "Wooden toy", pence: 1200, art: "toy" }, { key: "n-selection-box-a1b2c", name: "Selection box", pence: 300, art: "present" }] },
    { key: "books", items: [{ key: "pencil", name: "Pencil", pence: 10, art: "pencil" }] },
    { key: "clothing", items: [] },
  ],
  themes: [
    { key: "crisis", examples: [{ key: "crisis-30", pence: 3500, words: "could help with warm bedding for a child", art: "crisis-30" }] },
    { key: "school", examples: [{ key: "n-school-bag-9z9z9", pence: 2000, words: "could help with a school bag", art: "present" }] },
    { key: "hand", examples: [] },
  ],
});

describe("with no block in the page (today's page, and any page until staff publish)", () => {
  const rb = inBrowser();

  it("uses the list written in the file, exactly", () => {
    expect(rb.items().length).toBe(13);
    expect(rb.examples().length).toBe(9);
    expect(rb.totalPence({ toy: 1, socks: 2 }, ["hand-20"])).toBe(1500 + 200 + 2000);
    expect(rb.GROUPS.map((g: Rb) => g.heading)).toEqual(["Home comforts", "Play & downtime", "Books & creativity", "Clothing"]);
  });

  it("keeps a copy of that list that nothing changes", () => {
    expect(rb.BUILT_IN.groups.flatMap((g: Rb) => g.items).length).toBe(13);
    expect(rb.BUILT_IN.themes.flatMap((t: Rb) => t.examples).length).toBe(9);
  });

  it("is safe where there is no document at all (the server, a test)", () => {
    const window: Record<string, unknown> = {};
    vm.runInNewContext(SOURCE, { window });
    expect((window.NBCCRedBag as Rb).items().length).toBe(13);
  });
});

describe("with the published list in the page", () => {
  const rb = inBrowser(JSON.stringify(published()));

  it("adds up with the published prices, and counts a new item", () => {
    expect(rb.items().map((i: Rb) => [i.key, i.pence])).toEqual([
      ["blanket", 800],
      ["notebook", 100],
      ["toy", 1200],
      ["n-selection-box-a1b2c", 300],
      ["pencil", 10],
    ]);
    expect(rb.totalPence({ toy: 2, "n-selection-box-a1b2c": 3 }, [])).toBe(2400 + 900);
    // Something no longer on the list counts for nothing.
    expect(rb.totalPence({ socks: 4 }, ["hand-20"])).toBe(0);
    expect(rb.totalPence({}, ["crisis-30", "n-school-bag-9z9z9"])).toBe(3500 + 2000);
  });

  it("keeps the round-up, the bags and the words right for those sums", () => {
    const total = rb.totalPence({ toy: 2 }, []);
    expect(rb.roundUpOffer(total)).toEqual({ target: 2500, add: 100, words: "Round up to half a bag" });
    expect(rb.bags(rb.totalPence({ toy: 5 }, [])).full).toBe(1);
    expect(rb.statusLine(rb.totalPence({ "n-selection-box-a1b2c": 1 }, []))).toBe("Your bag is starting to fill.");
  });

  it("keeps the file's own headings and theme names, and leaves out one with nothing in it", () => {
    expect(rb.GROUPS.map((g: Rb) => [g.key, g.heading])).toEqual([
      ["home", "Home comforts"],
      ["play", "Play & downtime"],
      ["books", "Books & creativity"],
    ]);
    expect(rb.THEMES.map((t: Rb) => [t.key, t.title, t.sub])).toEqual([
      ["crisis", "After a crisis", "Helping families start again"],
      ["school", "Clothing & school", "When families can't stretch to it"],
    ]);
  });

  it("draws a new item with the picture chosen for it, and lets it peek from the bag", () => {
    expect(rb.art("n-selection-box-a1b2c")).toBe(rb.art("present"));
    expect(rb.art("n-selection-box-a1b2c")).toContain("<svg");
    expect(rb.art("n-school-bag-9z9z9", "rb-example__icon", 30)).toContain('width="30"');
    expect(rb.latestPeeks(["n-selection-box-a1b2c", "toy"], 0.4)).toEqual(["n-selection-box-a1b2c", "toy", null]);
    expect(rb.art("nothing-like-this")).toBe("");
  });

  it("writes only the general notes for a new item, and never a several note", () => {
    for (const roll of [0, 0.3, 0.69, 0.7, 0.99]) {
      const note = rb.noteFor({ kind: "in", key: "n-selection-box-a1b2c", quantity: 1, step: 1 }, "", roll);
      expect(rb.NOTES.general, `${roll}: ${note}`).toContain(note);
    }
    expect(rb.noteKind({ kind: "in", key: "n-selection-box-a1b2c", quantity: 3, step: 1 })).toBe("item");
    expect(rb.noteKind({ kind: "in", key: "n-selection-box-a1b2c", quantity: 10, step: 9 })).toBe("item");
    expect(rb.noteFor({ kind: "out", key: "n-selection-box-a1b2c", quantity: 0, step: 1 }, "", 0)).toBe(rb.NOTES.out[0]);
  });

  it("does not write a note about a toy beside an item no longer called Toy", () => {
    for (const roll of [0, 0.3, 0.69]) {
      expect(rb.NOTES.general).toContain(rb.noteFor({ kind: "in", key: "toy", quantity: 1, step: 1 }, "", roll));
    }
    expect(rb.noteKind({ kind: "in", key: "toy", quantity: 3, step: 1 })).toBe("item");
    // One whose name is as it was keeps its own notes.
    expect(rb.NOTES.items.pencil).toContain(rb.noteFor({ kind: "in", key: "pencil", quantity: 1, step: 1 }, "", 0));
    expect(rb.noteKind({ kind: "in", key: "pencil", quantity: 3, step: 1 })).toBe("several");
  });

  it("throws at nothing for a key it has never heard of", () => {
    expect(() => {
      rb.art("__proto__");
      rb.art("constructor");
      rb.noteFor({ kind: "in", key: "constructor", quantity: 3, step: 2 }, "", 0.2);
      rb.noteFor({ kind: "in", key: "__proto__", quantity: 1, step: 1 }, "", 0.2);
      rb.latestPeeks(["constructor", "toString", "n-nope"], 0.9);
      rb.totalPence({ constructor: 3, __proto__: 2 }, ["toString"]);
    }).not.toThrow();
    expect(rb.art("constructor")).toBe("");
    expect(rb.latestPeeks(["constructor", "toString", "n-nope"], 0.9)).toEqual([null, null, null]);
  });
});

describe("with a block that is not right, the list in the file stands", () => {
  const mangle = (change: (p: ReturnType<typeof published>) => void) => {
    const p = published();
    change(p);
    return JSON.stringify(p);
  };
  const cases: Array<[string, string]> = [
    ["not JSON at all", "{ groups: oops"],
    ["empty", ""],
    ["a list of nothing", "[]"],
    ["null", "null"],
    ["no themes", JSON.stringify({ groups: published().groups })],
    ["no items anywhere", mangle((p) => p.groups.forEach((g) => (g.items = [])))],
    ["a heading the file does not have", mangle((p) => (p.groups[0].key = "garden"))],
    ["the same heading twice", mangle((p) => (p.groups[1].key = "home"))],
    ["a theme the file does not have", mangle((p) => (p.themes[0].key = "joy"))],
    ["a price that is not whole pence", mangle((p) => (p.groups[0].items[0].pence = 7.5))],
    ["a price that is text", mangle((p) => ((p.groups[0].items[0] as Rb).pence = "800"))],
    ["a price of nothing", mangle((p) => (p.groups[0].items[0].pence = 0))],
    ["a name with markup in it", mangle((p) => (p.groups[0].items[0].name = "<b>Blanket</b>"))],
    ["an empty name", mangle((p) => (p.groups[0].items[0].name = ""))],
    ["the same key twice", mangle((p) => (p.groups[1].items[1].key = "toy"))],
    ["a key that is not a key", mangle((p) => (p.groups[0].items[0].key = "Blanket One"))],
    ["a picture there is no drawing for", mangle((p) => (p.groups[0].items[0].art = "dragon"))],
    ["an example that does not say could help", mangle((p) => (p.themes[0].examples[0].words = "will buy bedding"))],
    ["an item that is not an object", mangle((p) => ((p.groups[0].items as unknown[])[0] = "blanket"))],
  ];

  it.each(cases)("%s", (_what, block) => {
    const rb = inBrowser(block);
    expect(rb.items().map((i: Rb) => [i.key, i.pence])).toEqual(rb.BUILT_IN.groups.flatMap((g: Rb) => g.items).map((i: Rb) => [i.key, i.pence]));
    expect(rb.examples().length).toBe(9);
    expect(rb.totalPence({ toy: 1 }, ["hand-20"])).toBe(3500);
    expect(rb.GROUPS.length).toBe(4);
    expect(rb.art("toy")).toContain("<svg");
  });

  it("refuses a bad list handed to it later too, leaving the good one in use", () => {
    const rb = inBrowser(JSON.stringify(published()));
    expect(rb.useList({ groups: "no", themes: [] })).toBe(false);
    expect(rb.useList(null)).toBe(false);
    expect(rb.items().length).toBe(5);
    expect(rb.totalPence({ toy: 1 }, [])).toBe(1200);
  });
});

describe("old and new, side by side, while a new version goes out", () => {
  // The catalogue as it was before staff could edit the list: main, at the commit this was cut from.
  // It knows nothing of the block, so it must simply carry on with its own list.
  it("the page's script is content with the new catalogue: every part it asks for is still there", () => {
    const rb = inBrowser(JSON.stringify(published()));
    const pageScript = readFileSync(resolve(ROOT, "assets/js/red-bag.js"), "utf8");
    const used = new Set([...pageScript.matchAll(/\brb\.([A-Za-z_]+)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(10);
    for (const name of used) expect(rb[name], name).toBeDefined();
  });

  it("a new page beside the catalogue with no block reader: nothing to read it, nothing breaks", () => {
    // What an older copy of this file does with a newer page is exactly what this one does with no
    // block: it never looks for it. Proved by running this file where the block cannot be found.
    const old = inBrowser(undefined);
    expect(old.items().length).toBe(13);
    expect(old.totalPence({ "n-selection-box-a1b2c": 2, toy: 1 }, [])).toBe(1500);
  });

  it("the new catalogue on an older page (no block): the built-in list, as ever", () => {
    expect(inBrowser().items().length).toBe(13);
  });

  it("has the present among its drawings, in the same hand as the rest: shapes and the site's classes only", () => {
    const rb = inBrowser();
    expect(rb.ART.present).toBeTruthy();
    expect(rb.ART.present).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb|url\(|style=|fill=|stroke=|<script|on\w+=/);
    expect(rb.ART.present).toMatch(/class="r"/);
    expect(rb.ART.present).toMatch(/class="g/);
    const nums = [...rb.ART.present.matchAll(/(?:x|y|cx|cy)="([\d.]+)"/g)].map((m: RegExpMatchArray) => Number(m[1]));
    for (const n of nums) expect(n).toBeGreaterThanOrEqual(0), expect(n).toBeLessThanOrEqual(40);
  });
});
