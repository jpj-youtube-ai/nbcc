import { describe, it, expect } from "vitest";
import { redBag } from "../../src/red-bag/catalogue";
import { redBagList, type RedBagList } from "../../src/red-bag/list";

// Fill a Red Bag: the list staff can edit (assets/js/red-bag-list.js, read by the server through
// src/red-bag/list.ts and by the admin screen in the browser). Pure rules only: what a list may
// hold, what differs between two lists, and the list as the page's catalogue reads it. Every name
// and price here is invented, apart from the built-in list itself.

const L = redBagList();
const rb = redBag();
const original = (): RedBagList => L.builtIn();
const problems = (list: unknown) => L.validate(list).map((p) => p.message);
const item = (list: RedBagList, key: string) => list.items.find((i) => i.key === key)!;
const example = (list: RedBagList, key: string) => list.examples.find((e) => e.key === key)!;
const added = (over: Partial<RedBagList["items"][number]> = {}) => ({ key: "n-selection-box-a1b2c", name: "Selection box", pence: 300, group: "home", art: "present", hidden: false, ...over });

describe("the built-in list, as a list staff can edit", () => {
  it("is the catalogue's own thirteen items and nine examples, each with its own drawing, all showing", () => {
    const list = original();
    expect(list.v).toBe(1);
    expect(list.items.map((i) => [i.key, i.name, i.pence, i.group])).toEqual(
      rb.GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.name, i.pence, g.key])),
    );
    expect(list.examples.map((e) => [e.key, e.pence, e.words, e.theme])).toEqual(
      rb.THEMES.flatMap((t) => t.examples.map((e) => [e.key, e.pence, e.words, t.key])),
    );
    for (const x of [...list.items, ...list.examples]) {
      expect(x.art).toBe(x.key);
      expect(x.hidden).toBe(false);
    }
  });

  it("passes its own rules", () => {
    expect(problems(original())).toEqual([]);
  });

  it("is a fresh copy every time: changing one never changes the next", () => {
    const a = original();
    a.items[0].name = "Changed";
    expect(original().items[0].name).toBe("Blanket");
  });
});

