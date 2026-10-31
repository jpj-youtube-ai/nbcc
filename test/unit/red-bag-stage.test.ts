// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderFillStage } from "../../src/red-bag/stage";
import type { RedBagList } from "../../src/red-bag/list";

// The Fill a Red Bag stage, as the server draws it (src/red-bag/stage.ts) and as its script makes it
// work (assets/js/red-bag-stage.js), in jsdom. The script is run the way a browser runs it, after the
// real catalogue, so it reads the list from the page's own block of data. How the stage reaches the
// pages is in red-bag-stage-routes.test.ts. Every name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const require = createRequire(import.meta.url);
const rules = require(resolve(ROOT, "assets/js/red-bag-list.js"));
const catalogue = require(resolve(ROOT, "assets/js/red-bag-catalogue.js"));
const CATALOGUE_JS = read("assets/js/red-bag-catalogue.js");
const STAGE_JS = read("assets/js/red-bag-stage.js");
const STAGE_CSS = read("assets/css/red-bag-stage.css");

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const tiles = () => [...document.querySelectorAll<HTMLButtonElement>(".fb-tile")];
const names = () => tiles().map((t) => norm(t.querySelector(".fb-tile-name")?.textContent));
const tile = (name: string) => tiles().find((t) => norm(t.querySelector(".fb-tile-name")?.textContent) === name)!;
const go = () => $<HTMLAnchorElement>("#fbGo");
const sum = () => $("#fbSum").textContent;
const status = () => $("#fbStatus").textContent;
const band = () => $("#fillBand");
const lit = () => document.querySelectorAll(".fb-lights .bulb.on").length;

/** A published list: the built-in one with every price moved, so nothing can pass by accident. */
function published(change: (list: RedBagList) => void = () => undefined): RedBagList {
  const list = rules.builtIn() as RedBagList;
  for (const item of list.items) item.pence += 100;
  change(list);
  return list;
}

function hide(list: RedBagList, ...keys: string[]) {
  for (const item of list.items) if (keys.includes(item.key)) item.hidden = true;
}

/** Only these items showing, at these prices. */
function only(list: RedBagList, prices: Record<string, number>) {
  for (const item of list.items) {
    item.hidden = !(item.key in prices);
    if (item.key in prices) item.pence = prices[item.key];
  }
}

let seen: Array<(entries: Array<{ isIntersecting: boolean }>) => void>;

function start(opts: { list?: RedBagList | null; html?: string; reduce?: boolean; onScreen?: boolean } = {}) {
  document.body.innerHTML = opts.html ?? renderFillStage(opts.list === undefined ? published() : opts.list);
  window.matchMedia = ((q: string) => ({ matches: opts.reduce === true && q.includes("reduce") })) as unknown as typeof window.matchMedia;
  seen = [];
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
      seen.push(cb);
    }
    observe() {}
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  (0, eval)(CATALOGUE_JS);
  (0, eval)(STAGE_JS);
  if (opts.onScreen !== false) seen.forEach((cb) => cb([{ isIntersecting: true }]));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { NBCCRedBag?: unknown }).NBCCRedBag;
});

