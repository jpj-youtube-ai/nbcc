// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderRedBagPage, renderRedBagThanksPage } from "../../src/red-bag/render";

// Fill a Red Bag, the feel good layer: the drawings, what peeks out of the bag, which milestone was
// just crossed, and the elf's notes. All of it is decoration: it changes no price, no total and no
// word the donor already reads. The sums and the choices are pure functions in the one catalogue
// (assets/js/red-bag-catalogue.js); the page script (test/unit/red-bag-delight-script.test.ts) only
// applies them. Every fixture here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const rb = require(resolve(ROOT, "assets/js/red-bag-catalogue.js"));
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const css = read("assets/css/red-bag.css").replace(/\/\*[\s\S]*?\*\//g, "");
const html = renderRedBagPage(read("fill-a-red-bag.html"), { preview: false });
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const itemKeys: string[] = rb.items().map((i: { key: string }) => i.key);
const exampleKeys: string[] = rb.examples().map((e: { key: string }) => e.key);

describe("the drawings", () => {
  it("has one for every item on the list and every example, and nothing else", () => {
    expect(Object.keys(rb.ART).sort()).toEqual([...itemKeys, ...exampleKeys].sort());
    expect(itemKeys.length).toBe(13);
    expect(exampleKeys.length).toBe(9);
  });

  it("draws each as one inline picture, for the eye only, never in the tab order", () => {
    for (const key of [...itemKeys, ...exampleKeys]) {
      const svg = rb.art(key);
      const d = new DOMParser().parseFromString(svg, "text/html");
      expect(d.body.children.length, key).toBe(1);
      const el = d.body.firstElementChild!;
      expect(el.tagName.toLowerCase()).toBe("svg");
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(el.getAttribute("focusable")).toBe("false");
      expect(el.getAttribute("viewBox")).toBe("0 0 40 40");
      expect(el.classList.contains("rb-art")).toBe(true);
      expect(el.querySelectorAll("path, rect, circle, ellipse").length).toBeGreaterThan(2);
    }
  });

  it("is drawn in the page's own colours: no colour, picture, text or link of its own", () => {
    for (const key of Object.keys(rb.ART)) {
      const svg = rb.art(key);
      expect(svg, key).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb|url\(|href|<image|<text|<script|style=|fill=|stroke=/);
    }
  });

  it("is nothing for a key it does not know, and takes a class and a size", () => {
    expect(rb.art("no-such-thing")).toBe("");
    expect(rb.art("socks", "rb-x", 30)).toMatch(/^<svg class="rb-art rb-x" viewBox="0 0 40 40" width="30" height="30"/);
  });
});

describe("the icon beside each example", () => {
  it("is in the page itself, one in each of the nine buttons, before the amount", () => {
    const buttons = [...doc.querySelectorAll("button[data-rb-example]")];
    expect(buttons.length).toBe(9);
    for (const b of buttons) {
      const icons = b.querySelectorAll("svg");
      expect(icons.length).toBe(1);
      expect(icons[0].classList.contains("rb-example__icon")).toBe(true);
      expect(icons[0].classList.contains("rb-art")).toBe(true);
      expect(icons[0].getAttribute("aria-hidden")).toBe("true");
      expect(icons[0].getAttribute("focusable")).toBe("false");
      expect(b.firstElementChild).toBe(icons[0]);
      expect(b.querySelectorAll("[tabindex], a, button").length).toBe(0);
    }
  });

  it("is the drawing for that example", () => {
    for (const key of exampleKeys) {
      const b = doc.querySelector(`button[data-rb-example="${key}"]`)!;
      expect(b.querySelector("svg")!.innerHTML).toBe(new DOMParser().parseFromString(rb.art(key), "text/html").body.firstElementChild!.innerHTML);
    }
  });

  it("leaves the button's name, and what it says, exactly as they were", () => {
    for (const e of rb.examples()) {
      const b = doc.querySelector(`button[data-rb-example="${e.key}"]`)!;
      expect(norm(b.textContent)).toBe(`${rb.pounds(e.pence)} ${e.words}`);
      expect(b.hasAttribute("aria-label")).toBe(false);
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("keeps its size when the words wrap, sits in the middle, and turns light on the pressed green", () => {
    expect(css).toMatch(/\.rb-example__icon\{[^}]*flex:0 0 auto/);
    expect(css).toMatch(/\.rb-example__icon\{[^}]*align-self:center/);
    expect(css).toMatch(/\.rb-example\[aria-pressed="true"\] \.rb-art\{[^}]*stroke:var\(--cream\)/);
  });

  it("is not on the thank you page", () => {
    const thanks = renderRedBagThanksPage(read("fill-thank-you.html"), { preview: false });
    expect(thanks).not.toContain("rb-art");
  });
});

describe("what peeks out of the bag", () => {
  it("shows more as the bag fills, three at most, and nothing once it is tied", () => {
    expect(rb.peekCount(0)).toBe(0);
    expect(rb.peekCount(0.002)).toBe(1);
    expect(rb.peekCount(0.24)).toBe(1);
    expect(rb.peekCount(0.25)).toBe(2);
    expect(rb.peekCount(0.49)).toBe(2);
    expect(rb.peekCount(0.5)).toBe(3);
    expect(rb.peekCount(0.99)).toBe(3);
    expect(rb.peekCount(1)).toBe(0);
  });

  // The owner, 5 October 2026: "the prizes at the top of the bag should be the last (latest) item(s)
  // to be added, not the first". The list is the items in the bag, the newest first.
  describe("the order things went in (peekOrder)", () => {
    const table: Array<[string, string[], string, number, number, string[]]> = [
      ["the first thing in", [], "socks", 0, 1, ["socks"]],
      ["a new thing goes to the front", ["socks"], "book", 0, 1, ["book", "socks"]],
      ["and the next in front of that", ["book", "socks"], "soft-toy", 0, 1, ["soft-toy", "book", "socks"]],
      ["more of one already in the bag makes it the latest again", ["soft-toy", "book", "socks"], "socks", 1, 2, ["socks", "soft-toy", "book"]],
      ["more of the one already at the front leaves it there", ["socks", "book"], "socks", 2, 3, ["socks", "book"]],
      ["a typed jump up counts as one add", ["book", "socks"], "socks", 1, 40, ["socks", "book"]],
      ["one taken out, with some left, changes nothing", ["soft-toy", "book", "socks"], "socks", 3, 2, ["soft-toy", "book", "socks"]],
      ["the last one taken out removes it", ["soft-toy", "book", "socks"], "book", 1, 0, ["soft-toy", "socks"]],
      ["a typed drop to nothing removes it", ["soft-toy", "book", "socks"], "soft-toy", 7, 0, ["book", "socks"]],
      ["standing still changes nothing", ["book", "socks"], "socks", 2, 2, ["book", "socks"]],
      ["nothing to nothing adds nothing", ["book"], "socks", 0, 0, ["book"]],
      ["a key it has not seen, going up, is simply added", ["book"], "socks", 4, 5, ["socks", "book"]],
    ];
    it.each(table)("%s", (_name, order, key, was, now, want) => {
      const before = [...order];
      expect(rb.peekOrder(order, key, was, now)).toEqual(want);
      expect(order).toEqual(before);
    });

    it("starts from nothing when it is given nothing", () => {
      expect(rb.peekOrder(null, "socks", 0, 1)).toEqual(["socks"]);
      expect(rb.peekOrder(undefined, "socks", 1, 0)).toEqual([]);
    });
  });

  describe("which things peek, and where (latestPeeks)", () => {
    // Place 0 is the front: the newest. Then the one before it, then the one before that.
    const table: Array<[string, string[], number, Array<string | null>]> = [
      ["an empty bag shows nothing", [], 0.6, [null, null, null]],
      ["one thing, in the front place", ["socks"], 0.02, ["socks", null, null]],
      ["the newest only while the bag is under a quarter full", ["soft-toy", "book", "socks"], 0.2, ["soft-toy", null, null]],
      ["the newest two from a quarter", ["soft-toy", "book", "socks"], 0.3, ["soft-toy", "book", null]],
      ["the newest three from half", ["soft-toy", "book", "socks"], 0.6, ["soft-toy", "book", "socks"]],
      ["more than three in the bag: the oldest are the ones left out", ["blanket", "soft-toy", "book", "socks", "pencil"], 0.9, ["blanket", "soft-toy", "book"]],
      ["one taken right out: the next most recent takes the free place", ["blanket", "book", "socks", "pencil"], 0.9, ["blanket", "book", "socks"]],
      ["a full bag is tied, so nothing peeks from it", ["soft-toy", "book", "socks"], 1, [null, null, null]],
      ["a new bag after a full one still shows the latest overall", ["soft-toy", "book", "socks"], 0.04, ["soft-toy", null, null]],
      ["each thing at most once", ["socks", "book", "socks", "socks", "toy"], 0.9, ["socks", "book", "toy"]],
      ["only things with a drawing", ["nonsense", "socks"], 0.9, ["socks", null, null]],
    ];
    it.each(table)("%s", (_name, order, fill, want) => {
      const before = [...order];
      expect(rb.latestPeeks(order, fill)).toEqual(want);
      expect(order).toEqual(before);
    });

    it("always gives three places", () => {
      expect(rb.latestPeeks(null, 0.6)).toEqual([null, null, null]);
      expect(rb.MAX_PEEKS).toBe(3);
    });

    it("follows the owner's own example: socks, a book, a soft toy, then a blanket", () => {
      let order: string[] = [];
      for (const key of ["socks", "book", "soft-toy"]) order = rb.peekOrder(order, key, 0, 1);
      expect(rb.latestPeeks(order, 0.6)).toEqual(["soft-toy", "book", "socks"]);
      order = rb.peekOrder(order, "blanket", 0, 1);
      expect(rb.latestPeeks(order, 0.6)).toEqual(["blanket", "soft-toy", "book"]);
      // More socks: the socks are the latest again.
      order = rb.peekOrder(order, "socks", 1, 2);
      expect(rb.latestPeeks(order, 0.6)).toEqual(["socks", "blanket", "soft-toy"]);
      // The blanket taken right out: the book comes back.
      order = rb.peekOrder(order, "blanket", 1, 0);
      expect(rb.latestPeeks(order, 0.6)).toEqual(["socks", "soft-toy", "book"]);
    });
  });
});

describe("the handles straining", () => {
  it("is only when the bag is nearly full, and not once it is full", () => {
    expect(rb.strains(0)).toBe(false);
    expect(rb.strains(0.87)).toBe(false);
    expect(rb.strains(0.88)).toBe(true);
    expect(rb.strains(0.99)).toBe(true);
    expect(rb.strains(1)).toBe(false);
  });
});

describe("the milestone just crossed", () => {
  it("is half a bag, then every full bag, and only on the way up", () => {
    expect(rb.milestoneCrossed(0, 2499)).toBe(0);
    expect(rb.milestoneCrossed(2499, 2500)).toBe(2500);
    expect(rb.milestoneCrossed(2500, 2600)).toBe(0);
    expect(rb.milestoneCrossed(2600, 4999)).toBe(0);
    expect(rb.milestoneCrossed(4999, 5000)).toBe(5000);
    expect(rb.milestoneCrossed(5000, 7500)).toBe(0);
    expect(rb.milestoneCrossed(9990, 10000)).toBe(10000);
    expect(rb.milestoneCrossed(10000, 15010)).toBe(15000);
  });

  it("is the highest one when several are passed at once", () => {
    expect(rb.milestoneCrossed(0, 2500)).toBe(2500);
    expect(rb.milestoneCrossed(0, 5410)).toBe(5000);
    expect(rb.milestoneCrossed(2400, 12000)).toBe(10000);
  });

  it("is nothing on the way down, or standing still", () => {
    expect(rb.milestoneCrossed(2500, 2499)).toBe(0);
    expect(rb.milestoneCrossed(6000, 4000)).toBe(0);
    expect(rb.milestoneCrossed(2500, 2500)).toBe(0);
    expect(rb.milestoneCrossed(5000, 5000)).toBe(0);
  });

  it("comes again once the total has dropped below it and come back", () => {
    expect(rb.milestoneCrossed(2500, 2400)).toBe(0);
    expect(rb.milestoneCrossed(2400, 2500)).toBe(2500);
  });
});

// The owner, 5 October 2026: "make the star moment across the entire page: a bigger moment".
describe("the snow and stars: which, when and how many", () => {
  it("is the big one for every full bag and the lighter one for half a bag", () => {
    expect(rb.flurryKind(2500)).toBe("half");
    expect(rb.flurryKind(5000)).toBe("full");
    expect(rb.flurryKind(10000)).toBe("full");
    expect(rb.flurryKind(25000)).toBe("full");
    expect(rb.flurryKind(0)).toBe("");
    expect(rb.flurryKind(1234)).toBe("");
  });

  it("does not come again for the same milestone within about 20 seconds, though a higher one still can", () => {
    expect(rb.FLURRY_COOLDOWN_MS).toBe(20000);
    const table: Array<[number, Record<string, number>, number, boolean]> = [
      [2500, {}, 1000, true],
      [2500, { 2500: 1000 }, 1500, false],
      [2500, { 2500: 1000 }, 20999, false],
      [2500, { 2500: 1000 }, 21000, true],
      [5000, { 2500: 1000 }, 1500, true],
      [5000, { 2500: 1000, 5000: 2000 }, 3000, false],
      [10000, { 2500: 1000, 5000: 2000 }, 3000, true],
      [2500, { 5000: 2000 }, 3000, true],
      [0, {}, 1000, false],
      [1234, {}, 1000, false],
    ];
    for (const [pence, fired, now, want] of table) expect(rb.flurryDue(pence, fired, now), JSON.stringify([pence, fired, now])).toBe(want);
    expect(rb.flurryDue(2500, null, 5)).toBe(true);
  });

  type Piece = { x: number; wait: number; fall: number; drift: number; turn: number; size: number; star: boolean; big: boolean };
  const plan = (kind: string, width: number) => rb.flurryPlan(kind, width) as { ms: number; pieces: Piece[] };

  it("is capped: about sixty pieces at most, and fewer on a small screen", () => {
    expect(plan("full", 1280).pieces.length).toBe(56);
    expect(plan("full", 390).pieces.length).toBe(34);
    expect(plan("half", 1280).pieces.length).toBe(24);
    expect(plan("half", 390).pieces.length).toBe(16);
    for (const w of [320, 390, 768, 1280, 2560, 0]) {
      expect(plan("full", w).pieces.length).toBeLessThanOrEqual(60);
      expect(plan("half", w).pieces.length).toBeLessThan(plan("full", w).pieces.length / 2 + 1);
    }
  });

  it("makes a full bag the bigger moment: more pieces and longer than half a bag", () => {
    expect(plan("full", 1280).ms).toBe(2900);
    expect(plan("half", 1280).ms).toBe(2000);
    expect(plan("full", 390).ms).toBe(2900);
    expect(plan("half", 390).ms).toBe(2000);
  });

  it("has every piece landed within its time, spread across the whole width", () => {
    for (const kind of ["full", "half"]) {
      for (const w of [390, 1280]) {
        const p = plan(kind, w);
        for (const piece of p.pieces) {
          expect(piece.wait).toBeGreaterThanOrEqual(0);
          expect(piece.wait * 1000 + piece.fall * 1000).toBeLessThanOrEqual(p.ms);
          expect(piece.x).toBeGreaterThanOrEqual(0);
          expect(piece.x).toBeLessThanOrEqual(100);
        }
        // Something in every fifth of the width.
        for (let band = 0; band < 5; band += 1) expect(p.pieces.some((q) => q.x >= band * 20 && q.x < band * 20 + 20), kind + w + " band " + band).toBe(true);
        // Edge to edge, and no two pieces in the same strip of the width (nothing clumps).
        expect(Math.min(...p.pieces.map((q) => q.x))).toBeLessThan(3);
        expect(Math.max(...p.pieces.map((q) => q.x))).toBeGreaterThan(97);
        expect(new Set(p.pieces.map((q) => Math.floor((q.x / 100) * p.pieces.length))).size).toBe(p.pieces.length);
        // And something starts at once: the moment answers the tap.
        expect(Math.min(...p.pieces.map((q) => q.wait))).toBeLessThan(0.06);
      }
    }
  });

  it("is varied: gold stars and paper snow, many sizes, drifting both ways, turning both ways, a few larger stars", () => {
    const p = plan("full", 1280).pieces;
    const stars = p.filter((q) => q.star);
    expect(stars.length).toBeGreaterThan(p.length * 0.3);
    expect(stars.length).toBeLessThan(p.length * 0.7);
    expect(new Set(p.map((q) => q.size)).size).toBeGreaterThan(8);
    expect(p.some((q) => q.drift > 10)).toBe(true);
    expect(p.some((q) => q.drift < -10)).toBe(true);
    expect(p.some((q) => q.turn > 0)).toBe(true);
    expect(p.some((q) => q.turn < 0)).toBe(true);
    expect(new Set(p.map((q) => q.wait)).size).toBeGreaterThan(8);
    const big = p.filter((q) => q.big);
    expect(big.length).toBeGreaterThanOrEqual(3);
    expect(big.length).toBeLessThanOrEqual(6);
    for (const q of big) expect(q.star).toBe(true);
    for (const q of p) {
      expect(q.size).toBeGreaterThanOrEqual(10);
      expect(q.size).toBeLessThanOrEqual(q.big ? 48 : 30);
      expect(Math.abs(q.drift)).toBeLessThanOrEqual(60);
    }
    expect(plan("half", 390).pieces.filter((q) => q.big).length).toBeLessThanOrEqual(2);
    // On a phone the pieces are a little smaller, so they never crowd a narrow screen.
    for (const q of plan("full", 390).pieces) expect(q.size).toBeLessThanOrEqual(q.big ? 38 : 23);
    expect(Math.max(...p.map((q) => q.size))).toBeGreaterThan(40);
  });

  it("is the same every time: nothing is left to chance, so it can be tested and never surprises", () => {
    expect(plan("full", 1280)).toEqual(plan("full", 1280));
    expect(plan("half", 390)).toEqual(plan("half", 390));
  });

  it("is nothing for a kind it does not know", () => {
    expect(plan("", 1280)).toEqual({ ms: 0, pieces: [] });
    expect(plan("nonsense", 1280)).toEqual({ ms: 0, pieces: [] });
  });
});

describe("the elf's notes", () => {
  const all: string[] = rb.allNotes();

  it("are ONE list, with at least two for every item and some for each moment", () => {
    for (const key of itemKeys) expect(rb.NOTES.items[key].length, key).toBeGreaterThanOrEqual(2);
    expect(Object.keys(rb.NOTES.items).sort()).toEqual([...itemKeys].sort());
    expect(Object.keys(rb.NOTES.things).sort()).toEqual([...itemKeys].sort());
    for (const kind of ["general", "first", "several", "out", "example"]) expect(rb.NOTES[kind].length, kind).toBeGreaterThanOrEqual(3);
    expect(all.length).toBeGreaterThan(40);
    expect(new Set(all).size).toBe(all.length);
  });

  it("are short enough to sit on one line of the paper", () => {
    for (const n of all) {
      expect(n.length, n).toBeLessThanOrEqual(32);
      expect(n.length, n).toBeGreaterThan(3);
    }
  });

  it("never say will, and never say anything is bought", () => {
    for (const n of all) {
      expect(n, n).not.toMatch(/\bwill\b|'ll\b/i);
      expect(n, n).not.toMatch(/\b(buy|buys|buying|bought|purchase|purchased|paid for|shopping)\b/i);
    }
  });

  it("never say a particular person receives anything", () => {
    for (const n of all) {
      expect(n, n).not.toMatch(/\b(child|children|kid|kids|boy|girl|family|families|someone|somebody|receive|receives|gets?|deliver|delivered|their|his|her)\b/i);
    }
  });

  it("never press: no just, only, more?, hurry, or keep going", () => {
    for (const n of all) {
      expect(n, n).not.toMatch(/\bjust\b|\bonly\b|more\?|\bhurry\b|\bquick\b|keep going|don't stop|one more|\bnearly\b|\balmost\b|\bneed\b|\bshould\b|\bmust\b/i);
    }
  });

  it("never rank the donor or shame a change of mind", () => {
    for (const n of all) expect(n, n).not.toMatch(/\b(best|top|number one|winner|champion|level|rank|badge|streak|score|points)\b/i);
    for (const n of rb.NOTES.out) expect(n, n).not.toMatch(/\b(shame|pity|sad|sorry|oh no|sure\?|really\?|why)\b/i);
  });

  it("have no dashes or hyphens, and are British", () => {
    for (const n of all) {
      expect(n, n).not.toMatch(/[–—-]/);
      expect(n, n).not.toMatch(/\b(color|favorite|pajamas|cozy|mom)\b/i);
      expect(n, n).not.toMatch(/santa/i);
    }
  });

  it("carries the owner's own changes (4 October 2026)", () => {
    expect(rb.NOTES.first).toContain("Here we go! Elves are cheering.");
    expect(rb.NOTES.items.headphones).toEqual(["Headphones. Tunes on!", "Music to our pointy ears."]);
    expect(rb.NOTES.example).toContain("That's a lovely one.");
    expect(rb.NOTES.several).toContain("{n} {things}? You legend.");
    for (const gone of ["Here we go! Elves are watching.", "Good choice. Very cool.", "That's a big hearted one."]) expect(all).not.toContain(gone);
  });

  it("say how many, with the item's own plural, when there are several", () => {
    for (const t of rb.NOTES.several) {
      expect(t).toContain("{n}");
      expect(t).toContain("{things}");
    }
    expect(rb.noteFor({ kind: "in", key: "pencil", quantity: 10, step: 10 }, "", 0)).toBe(rb.NOTES.several[0].replace("{n}", "10").replace("{things}", "pencils"));
    expect(all).toContain(rb.NOTES.several[0].replace("{n}", "99").replace("{things}", rb.NOTES.things["colouring-book"]));
  });
});

describe("which note the elf writes", () => {
  it("greets the first thing in the bag", () => {
    expect(rb.noteKind({ kind: "in", key: "socks", quantity: 1, step: 1, first: true })).toBe("first");
    expect(rb.NOTES.first).toContain(rb.noteFor({ kind: "in", key: "socks", quantity: 1, step: 1, first: true }, "", 0.5));
  });

  it("writes about the item itself, mostly, and something general now and then", () => {
    expect(rb.noteKind({ kind: "in", key: "socks", quantity: 1, step: 1 })).toBe("item");
    expect(rb.NOTES.items.socks).toContain(rb.noteFor({ kind: "in", key: "socks", quantity: 1, step: 1 }, "", 0));
    expect(rb.NOTES.items.socks).toContain(rb.noteFor({ kind: "in", key: "socks", quantity: 2, step: 1 }, "", 0.5));
    expect(rb.NOTES.general).toContain(rb.noteFor({ kind: "in", key: "socks", quantity: 2, step: 1 }, "", 0.95));
  });

  it("notices several of one thing: a typed jump, or reaching 3, 5, 10 and so on", () => {
    expect(rb.noteKind({ kind: "in", key: "pencil", quantity: 10, step: 10 })).toBe("several");
    expect(rb.noteKind({ kind: "in", key: "pencil", quantity: 3, step: 1 })).toBe("several");
    expect(rb.noteKind({ kind: "in", key: "pencil", quantity: 4, step: 1 })).toBe("item");
    expect(rb.noteKind({ kind: "in", key: "pencil", quantity: 5, step: 1 })).toBe("several");
    expect(rb.noteKind({ kind: "in", key: "pencil", quantity: 2, step: 2 })).toBe("item");
    expect(rb.noteFor({ kind: "in", key: "socks", quantity: 5, step: 1 }, "", 0)).toContain("5 pairs of socks");
  });

  it("is kind when something comes out, and has a word for an example", () => {
    expect(rb.noteKind({ kind: "out", key: "socks", quantity: 0, step: 1 })).toBe("out");
    expect(rb.NOTES.out).toContain(rb.noteFor({ kind: "out", key: "socks", quantity: 0, step: 1 }, "", 0.3));
    expect(rb.noteKind({ kind: "example", key: "hand-20" })).toBe("example");
    expect(rb.NOTES.example).toContain(rb.noteFor({ kind: "example", key: "hand-20" }, "", 0.3));
  });

  it("never repeats the one it wrote last", () => {
    for (const change of [
      { kind: "out", key: "socks", quantity: 0, step: 1 },
      { kind: "example", key: "hand-20" },
      { kind: "in", key: "socks", quantity: 1, step: 1 },
      { kind: "in", key: "socks", quantity: 1, step: 1, first: true },
      { kind: "in", key: "pencil", quantity: 10, step: 10 },
    ]) {
      for (const roll of [0, 0.2, 0.5, 0.69, 0.7, 0.9, 0.999, 1]) {
        const last = rb.noteFor(change, "", roll);
        expect(last.length).toBeGreaterThan(3);
        for (const again of [0, 0.2, 0.5, 0.69, 0.7, 0.9, 0.999, 1]) expect(rb.noteFor(change, last, again), `${last} @${again}`).not.toBe(last);
      }
    }
  });

  it("is nothing for a change it does not know", () => {
    expect(rb.noteFor({ kind: "nonsense" }, "", 0)).toBe("");
    expect(rb.noteFor(null, "", 0)).toBe("");
  });
});

describe("the tag on a full bag", () => {
  it("reads Packed with love", () => {
    expect(rb.TAG_LINES.join(" ")).toBe("Packed with love");
  });
});

describe("the stylesheet for the feel good layer", () => {
  it("lets nothing decorative take a tap", () => {
    for (const sel of ["rb-fx", "rb-flurry", "rb-note"]) expect(css, sel).toMatch(new RegExp(`\\.${sel}\\{[^}]*pointer-events:none`));
  });

  it("switches every movement off for someone who asked for less motion", () => {
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? "";
    for (const sel of [".rb-drop", ".rb-flake", ".rb-flurry", ".rb-bag.is-wobbling", ".rb-peek__in", ".rb-peek", ".rb-bag__bow", ".rb-bag__tag", ".rb-note"]) {
      expect(reduced, sel).toContain(sel);
    }
  });

  it("lays the snow and stars over the whole screen: one fixed layer, above the header and the bottom bar, under the payment window", () => {
    const rule = /\.rb-flurry\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/position:fixed/);
    expect(rule).toMatch(/inset:0/);
    expect(rule).toMatch(/overflow:hidden/);
    expect(rule).toMatch(/pointer-events:none/);
    const z = Number(/z-index:(\d+)/.exec(rule)?.[1]);
    const shared = read("assets/css/styles.css");
    const nav = Number(/\.nav\{[^}]*z-index:(\d+)/.exec(shared)?.[1]);
    const modal = Number(/\.give-embedded-modal\{[^}]*z-index:(\d+)/.exec(shared)?.[1]);
    const bar = Number(/\.rb-bar\{[^}]*z-index:(\d+)/.exec(css)?.[1]);
    expect(z).toBeGreaterThan(nav);
    expect(z).toBeGreaterThan(bar);
    expect(z).toBeLessThan(modal);
  });

  it("moves the snow, the stars and the peeks with transform and opacity only", () => {
    for (const name of ["rb-fall", "rb-peek", "rb-peek-out"]) {
      const body = new RegExp("@keyframes " + name + "\\{((?:[^{}]*\\{[^}]*\\})*)\\}").exec(css)?.[1] ?? "";
      expect(body, name).not.toBe("");
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      for (const p of props) expect(["opacity", "transform"], name + " " + p).toContain(p);
    }
    expect(css).toMatch(/\.rb-peek\{[^}]*transition:transform \.\d+s/);
    // No bounce: nothing in the fall overshoots.
    expect(/\.rb-flake\{[^}]*\}/.exec(css)?.[0] ?? "").not.toMatch(/cubic-bezier\([^)]*(1\.\d|-\d)/);
  });

  it("swaps a peek in under a third of a second", () => {
    const out = Number(/\.rb-peek\.is-leaving \.rb-peek__in\{[^}]*animation:rb-peek-out (\.\d+)s/.exec(css)?.[1]);
    const slide = Number(/\.rb-peek\{[^}]*transition:transform (\.\d+)s/.exec(css)?.[1]);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(0.3);
    expect(slide).toBeGreaterThan(0);
    expect(slide).toBeLessThan(0.3);
  });

  it("shows no snow at all to someone who asked for less motion, whatever the script does", () => {
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? "";
    expect(reduced).toMatch(/\.rb-flurry\{display:none\}/);
  });

  it("loops nothing forever", () => {
    expect(css).not.toMatch(/infinite/);
  });

  it("writes the note and the tag in the paper's hand, and nothing else off the paper", () => {
    expect(css).toMatch(/\.rb-paper \.rb-note\{[^}]*font-family:var\(--rb-hand\)/);
    expect(css).toMatch(/\.rb-bag__tag-words\{[^}]*font-family:var\(--rb-hand\)/);
  });

  it("takes the gold from the site's own token", () => {
    expect(css).toMatch(/var\(--gold-ink\)/);
  });
});