describe("what a list may hold", () => {
  it("takes a price from 10p to £500, in whole pence", () => {
    for (const pence of [10, 1200, 50000]) {
      const list = original();
      item(list, "toy").pence = pence;
      expect(problems(list)).toEqual([]);
    }
    for (const pence of [9, 0, -5, 50001, 12.5, NaN, "1200", null]) {
      const list = original();
      (item(list, "toy") as { pence: unknown }).pence = pence;
      expect(problems(list), String(pence)).toEqual(["A price must be between 10p and £500."]);
    }
  });

  it("takes an example's amount from £1 to £1,000, in whole pence", () => {
    for (const pence of [100, 3550, 100000]) {
      const list = original();
      example(list, "crisis-30").pence = pence;
      expect(problems(list)).toEqual([]);
    }
    for (const pence of [99, 0, 100001, 10.5]) {
      const list = original();
      example(list, "crisis-30").pence = pence;
      expect(problems(list), String(pence)).toEqual(["An amount must be between £1 and £1,000."]);
    }
  });

  it("wants a name of 1 to 40 characters once the spaces round it are gone", () => {
    const list = original();
    item(list, "toy").name = "   ";
    expect(problems(list)).toEqual(["Give this item a name."]);
    item(list, "toy").name = "x".repeat(40);
    expect(problems(list)).toEqual([]);
    item(list, "toy").name = "x".repeat(41);
    expect(problems(list)).toEqual(["A name can be 40 characters at most."]);
  });

  it("refuses angle brackets and control characters in a name or an example", () => {
    for (const bad of ["Toy <b>", "Toy > train", "Toy\u0007"]) {
      const list = original();
      item(list, "toy").name = bad;
      expect(problems(list), bad).toEqual(["Leave out < and > and anything that is not plain text."]);
    }
    const list = original();
    example(list, "crisis-30").words = "could help with <i>bedding</i>";
    expect(problems(list)).toEqual(["Leave out < and > and anything that is not plain text."]);
  });

  it("keeps the wording rules on names and examples: never will, never buy, no long dashes", () => {
    const cases: Array<[string, string]> = [
      ["A toy that will last", 'Say "could", never "will": these are examples, not promises.'],
      ["Buy a toy", 'Leave out "buy", "buys" and "bought": nothing is bought item by item.'],
      ["Toy — wooden", "Use a comma or a full stop, not a long dash."],
      ["Toy – wooden", "Use a comma or a full stop, not a long dash."],
    ];
    for (const [name, message] of cases) {
      const list = original();
      item(list, "toy").name = name;
      expect(problems(list), name).toEqual([message]);
    }
    for (const words of ["could help and will buy a coat", "could help buy a coat", "could help with what a family bought", "could help — with a coat"]) {
      const list = original();
      example(list, "school-35").words = words;
      expect(problems(list).length, words).toBe(1);
    }
    // Words that only contain the letters are fine: "willow", "buyer" is not a rule's business.
    const fine = original();
    item(fine, "toy").name = "Willow basket";
    expect(problems(fine)).toEqual([]);
  });

  it("the same wording rules in one function, for the page's tests to share", () => {
    expect(L.wordingProblem("could help with a warm coat")).toBe("");
    expect(L.wordingProblem("this will help")).toMatch(/never "will"/);
    expect(L.wordingProblem("it buys a coat")).toMatch(/Leave out "buy"/);
    expect(L.wordingProblem("a coat — warm")).toMatch(/long dash/);
    // Every word the public page already says passes them.
    for (const i of rb.items()) expect(L.wordingProblem(i.name), i.name).toBe("");
    for (const e of rb.examples()) expect(L.wordingProblem(e.words), e.words).toBe("");
  });

  it("makes every example read could help, with up to 90 characters after it", () => {
    const list = original();
    example(list, "crisis-30").words = "helps with fresh bedding";
    expect(problems(list)).toEqual(['An example must read "could help" and then what with.']);
    example(list, "crisis-30").words = "could help";
    expect(problems(list)).toEqual(["Say what it could help with."]);
    example(list, "crisis-30").words = "could help " + "x".repeat(90);
    expect(problems(list)).toEqual([]);
    example(list, "crisis-30").words = "could help " + "x".repeat(91);
    expect(problems(list)).toEqual(["This can be 90 characters at most."]);
  });

  it("wants at least one item showing", () => {
    const list = original();
    for (const i of list.items) i.hidden = true;
    expect(problems(list)).toEqual(["At least one item must be showing."]);
    list.items[3].hidden = false;
    expect(problems(list)).toEqual([]);
  });

  it("refuses two items showing with the same name, however it is typed, but not when one is hidden", () => {
    const list = original();
    item(list, "book").name = "  blanket ";
    expect(problems(list)).toEqual(["Two items showing cannot have the same name."]);
    item(list, "book").hidden = true;
    expect(problems(list)).toEqual([]);
  });

  it("holds 30 items and 6 examples in a theme at most", () => {
    const list = original();
    for (let n = 0; list.items.length < 30; n += 1) list.items.push(added({ key: `n-extra-${n}`, name: `Extra ${n}` }));
    expect(problems(list)).toEqual([]);
    list.items.push(added({ key: "n-one-too-many", name: "One too many" }));
    expect(problems(list)).toEqual(["The list can have 30 items at most."]);

    const many = original();
    for (let n = 0; n < 3; n += 1) many.examples.push({ key: `n-ex-${n}`, theme: "crisis", pence: 1000 + n, words: `could help with thing ${n}`, art: "present", hidden: false });
    expect(problems(many)).toEqual([]);
    many.examples.push({ key: "n-ex-9", theme: "crisis", pence: 1900, words: "could help with one more", art: "present", hidden: true });
    expect(problems(many)).toEqual(["A theme can have 6 examples at most."]);
  });

  it("keeps every item under one of the four headings and every example under one of the three themes", () => {
    const list = original();
    item(list, "toy").group = "garden";
    expect(problems(list)).toEqual([L.MESSAGES.broken]);
    const other = original();
    example(other, "hand-20").theme = "joy";
    expect(problems(other)).toEqual([L.MESSAGES.broken]);
  });

  it("takes a picture only from the drawings there are, or the present", () => {
    const list = original();
    item(list, "toy").art = "present";
    item(list, "book").art = "crisis-60";
    expect(problems(list)).toEqual([]);
    item(list, "book").art = "dragon";
    expect(problems(list)).toEqual([L.MESSAGES.broken]);
    expect(L.artKeys()).toContain("present");
    expect(L.artKeys().length).toBe(Object.keys(rb.ART).length);
  });

  it("keeps keys unique and stable: a new one starts n- and can never be a built-in key or a drawing's", () => {
    const list = original();
    list.items.push(added());
    expect(problems(list)).toEqual([]);
    // The same key twice.
    list.items.push(added({ name: "Another" }));
    expect(problems(list)).toEqual([L.MESSAGES.broken]);
    // A key that is not built in and does not start n-.
    for (const key of ["present", "selection-box", "N-Shouty", "n-", "n-has space", "hand-999", "__proto__", "n-" + "x".repeat(60)]) {
      const bad = original();
      bad.items.push(added({ key }));
      expect(problems(bad), key).toEqual([L.MESSAGES.broken]);
    }
    // A built-in example's key cannot be an item's, nor an item's an example's.
    const swapped = original();
    swapped.items.push(added({ key: "crisis-15" }));
    swapped.examples = swapped.examples.filter((e) => e.key !== "crisis-15");
    expect(problems(swapped)).toEqual([L.MESSAGES.broken]);
    // A built-in example stays in its own theme.
    const moved = original();
    example(moved, "crisis-15").theme = "hand";
    expect(problems(moved)).toEqual([L.MESSAGES.broken]);
  });

  it("no built-in key, drawing or elf note could ever be mistaken for a new key", () => {
    const taken = [...rb.items().map((i) => i.key), ...rb.examples().map((e) => e.key), ...Object.keys(rb.ART), ...Object.keys(rb.NOTES.items), ...Object.keys(rb.NOTES.things)];
    for (const key of taken) expect(key.startsWith("n-"), key).toBe(false);
  });

  it("makes a key for a new item from its name, never one already taken", () => {
    const key = L.newKey("Selection box!", [], () => 0.5);
    expect(key).toMatch(/^n-selection-box-[a-z0-9]{5}$/);
    const list = original();
    list.items.push(added({ key }));
    expect(problems(list)).toEqual([]);
    let n = 0;
    const second = L.newKey("Selection box!", [key], () => (n++ < 5 ? 0.5 : 0.25));
    expect(second).not.toBe(key);
    expect(L.newKey("£££", [], () => 0.1)).toMatch(/^n-item-[a-z0-9]{5}$/);
  });

  it("refuses anything that is not a list at all, and says where each problem is", () => {
    for (const bad of [null, undefined, "list", 7, [], {}, { items: [] }, { items: "x", examples: [] }]) {
      expect(problems(bad), JSON.stringify(bad)).toEqual([L.MESSAGES.broken]);
    }
    const list = original();
    item(list, "toy").pence = 5;
    example(list, "hand-20").words = "nope";
    expect(L.validate(list).map((p) => [p.kind, p.key, p.field])).toEqual([
      ["item", "toy", "pence"],
      ["example", "hand-20", "words"],
    ]);
  });
});

