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

  it("is only ever something that is in the bag", () => {
    expect(rb.peekSlots(null, [], 0.6)).toEqual([null, null, null]);
    expect(rb.peekSlots(null, ["socks"], 0.02)).toEqual(["socks", null, null]);
    expect(rb.peekSlots(null, ["pencil", "socks", "book", "toy"], 0.6)).toEqual(["pencil", "socks", "book"]);
    expect(rb.peekSlots(null, ["nonsense"], 0.6)).toEqual([null, null, null]);
  });

  it("keeps what is already peeking where it is, and fills a free place with the newest", () => {
    const before = rb.peekSlots(null, ["socks"], 0.3);
    expect(before).toEqual(["socks", null, null]);
    expect(rb.peekSlots(before, ["book", "socks"], 0.3)).toEqual(["socks", "book", null]);
    expect(rb.peekSlots(["socks", "book", null], ["toy", "book", "socks"], 0.6)).toEqual(["socks", "book", "toy"]);
  });

  it("loses a peek when its item is taken out, and the others stay put", () => {
    expect(rb.peekSlots(["socks", "book", "toy"], ["toy", "socks"], 0.6)).toEqual(["socks", null, "toy"]);
    expect(rb.peekSlots(["socks", "book", "toy"], ["blanket", "toy", "socks"], 0.6)).toEqual(["socks", "blanket", "toy"]);
  });

  it("shows fewer when the bag is emptier", () => {
    expect(rb.peekSlots(["socks", "book", "toy"], ["toy", "book", "socks"], 0.1)).toEqual(["socks", null, null]);
    expect(rb.peekSlots(["socks", "book", "toy"], ["toy", "book", "socks"], 1)).toEqual([null, null, null]);
  });

  it("never changes the list it was given", () => {
    const prev = ["socks", null, null];
    const keys = ["book", "socks"];
    rb.peekSlots(prev, keys, 0.6);
    expect(prev).toEqual(["socks", null, null]);
    expect(keys).toEqual(["book", "socks"]);
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
    for (const sel of [".rb-drop", ".rb-flake", ".rb-bag.is-wobbling", ".rb-peek__in", ".rb-bag__bow", ".rb-bag__tag", ".rb-note"]) {
      expect(reduced, sel).toContain(sel);
    }
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