describe("what the server draws", () => {
  const html = renderFillStage(published());
  const doc = () => new DOMParser().parseFromString(html, "text/html");

  it("is the band, with the list as a block of data", () => {
    const d = doc();
    expect(d.querySelector("section.fb#fillBand")?.getAttribute("aria-labelledby")).toBe("fbTitle");
    const block = d.getElementById("rb-list-data")!;
    expect(block.getAttribute("type")).toBe("application/json");
    expect(JSON.parse(block.textContent!).groups.length).toBeGreaterThan(0);
  });

  it("has no block of data, so the catalogue's own list stands, while nothing has been published", () => {
    expect(renderFillStage(null)).not.toContain("rb-list-data");
  });

  it("has ten fairy lights, one for every £5 of the first £50", () => {
    expect(doc().querySelectorAll(".fb-lights .bulb")).toHaveLength(10);
  });

  it("has a real link to /fill as its main button", () => {
    const a = doc().querySelector<HTMLAnchorElement>("a#fbGo")!;
    expect(a.getAttribute("href")).toBe("/fill");
    expect(norm(a.textContent)).toBe("Fill a Red Bag");
    expect(a.className).toContain("btn");
  });

  it("uses the live page's words", () => {
    const live = read("fill-a-red-bag.html");
    const d = doc();
    const lede = norm(d.querySelector(".fb-lede")?.textContent);
    expect(live).toContain(`<p class="lede">${lede}</p>`);
    const eyebrow = norm(d.querySelector(".fb-head .eyebrow")?.textContent);
    expect(live).toContain(`<span class="eyebrow">${eyebrow}</span>`);
    expect(norm(d.querySelector(".fb-head h2")?.textContent)).toBe("Fill a Red Bag");
    expect(norm(d.querySelector(".fb-elves")?.textContent)).toBe(catalogue.WORDS.elves);
    expect(norm(d.querySelector("#fbStatus")?.textContent)).toBe(catalogue.WORDS.empty);
  });

  it("uses the new words it is allowed, and they are the only ones", () => {
    const d = doc();
    expect(norm(d.querySelector(".fb-try")?.textContent)).toBe("Go on, tap something.");
    expect(norm(d.querySelector("#fbAgain")?.textContent)).toBe("Start again");
    expect(norm(d.querySelector("#fbPause")?.textContent)).toBe("Pause");
    expect(STAGE_JS).toContain("Carry on with this bag");
  });

  it("keeps to the charity's rules on wording, in the page and in the script", () => {
    const words = html + STAGE_JS;
    expect(words).not.toMatch(/families/i);
    expect(words).not.toMatch(/\bwill\b/i);
    expect(words).not.toMatch(/\bbuys?\b/i);
    expect(words).not.toContain("Play");
  });

  it("has the elf peeping over the snow, with no alt text: it says nothing", () => {
    const img = doc().querySelector<HTMLImageElement>("img.fb-elf")!;
    expect(img.getAttribute("src")).toBe("/assets/img/nbcc-elf.png");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("width")).toBeTruthy();
    expect(img.getAttribute("height")).toBeTruthy();
  });

  it("hides the logo's line under the elf by showing only the top of the picture", () => {
    expect(STAGE_CSS).toMatch(/\.fb-elf\{[^}]*object-fit:cover/);
    expect(STAGE_CSS).toMatch(/\.fb-elf\{[^}]*object-position:50% 0/);
  });

  it("carries nothing of the prototype's", () => {
    for (const s of [html, STAGE_CSS, STAGE_JS]) {
      expect(s).not.toContain("tofill");
      expect(s).not.toContain("proto-pill");
      expect(s).not.toContain("Prototype");
      expect(s).not.toContain("/files/");
    }
  });

  it("stacks from 1090px wide, so the elf's note can never cover the sum on the bag", () => {
    expect(STAGE_CSS).toContain("@media (max-width:1090px)");
  });

  it("scrolls inside nothing, and stops moving for people who ask for less motion", () => {
    expect(STAGE_CSS).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
    expect(STAGE_CSS).toContain("@media (prefers-reduced-motion:reduce)");
  });

  it("draws everything it needs itself: the home page does not load the Red Bag page's styles", () => {
    expect(STAGE_CSS).toContain('@font-face{font-family:"Caveat"');
    expect(STAGE_CSS).toContain(".fb .rb-art,.fb-fly .rb-art");
  });

  it("cannot be closed early by anything in a name: the data block escapes it", () => {
    const list = published((l) => {
      l.items[0].name = "Tea & toast";
    });
    expect(renderFillStage(list)).toContain("Tea \\u0026 toast");
  });
});