describe("tidying what was sent", () => {
  it("keeps only what a list holds, trims names and words, and turns runs of space into one", () => {
    const raw = {
      v: 1,
      extra: "ignored",
      items: [{ key: "toy", name: "  Wooden \t toy\n", pence: 1200, group: "play", art: "toy", hidden: 0, script: "x" }],
      examples: [{ key: "hand-20", theme: "hand", pence: 2000, words: " could  help   with soap ", art: "hand-20" }],
    };
    expect(L.clean(raw)).toEqual({
      v: 1,
      items: [{ key: "toy", name: "Wooden toy", pence: 1200, group: "play", art: "toy", hidden: false }],
      examples: [{ key: "hand-20", theme: "hand", pence: 2000, words: "could help with soap", art: "hand-20", hidden: false }],
    });
    expect(L.clean("no")).toBeNull();
    expect(L.clean({ items: [null], examples: [] })).toBeNull();
  });

  it("knows two lists are the same whatever order their fields came in", () => {
    const a = original();
    const b = JSON.parse(JSON.stringify(original())) as RedBagList;
    b.items[0] = { hidden: false, art: "blanket", group: "home", pence: 800, name: "Blanket", key: "blanket" };
    expect(L.same(a, b)).toBe(true);
    b.items[0].pence = 801;
    expect(L.same(a, b)).toBe(false);
  });
});

describe("pounds as typed", () => {
  it("reads £12, 12, 12.5, 12.50, 0.10 and 10p", () => {
    expect(L.parsePounds("£12")).toBe(1200);
    expect(L.parsePounds(" 12 ")).toBe(1200);
    expect(L.parsePounds("12.5")).toBe(1250);
    expect(L.parsePounds("12.50")).toBe(1250);
    expect(L.parsePounds("0.10")).toBe(10);
    expect(L.parsePounds("10p")).toBe(10);
    expect(L.parsePounds("1,000")).toBe(100000);
    expect(L.parsePounds("19.99")).toBe(1999);
  });

  it("is nothing for anything else", () => {
    for (const t of ["", "abc", "12.345", "-3", "£", "1.2.3", "p"]) expect(L.parsePounds(t), t).toBeNull();
  });

  it("writes a price back for its box: 12, 12.50, 0.10", () => {
    expect(L.poundsBox(1200)).toBe("12");
    expect(L.poundsBox(1250)).toBe("12.50");
    expect(L.poundsBox(10)).toBe("0.10");
  });
});

describe("what differs between the website's list and the draft", () => {
  const lines = (draft: RedBagList, website: RedBagList = original()) => L.diff(website, draft).map((d) => d.text);

  it("is nothing when nothing has changed", () => {
    expect(lines(original())).toEqual([]);
    expect(L.countLine(0)).toBe("No changes. This is what the website shows now.");
  });

  it("says a changed price as old then new", () => {
    const d = original();
    item(d, "toy").pence = 1200;
    expect(lines(d)).toEqual(["Toy £15 → £12"]);
  });

  it("says a new item with its price", () => {
    const d = original();
    d.items.push(added());
    expect(lines(d)).toEqual(["New: Selection box £3"]);
  });

  it("says hidden, and shown again", () => {
    const d = original();
    item(d, "hat-gloves").hidden = true;
    expect(lines(d)).toEqual(["Hidden: Hat & gloves"]);
    expect(lines(original(), d)).toEqual(["Shown again: Hat & gloves"]);
  });

  it("says a move from one heading to another by their names", () => {
    const d = original();
    item(d, "notebook").group = "home";
    expect(lines(d)).toEqual(["Moved: Notebook, from Books & creativity to Home comforts"]);
  });

  it("says a new name, a new picture, and a new order under a heading", () => {
    const d = original();
    item(d, "toy").name = "Wooden toy";
    item(d, "book").art = "present";
    const at = d.items.findIndex((i) => i.key === "socks");
    const [socks] = d.items.splice(at, 1);
    d.items.splice(d.items.findIndex((i) => i.key === "pyjamas"), 0, socks);
    expect(lines(d)).toEqual(["Renamed: Toy → Wooden toy", "Picture changed: Book", "Order changed: Clothing"]);
  });

  it("does not call it a new order when an item only joins or leaves a heading", () => {
    const d = original();
    item(d, "notebook").group = "home";
    d.items.push(added({ group: "books" }));
    expect(lines(d).some((t) => t.startsWith("Order changed"))).toBe(false);
  });

  it("says an item that has gone (an older list put back)", () => {
    const website = original();
    website.items.push(added());
    expect(lines(original(), website)).toEqual(["Removed: Selection box"]);
  });

  it("says a changed example as the whole sentence, old then new", () => {
    const d = original();
    example(d, "crisis-30").pence = 3500;
    example(d, "crisis-30").words = "could help with warm bedding for a child";
    expect(lines(d)).toEqual(["Example changed: £30 could help with fresh bedding for a child → £35 could help with warm bedding for a child"]);
  });

  it("says a new, hidden, shown again, removed, re-pictured and re-ordered example", () => {
    const d = original();
    d.examples.push({ key: "n-ex-1", theme: "school", pence: 2000, words: "could help with a school bag", art: "present", hidden: false });
    example(d, "hand-20").hidden = true;
    example(d, "hand-75").art = "present";
    const at = d.examples.findIndex((e) => e.key === "crisis-60");
    const [last] = d.examples.splice(at, 1);
    d.examples.unshift(last);
    expect(lines(d)).toEqual([
      "Example hidden: £20 could help with toiletries and warm clothes in a hard moment",
      "Example picture changed: £75 could help a young person take their first step into their own business",
      "New example: £20 could help with a school bag",
      "Example order changed: After a crisis",
    ]);
    expect(lines(original(), d)).toContain("Example removed: £20 could help with a school bag");
    expect(lines(original(), d)).toContain("Example shown again: £20 could help with toiletries and warm clothes in a hard moment");
  });

  it("counts the changes in words", () => {
    expect(L.countLine(1)).toBe("1 change not yet on the website");
    expect(L.countLine(2)).toBe("2 changes not yet on the website");
  });

  it("sums them up in one line for the history", () => {
    expect(L.summary([])).toBe("No changes");
    expect(L.summary([{ kind: "price", text: "Toy £15 → £12" }])).toBe("Toy £15 → £12");
    const four = ["a", "b", "c", "d"].map((text) => ({ kind: "x", text }));
    expect(L.summary(four)).toBe("a; b; c; and 1 more");
  });
});