describe("the tiles come from the list on the page", () => {
  it("shows eight, with the published prices", () => {
    start();
    expect(tiles()).toHaveLength(8);
    expect(names()).toEqual(["Toy", "Headphones", "Blanket", "Insulated cup", "Pyjamas", "Hat & gloves", "Book", "Socks"]);
    expect(tile("Toy").querySelector(".fb-tile-price")?.textContent).toBe("£16");
    expect(tile("Socks").querySelector(".fb-tile-price")?.textContent).toBe("£2");
  });

  it("shows the built-in prices only when nothing has been published", () => {
    start({ list: null });
    expect(tile("Toy").querySelector(".fb-tile-price")?.textContent).toBe("£15");
    expect(tile("Socks").querySelector(".fb-tile-price")?.textContent).toBe("£1");
  });

  it("leaves out an item staff have hidden, and fills the place from the list", () => {
    start({ list: published((l) => hide(l, "socks")) });
    expect(names()).not.toContain("Socks");
    expect(tiles()).toHaveLength(8);
    expect(names().slice(0, 7)).toEqual(["Toy", "Headphones", "Blanket", "Insulated cup", "Pyjamas", "Hat & gloves", "Book"]);
    expect(names()[7]).toBe("Toiletry & fragrance gift set");
  });

  it("is always up to eight, whichever are hidden", () => {
    start({ list: published((l) => hide(l, "toy", "headphones", "blanket", "insulated-cup", "pyjamas", "hat-gloves", "book", "socks")) });
    expect(tiles()).toHaveLength(5);
    expect(names()).not.toContain("Toy");
    start({ list: published((l) => hide(l, "toy", "socks", "book")) });
    expect(tiles()).toHaveLength(8);
  });

  it("is in the same order every time", () => {
    const list = published((l) => hide(l, "socks", "book"));
    start({ list });
    const first = names();
    start({ list });
    expect(names()).toEqual(first);
  });

  it("takes a new item staff have added, under the name and drawing they gave it", () => {
    const list = published((l) => {
      hide(l, "socks", "toiletry-set", "soft-toy", "colouring-book", "pencil", "notebook");
      l.items.push({ key: "n-scarf-ab12", name: "Warm scarf", pence: 650, group: "clothing", art: "present", hidden: false });
    });
    start({ list });
    expect(names()).toContain("Warm scarf");
    expect(tile("Warm scarf").querySelector(".rb-art")).not.toBeNull();
    expect(tile("Warm scarf").querySelector(".fb-tile-price")?.textContent).toBe("£6.50");
  });

  it("leaves out anything with no drawing to fly into the bag", () => {
    const block = JSON.stringify({ groups: [{ key: "home", items: [
      { key: "n-no-picture", name: "No picture", pence: 500, art: "" },
      { key: "blanket", name: "Blanket", pence: 800, art: "blanket" },
    ] }], themes: [] });
    const html = renderFillStage(null) + `<script type="application/json" id="rb-list-data">${block}</script>`;
    start({ html });
    expect(names()).toEqual(["Blanket"]);
  });

  it("puts a name on the page as words, never as markup", () => {
    const block = JSON.stringify({ groups: [{ key: "home", items: [{ key: "blanket", name: "Socks & co (pairs)", pence: 800, art: "blanket" }] }], themes: [] });
    start({ html: renderFillStage(null) + `<script type="application/json" id="rb-list-data">${block}</script>` });
    expect(names()).toEqual(["Socks & co"]);
    expect(tile("Socks & co").getAttribute("aria-label")).toBe("Pop socks & co in the bag, £8");
    expect(STAGE_JS).not.toMatch(/innerHTML\s*=\s*[^'"]*name/);
  });

  it("never falls back to the catalogue's own prices if the page's list cannot be read", () => {
    start({ html: renderFillStage(null) + '<script type="application/json" id="rb-list-data">not json</script>' });
    expect(tiles()).toHaveLength(0);
    expect(go().getAttribute("href")).toBe("/fill");
  });

  it("asks nobody to tap anything until there is something to tap", () => {
    document.body.innerHTML = renderFillStage(published());
    expect($(".fb-try").hidden).toBe(true);
    start();
    expect($(".fb-try").hidden).toBe(false);
    start({ html: renderFillStage(null) + '<script type="application/json" id="rb-list-data">not json</script>' });
    expect($(".fb-try").hidden).toBe(true);
  });
});

describe("the demonstration", () => {
  const until = (done: () => boolean, ms = 900_000) => {
    for (let t = 0; t < ms && !done(); t += 250) vi.advanceTimersByTime(250);
    return done();
  };
  const filled = () => band().classList.contains("full");

  it("fills the bag by itself once it is on the screen", () => {
    start();
    expect(until(filled)).toBe(true);
    expect(lit()).toBe(10);
  });

  it("waits until it is on the screen", () => {
    start({ onScreen: false });
    vi.advanceTimersByTime(30_000);
    expect(sum()).toBe("£0");
  });

  it("keeps going round until the bag is full, on a list that totals under £50", () => {
    start({ list: published((l) => only(l, { toy: 400, socks: 100, book: 300 })) });
    expect(until(filled)).toBe(true);
  });

  it("works with one item on the list", () => {
    start({ list: published((l) => only(l, { socks: 1000 })) });
    expect(tiles()).toHaveLength(1);
    expect(until(filled)).toBe(true);
  });

  it("works with one item that is more than a whole bag", () => {
    start({ list: published((l) => only(l, { toy: 7500 })) });
    expect(until(filled)).toBe(true);
    expect(lit()).toBe(10);
  });

  it("starts over once it has held a full bag", () => {
    start();
    until(filled);
    vi.advanceTimersByTime(7_000);
    expect(filled()).toBe(false);
    expect(until(() => sum() !== "£0")).toBe(true);
  });

  it("uses the catalogue's words for the status", () => {
    start({ list: published((l) => only(l, { toy: 2600 })) });
    until(() => sum() === "£26");
    expect(status()).toBe(catalogue.statusLine(2600));
  });

  it("never carries: the button stays as it was, however far it has gone", () => {
    start();
    until(filled);
    expect(norm(go().textContent)).toBe("Fill a Red Bag");
    expect(go().getAttribute("href")).toBe("/fill");
  });

  it("has an elf who says only what the catalogue has written", () => {
    start();
    vi.advanceTimersByTime(800);
    const said = $("#fbNote").textContent!;
    expect(said).not.toBe("");
    expect(catalogue.allNotes()).toContain(said);
  });

  it("does not use an item's own note once staff have renamed it", () => {
    const list = published((l) => {
      only(l, { toy: 100 });
      l.items.find((i) => i.key === "toy")!.name = "Puzzle";
    });
    start({ list });
    for (let i = 0; i < 12; i += 1) {
      vi.advanceTimersByTime(1000);
      expect(catalogue.NOTES.items.toy).not.toContain($("#fbNote").textContent);
    }
  });

  it("is held by Pause, and carries on from there", () => {
    start();
    vi.advanceTimersByTime(1000);
    const held = sum();
    $("#fbPause").click();
    expect(band().classList.contains("held")).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(sum()).toBe(held);
    $("#fbPause").click();
    expect(band().classList.contains("held")).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(sum()).not.toBe(held);
  });

  it("keeps the one word on the button, and says when it is pressed", () => {
    start();
    const pause = $("#fbPause");
    expect(pause.hidden).toBe(false);
    expect(pause.getAttribute("aria-pressed")).toBe("false");
    pause.click();
    expect(pause.textContent).toBe("Pause");
    expect(pause.getAttribute("aria-pressed")).toBe("true");
    pause.click();
    expect(pause.getAttribute("aria-pressed")).toBe("false");
  });

  it("says nothing out loud until it is the visitor's", () => {
    start();
    expect($("#fbStatus").getAttribute("aria-live")).toBe("off");
    tile("Toy").click();
    expect($("#fbStatus").getAttribute("aria-live")).toBe("polite");
  });
});

describe("after a tap, the bag is the visitor's", () => {
  it("stops the demonstration for good, and empties what it had put in", () => {
    start();
    vi.advanceTimersByTime(2_000);
    tile("Book").click();
    expect(sum()).toBe("£4");
    vi.advanceTimersByTime(30_000);
    expect(sum()).toBe("£4");
  });

  it("turns the button into Carry on with this bag, with the bag in the link", () => {
    start();
    tile("Toy").click();
    tile("Toy").click();
    tile("Socks").click();
    expect(norm(go().textContent)).toBe("Carry on with this bag");
    expect(go().getAttribute("href")).toBe("/fill?bag=toy:2,socks:1");
  });

  it("adds up in the page's own money", () => {
    start();
    tile("Toy").click();
    tile("Socks").click();
    expect(sum()).toBe("£18");
    expect(status()).toBe(catalogue.statusLine(1800));
    expect(lit()).toBe(3);
  });

  it("shows how many of each are in the bag", () => {
    start();
    tile("Toy").click();
    tile("Toy").click();
    const count = tile("Toy").querySelector(".fb-count")!;
    expect(count.textContent).toBe("2");
    expect(count.classList.contains("on")).toBe(true);
  });

  it("offers Start again, which clears everything", () => {
    start();
    expect($("#fbAgain").hidden).toBe(true);
    tile("Toy").click();
    expect($("#fbAgain").hidden).toBe(false);
    $("#fbAgain").click();
    expect($("#fbAgain").hidden).toBe(true);
    expect(sum()).toBe("£0");
    expect(status()).toBe(catalogue.WORDS.empty);
    expect(norm(go().textContent)).toBe("Fill a Red Bag");
    expect(go().getAttribute("href")).toBe("/fill");
    expect(tile("Toy").querySelector(".fb-count")!.classList.contains("on")).toBe(false);
    expect(document.querySelectorAll(".fb-peek")).toHaveLength(0);
  });

  it("ties up a full bag, and the next tap starts another without losing what went before", () => {
    start({ list: published((l) => only(l, { toy: 3000, socks: 500 })) });
    tile("Toy").click();
    tile("Toy").click();
    expect(band().classList.contains("full")).toBe(true);
    expect(status()).toBe(catalogue.statusLine(5000));
    tile("Socks").click();
    expect(band().classList.contains("full")).toBe(false);
    expect(sum()).toBe("£5");
    expect(status()).toBe(catalogue.statusLine(6500));
    expect(go().getAttribute("href")).toBe("/fill?bag=toy:2,socks:1");
  });

  it("never sends more of a thing than the real page takes", () => {
    start({ list: published((l) => only(l, { socks: 10 })) });
    for (let i = 0; i < 120; i += 1) tile("Socks").click();
    expect(go().getAttribute("href")).toBe(`/fill?bag=socks:${catalogue.MAX_QUANTITY}`);
  });

  it("does not trip over a key that is also the name of something in the language", () => {
    const block = JSON.stringify({ groups: [{ key: "home", items: [{ key: "constructor", name: "Odd", pence: 800, art: "blanket" }] }], themes: [] });
    start({ html: renderFillStage(null) + `<script type="application/json" id="rb-list-data">${block}</script>` });
    tile("Odd").click();
    expect(go().getAttribute("href")).toBe("/fill?bag=constructor:1");
    expect(sum()).toBe("£8");
  });

  it("works when the demonstration was paused, and Pause still holds the snow", () => {
    start();
    $("#fbPause").click();
    tile("Toy").click();
    expect(sum()).toBe("£16");
    expect(go().getAttribute("href")).toBe("/fill?bag=toy:1");
    expect($("#fbPause").hidden).toBe(false);
  });
});

describe("with less motion asked for", () => {
  it("nothing runs by itself", () => {
    start({ reduce: true });
    vi.advanceTimersByTime(60_000);
    expect(sum()).toBe("£0");
    expect(band().classList.contains("full")).toBe(false);
  });

  it("offers no Pause, because there is nothing to pause", () => {
    start({ reduce: true });
    expect($("#fbPause").hidden).toBe(true);
  });

  it("a tap still works", () => {
    start({ reduce: true });
    tile("Toy").click();
    expect(sum()).toBe("£16");
    expect(norm(go().textContent)).toBe("Carry on with this bag");
    expect(go().getAttribute("href")).toBe("/fill?bag=toy:1");
  });

  it("speaks up from the start", () => {
    start({ reduce: true });
    expect($("#fbStatus").getAttribute("aria-live")).toBe("polite");
  });

  it("works in a browser that cannot tell it what is on the screen", () => {
    document.body.innerHTML = renderFillStage(published());
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    (0, eval)(CATALOGUE_JS);
    expect(() => (0, eval)(STAGE_JS)).not.toThrow();
    tile("Toy").click();
    expect(sum()).toBe("£16");
  });
});

describe("the script stands aside", () => {
  it("does nothing on a page with no stage", () => {
    document.body.innerHTML = "<main></main>";
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    (0, eval)(CATALOGUE_JS);
    expect(() => (0, eval)(STAGE_JS)).not.toThrow();
  });

  it("leaves the link working if the catalogue did not load", () => {
    document.body.innerHTML = renderFillStage(published());
    expect(() => (0, eval)(STAGE_JS)).not.toThrow();
    expect(go().getAttribute("href")).toBe("/fill");
    expect(tiles()).toHaveLength(0);
  });
});