describe("the list as the page reads it", () => {
  it("is the visible items under their headings and the visible examples under their themes, in order", () => {
    const d = original();
    item(d, "hat-gloves").hidden = true;
    item(d, "notebook").group = "home";
    d.items.push(added({ group: "play" }));
    example(d, "crisis-15").hidden = true;
    const c = L.toCatalogue(d);
    expect(c.groups.map((g) => [g.key, g.items.map((i) => i.key)])).toEqual([
      ["home", ["blanket", "insulated-cup", "toiletry-set", "notebook"]],
      ["play", ["toy", "soft-toy", "headphones", "n-selection-box-a1b2c"]],
      ["books", ["book", "colouring-book", "pencil"]],
      ["clothing", ["pyjamas", "socks"]],
    ]);
    expect(c.groups[1].items[3]).toEqual({ key: "n-selection-box-a1b2c", name: "Selection box", pence: 300, art: "present" });
    expect(c.themes.map((t) => [t.key, t.examples.map((e) => e.key)])).toEqual([
      ["crisis", ["crisis-30", "crisis-60"]],
      ["school", ["school-25", "school-35", "school-40"]],
      ["hand", ["hand-20", "hand-75", "hand-150"]],
    ]);
  });

  it("leaves a heading or a theme with nothing showing empty, for the page to leave out", () => {
    const d = original();
    for (const i of d.items) if (i.group === "clothing") i.hidden = true;
    for (const e of d.examples) if (e.theme === "hand") e.hidden = true;
    const c = L.toCatalogue(d);
    expect(c.groups.find((g) => g.key === "clothing")!.items).toEqual([]);
    expect(c.themes.find((t) => t.key === "hand")!.examples).toEqual([]);
  });
});
