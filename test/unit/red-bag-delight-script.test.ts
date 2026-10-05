// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderRedBagPage } from "../../src/red-bag/render";

// Fill a Red Bag, the feel good layer, as the page's script applies it (assets/js/red-bag.js), driven
// in jsdom over the page exactly as the server draws it: the drop, what peeks out of the bag, the
// ribbon and the tag, the snow and stars, the wobble and the elf's note. It is ALL decoration: the
// total, what is said out loud and what is sent to the checkout are exactly as they were. Every name
// here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const catalogue = require(resolve(ROOT, "assets/js/red-bag-catalogue.js"));
const { initRedBag } = require(resolve(ROOT, "assets/js/red-bag.js")) as {
  initRedBag: (doc: Document, win: unknown, nav?: { assign: (u: string) => void }) => { total: () => number; payload: () => Record<string, unknown> } | null;
};
const template = readFileSync(resolve(ROOT, "fill-a-red-bag.html"), "utf8");

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => ($(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
const row = (key: string) => $(`[data-rb-item="${key}"]`);
const plus = (key: string, times = 1) => {
  for (let i = 0; i < times; i += 1) (row(key).querySelector("[data-rb-plus]") as HTMLButtonElement).click();
};
const minus = (key: string) => (row(key).querySelector("[data-rb-minus]") as HTMLButtonElement).click();
const box = (key: string) => document.getElementById(`rb-qty-${key}`) as HTMLInputElement;
const type = (key: string, value: string) => {
  box(key).value = value;
  box(key).dispatchEvent(new Event("input", { bubbles: true }));
};
const leave = (key: string) => box(key).dispatchEvent(new Event("blur"));
const example = (key: string) => $<HTMLButtonElement>(`[data-rb-example="${key}"]`);
const bags = () => $$("[data-rb-bags] .rb-bag");
const drops = () => $$(".rb-drop");
const note = () => $(".rb-note");
// What peeks out of a bag, the FRONT place first (the newest), then the one before it, and so on.
const peekEls = (bag: Element) => [...bag.querySelectorAll("[data-rb-peek]")].sort((a, b) => Number(a.getAttribute("data-rb-slot")) - Number(b.getAttribute("data-rb-slot")));
const peeks = (bag: Element) => peekEls(bag).map((p) => p.getAttribute("data-rb-peek"));
// The same, as they are drawn: the last one drawn is on top.
const drawn = (bag: Element) => [...bag.querySelectorAll("[data-rb-peek]")].map((p) => p.getAttribute("data-rb-peek"));
const sinking = (bag: Element) => [...bag.querySelectorAll(".rb-peek.is-leaving")];
const flurries = () => $$(".rb-flurry");

let fetchMock: ReturnType<typeof vi.fn>;
let api: ReturnType<typeof initRedBag>;
let watchers: Array<{ el: Element | null; say: (onScreen: boolean) => void }>;

function start(opts: { reduce?: boolean; catalogue?: Record<string, unknown>; width?: number; layout?: boolean } = {}) {
  const html = renderRedBagPage(template, { preview: false });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  document.body.classList.remove("rb-bar-on");
  // The details step asks for the payment script once; a test that went there must not leave it for the next.
  document.getElementById("stripe-js-sdk")?.remove();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: "https://checkout.stripe.test/pay" }) }));
  watchers = [];
  class Observer {
    me: { el: Element | null; say: (onScreen: boolean) => void };
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.me = { el: null, say: (onScreen) => cb([{ isIntersecting: onScreen }]) };
      watchers.push(this.me);
    }
    observe(el: Element) {
      this.me.el = el;
    }
  }
  const store = new Map<string, string>();
  const win = {
    IntersectionObserver: Observer,
    NBCCRedBag: opts.catalogue ?? catalogue,
    addEventListener: () => undefined,
    fetch: fetchMock,
    innerHeight: 800,
    innerWidth: opts.width ?? 1280,
    location: { href: "", pathname: "/fill", search: "" },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    matchMedia: (q: string) => ({ matches: !!opts.reduce && /prefers-reduced-motion/.test(q) }),
    navigator: {},
  };
  // A browser that can measure (jsdom has no layout of its own): see "the note never lies over...".
  if (opts.layout) {
    Object.assign(win, {
      DOMMatrix: class {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      },
      getComputedStyle: () => ({ fontStyle: "normal", fontWeight: "700", fontSize: "16px", fontFamily: "Caveat", transform: "none" }),
    });
  }
  api = initRedBag(document, win, { assign: vi.fn() });
}

beforeEach(() => {
  vi.useFakeTimers();
  start();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the layer itself", () => {
  it("adds one place for the drop to fly in, hidden from screen readers, and leaves the page's layout alone", () => {
    const fx = $$(".rb-fx");
    expect(fx.length).toBe(1);
    expect(fx[0].getAttribute("aria-hidden")).toBe("true");
    expect(fx[0].parentElement).toBe($("[data-rb-builder]"));
    expect([...$(".rb-layout").children].map((el) => el.className.split(" ")[0])).toEqual(["rb-paper", "rb-need", "rb-panel", "rb-real"]);
  });

  it("does nothing until something changes: no drop, no note, no snow", () => {
    expect(drops().length).toBe(0);
    expect(note()).toBeNull();
    expect($(".rb-flurry")).toBeNull();
    expect($(".rb-bag.is-wobbling")).toBeNull();
  });
});

describe("the item drops into the bag", () => {
  it("makes one small drawing of the item when its quantity goes up, and clears it away after", () => {
    watchers[0].say(true); // the real total is on screen, so the bar is not showing
    plus("socks");
    expect(drops().length).toBe(1);
    const d = drops()[0];
    expect(d.closest(".rb-fx")).not.toBeNull();
    expect(d.querySelectorAll("svg.rb-art").length).toBe(1);
    expect(d.querySelector("svg")!.innerHTML).toBe(new DOMParser().parseFromString(catalogue.art("socks"), "text/html").body.firstElementChild!.innerHTML);
    vi.advanceTimersByTime(1000);
    expect(drops().length).toBe(0);
    expect($(".rb-fx").childElementCount).toBe(0);
  });

  it("plays one drop for a typed jump, not ten", () => {
    type("pencil", "1");
    type("pencil", "10");
    expect(drops().length).toBe(0);
    vi.advanceTimersByTime(500);
    expect(drops().length).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(drops().length).toBe(0);
  });

  it("plays it at once when the number box is left, and not a second time", () => {
    type("pencil", "10");
    leave("pencil");
    expect(drops().length).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(drops().length).toBe(0);
    leave("pencil");
    expect(drops().length).toBe(0);
  });

  it("does not drop a picture when something is taken out", () => {
    plus("socks", 2);
    vi.advanceTimersByTime(2000);
    minus("socks");
    expect(drops().length).toBe(0);
  });

  it("does not drop a picture for an example or a round-up: they are money, not items", () => {
    example("hand-20").click();
    expect(drops().length).toBe(0);
    $<HTMLButtonElement>("[data-rb-round]").click();
    expect(drops().length).toBe(0);
    expect(api!.total()).toBe(2500);
  });

  it("never builds up a backlog: quick taps show three drops at most, and leave nothing behind", () => {
    const before = document.querySelectorAll("*").length;
    plus("socks", 12);
    expect(drops().length).toBeLessThanOrEqual(3);
    expect(drops().length).toBeGreaterThan(0);
    vi.advanceTimersByTime(5000);
    expect(drops().length).toBe(0);
    expect(note()).toBeNull();
    expect($(".rb-bag.is-wobbling")).toBeNull();
    // Only what stays in the bag was added: the one peek, and the bag's own ribbon and tag.
    const after = document.querySelectorAll("*").length;
    plus("socks", 12);
    vi.advanceTimersByTime(5000);
    expect(document.querySelectorAll("*").length).toBe(after);
    expect(after).toBeGreaterThan(before);
  });

  it("heads for the bottom bar's total when the bag is off screen and the bar is showing", () => {
    watchers[0].say(false);
    plus("socks");
    expect($("[data-rb-bar]").hidden).toBe(false);
    expect(drops()[0].classList.contains("rb-drop--bar")).toBe(true);
    // It flies inside the bar itself, so it is seen to land on the total and is never behind it.
    expect(drops()[0].parentElement).toBe($("[data-rb-bar]"));
    expect(drops()[0].getAttribute("aria-hidden")).toBe("true");
    expect($("[data-rb-bar-total]").classList.contains("is-bumped")).toBe(true);
    vi.advanceTimersByTime(2000);
    expect($("[data-rb-bar-total]").classList.contains("is-bumped")).toBe(false);
    expect(drops().length).toBe(0);
    expect($("[data-rb-bar]").querySelectorAll(".rb-drop").length).toBe(0);
  });

  it("lets a later nod of the bar's total run its course: an earlier timer never cuts it short", () => {
    watchers[0].say(false);
    plus("socks");
    vi.advanceTimersByTime(700);
    plus("socks");
    vi.advanceTimersByTime(400);
    // The first tap's timer would have ended it here (1000ms after the first tap).
    expect($("[data-rb-bar-total]").classList.contains("is-bumped")).toBe(true);
    vi.advanceTimersByTime(700);
    expect($("[data-rb-bar-total]").classList.contains("is-bumped")).toBe(false);
  });

  it("heads for the bag when the bag is on screen", () => {
    const bag = bags()[0];
    bag.getBoundingClientRect = () => ({ left: 600, top: 200, right: 750, bottom: 365, width: 150, height: 165, x: 600, y: 200, toJSON: () => ({}) });
    box("socks").getBoundingClientRect = () => ({ left: 300, top: 500, right: 350, bottom: 544, width: 50, height: 44, x: 300, y: 500, toJSON: () => ({}) });
    plus("socks");
    const d = drops()[0];
    expect(d.classList.contains("rb-drop--bag")).toBe(true);
    expect(d.style.left).toBe("325px");
    expect(d.style.top).toBe("522px");
    expect(d.style.getPropertyValue("--rb-dx")).toBe("350px");
    expect(Number.parseFloat(d.style.getPropertyValue("--rb-dy"))).toBeLessThan(0);
  });
});

describe("the bag reacts", () => {
  it("gives a small wobble when something goes in, and settles", () => {
    plus("blanket");
    expect(bags()[0].classList.contains("is-wobbling")).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(bags()[0].classList.contains("is-wobbling")).toBe(false);
  });

  it("wobbles for an example and a round-up too, and not when something comes out", () => {
    example("hand-20").click();
    expect(bags()[0].classList.contains("is-wobbling")).toBe(true);
    vi.advanceTimersByTime(1500);
    example("hand-20").click();
    expect(bags()[0].classList.contains("is-wobbling")).toBe(false);
    plus("socks");
    vi.advanceTimersByTime(1500);
    $<HTMLButtonElement>("[data-rb-round]").click();
    expect(bags()[0].classList.contains("is-wobbling")).toBe(true);
  });

  it("strains at the handles only when it is nearly full", () => {
    type("socks", "20");
    expect(bags()[0].classList.contains("is-heavy")).toBe(false);
    type("socks", "45");
    expect(bags()[0].classList.contains("is-heavy")).toBe(true);
    type("socks", "50");
    expect(bags()[0].classList.contains("is-heavy")).toBe(false);
  });
});

describe("what peeks out of the bag", () => {
  it("shows the item that went in, behind the bag's front edge", () => {
    plus("socks");
    const bag = bags()[0];
    expect(peeks(bag)).toEqual(["socks"]);
    const holder = bag.querySelector(".rb-bag__peeks")!;
    const paper = bag.querySelector(".rb-bag__paper")!;
    // Drawn BEFORE the bag's own paper, so the paper covers its lower half.
    expect(holder.compareDocumentPosition(paper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(holder.querySelectorAll("svg.rb-art").length).toBe(1);
  });

  // The owner, 5 October 2026: "the prizes at the top of the bag should be the last (latest) item(s)
  // to be added, not the first".
  it("shows the LATEST things added, the newest in the front place and drawn on top", () => {
    // 40 pencils (£4) take the bag past... nothing: three places need half a bag, so fill it first.
    type("pyjamas", "5");
    leave("pyjamas");
    plus("socks");
    plus("book");
    plus("soft-toy");
    expect(api!.total()).toBe(3300);
    const bag = bags()[0];
    expect(peeks(bag)).toEqual(["soft-toy", "book", "socks"]);
    // The newest is drawn last, so it is the one on top where two overlap.
    expect(drawn(bag)).toEqual(["socks", "book", "soft-toy"]);
    plus("blanket");
    expect(peeks(bag)).toEqual(["blanket", "soft-toy", "book"]);
    expect(drawn(bag)).toEqual(["book", "soft-toy", "blanket"]);
  });

  it("moves an item to the front again when more of it is added", () => {
    type("pyjamas", "5");
    leave("pyjamas");
    plus("socks");
    plus("book");
    plus("soft-toy");
    plus("socks");
    expect(peeks(bags()[0])).toEqual(["socks", "soft-toy", "book"]);
    expect(drawn(bags()[0])).toEqual(["book", "soft-toy", "socks"]);
    // More of the one already at the front: nothing moves, and it is still there once.
    plus("socks");
    expect(peeks(bags()[0])).toEqual(["socks", "soft-toy", "book"]);
  });

  it("keeps the order when one is taken out of an item that still has some left", () => {
    type("pyjamas", "5");
    leave("pyjamas");
    plus("socks", 2);
    plus("book");
    plus("soft-toy");
    minus("socks");
    expect(peeks(bags()[0])).toEqual(["soft-toy", "book", "socks"]);
  });

  it("drops an item's peek when the last one is taken out, and the next most recent takes the free place", () => {
    type("pyjamas", "5");
    leave("pyjamas");
    plus("socks");
    plus("book");
    plus("soft-toy");
    expect(peeks(bags()[0])).toEqual(["soft-toy", "book", "socks"]);
    minus("book");
    expect(peeks(bags()[0])).toEqual(["soft-toy", "socks", "pyjamas"]);
    // The one that came back is the oldest showing, so it is drawn underneath.
    expect(drawn(bags()[0])).toEqual(["pyjamas", "socks", "soft-toy"]);
  });

  it("follows the arrow keys and a typed number once the typing has stopped", () => {
    type("pyjamas", "5");
    leave("pyjamas");
    plus("socks");
    box("book").value = "0";
    box("book").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(peeks(bags()[0])).toEqual(["book", "socks", "pyjamas"]);
    // A typed increase counts once it is finished: when the typing stops, or the box is left.
    type("socks", "3");
    expect(peeks(bags()[0])).toEqual(["book", "socks", "pyjamas"]);
    vi.advanceTimersByTime(500);
    expect(peeks(bags()[0])).toEqual(["socks", "book", "pyjamas"]);
    type("pyjamas", "6");
    leave("pyjamas");
    expect(peeks(bags()[0])).toEqual(["pyjamas", "socks", "book"]);
  });

  it("does not reorder for a number retyped lower, even by way of an empty box", () => {
    type("pyjamas", "5");
    leave("pyjamas");
    plus("socks");
    expect(peeks(bags()[0])).toEqual(["socks", "pyjamas"]);
    type("pyjamas", "");
    // Nothing of it in the bag just now, so it does not peek.
    expect(peeks(bags()[0])).toEqual(["socks"]);
    type("pyjamas", "4");
    leave("pyjamas");
    // 5 became 4: one taken out with some left. The socks are still the latest.
    expect(api!.total()).toBe(2100);
    expect(peeks(bags()[0])).toEqual(["socks", "pyjamas"]);
    // And typed back up again, it is the latest.
    type("pyjamas", "");
    type("pyjamas", "6");
    vi.advanceTimersByTime(500);
    expect(peeks(bags()[0])).toEqual(["pyjamas", "socks"]);
  });

  it("shows more as the bag fills, three at most, each item once, and only things that are in the bag", () => {
    plus("blanket");
    plus("book");
    expect(peeks(bags()[0])).toEqual(["book"]);
    plus("headphones");
    expect(peeks(bags()[0])).toEqual(["headphones", "book"]);
    plus("toy");
    expect(peeks(bags()[0])).toEqual(["toy", "headphones", "book"]);
    type("socks", "10");
    leave("socks");
    plus("pencil");
    plus("pencil");
    expect(peeks(bags()[0])).toEqual(["pencil", "socks", "toy"]);
    minus("pencil");
    minus("pencil");
    expect(peeks(bags()[0])).toEqual(["socks", "toy", "headphones"]);
    for (const key of peeks(bags()[0])) expect(Number(box(key!).value)).toBeGreaterThan(0);
  });

  it("shows the latest things in the NEW bag when one has filled: the bags are one bag", () => {
    type("pyjamas", "9");
    leave("pyjamas");
    plus("socks");
    plus("book");
    expect(api!.total()).toBe(4900);
    expect(peeks(bags()[0])).toEqual(["book", "socks", "pyjamas"]);
    plus("soft-toy");
    // £53: the first bag is tied, and the second has just started.
    expect(bags().length).toBe(2);
    expect(peeks(bags()[0])).toEqual([]);
    expect(peeks(bags()[1])).toEqual(["soft-toy"]);
    type("toy", "4");
    leave("toy");
    plus("blanket");
    expect(api!.total()).toBe(8100);
    expect(peeks(bags()[1])).toEqual(["blanket", "toy", "soft-toy"]);
  });

  it("swaps naturally: the new one pops up, the oldest sinks and is cleared away, and the others slide along", () => {
    type("pyjamas", "5");
    leave("pyjamas");
    plus("socks");
    plus("book");
    vi.advanceTimersByTime(1000);
    const bag = bags()[0];
    const [book, socks, pyjamas] = peekEls(bag) as HTMLElement[];
    expect(peeks(bag)).toEqual(["book", "socks", "pyjamas"]);
    const bookWas = book.style.transform;
    const socksWas = socks.style.transform;
    plus("soft-toy");
    // The two that stay are the SAME drawings, moved along one place (so they slide, not blink).
    const now = peekEls(bag) as HTMLElement[];
    expect(peeks(bag)).toEqual(["soft-toy", "book", "socks"]);
    expect(now[1]).toBe(book);
    expect(now[2]).toBe(socks);
    expect(book.style.transform).toBe(socksWas);
    expect(book.style.transform).not.toBe(bookWas);
    expect(now[0].style.transform).toBe(bookWas);
    // The oldest is on its way out: still drawn for a moment, no longer one of the peeks.
    expect(sinking(bag)).toEqual([pyjamas]);
    expect(pyjamas.hasAttribute("data-rb-peek")).toBe(false);
    vi.advanceTimersByTime(299);
    expect(sinking(bag)).toEqual([]);
    expect(pyjamas.isConnected).toBe(false);
    expect(bag.querySelectorAll(".rb-peek").length).toBe(3);
  });

  it("never builds up: quick taps leave three peeks and nothing sinking", () => {
    type("pyjamas", "5");
    leave("pyjamas");
    for (const key of ["socks", "book", "pencil", "notebook", "socks", "book"]) plus(key);
    expect(api!.total()).toBe(3410);
    expect(peeks(bags()[0])).toEqual(["book", "socks", "notebook"]);
    vi.advanceTimersByTime(300);
    expect(bags()[0].querySelectorAll(".rb-peek").length).toBe(3);
  });

  // The owner, 5 October 2026: "make items a bit bigger and stand out a bit more".
  it("draws them clearly bigger (about a third or more), the newest the biggest and standing tallest", () => {
    type("pyjamas", "5");
    leave("pyjamas");
    plus("socks");
    plus("book");
    const els = peekEls(bags()[0]) as HTMLElement[];
    expect(peeks(bags()[0])).toEqual(["book", "socks", "pyjamas"]);
    const was = 28;
    const shape = els.map((g) => {
      const art = g.querySelector("svg.rb-art")!;
      const t = g.style.transform;
      const scale = Number(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? 1);
      const [, x, y] = /translate\(([\d.]+)px,\s*([\d.]+)px\)/.exec(t)!.map(Number);
      const size = Number(art.getAttribute("width")) * scale;
      // How far its top stands above the bag's rim (y = 36 in the bag's own picture).
      const rise = 36 - (y + Number(art.getAttribute("y")) * scale);
      return { x, y, size, rise, left: x - size / 2, right: x + size / 2 };
    });
    for (const p of shape) {
      expect(p.size / was).toBeGreaterThanOrEqual(1.28);
      expect(p.size / was).toBeLessThanOrEqual(1.45);
      // Higher out of the bag than before (16), and never out of the top of the bag's own picture.
      expect(p.rise).toBeGreaterThan(20);
      expect(p.rise).toBeLessThanOrEqual(34);
      // Inside the bag's width (12 to 108), give or take its tilt: it must look INSIDE the bag.
      expect(p.left).toBeGreaterThanOrEqual(6);
      expect(p.right).toBeLessThanOrEqual(114);
    }
    expect(shape[0].size).toBeGreaterThan(shape[1].size);
    expect(shape[0].size).toBeGreaterThan(shape[2].size);
    expect(shape[0].rise).toBeGreaterThan(shape[1].rise);
    expect(shape[0].rise).toBeGreaterThan(shape[2].rise);
    // Still behind the bag's own paper, so the bag's front edge covers their lower part.
    const holder = bags()[0].querySelector(".rb-bag__peeks")!;
    expect(holder.compareDocumentPosition(bags()[0].querySelector(".rb-bag__paper")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And nothing about them sizes the bag or the panel: they are drawn inside the bag's own picture.
    expect(bags()[0].getAttribute("viewBox")).toBe("0 0 120 132");
  });

  it("shows nothing for examples or a round-up alone", () => {
    example("school-40").click();
    expect(peeks(bags()[0])).toEqual([]);
  });

  it("is empty again when the bag is", () => {
    plus("socks");
    minus("socks");
    expect(peeks(bags()[0])).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(bags()[0].querySelectorAll(".rb-peek").length).toBe(0);
  });
});

describe("a full bag is tied and tagged", () => {
  it("has the ribbon and the tag once it reaches £50, reading Packed with love", () => {
    type("socks", "49");
    expect(bags()[0].classList.contains("is-full")).toBe(false);
    expect(bags()[0].classList.contains("is-latest")).toBe(false);
    type("socks", "50");
    const bag = bags()[0];
    expect(bag.classList.contains("is-full")).toBe(true);
    expect(bag.classList.contains("is-latest")).toBe(true);
    expect(bag.querySelectorAll(".rb-bag__tie").length).toBe(1);
    expect(bag.querySelector(".rb-bag__bow")).not.toBeNull();
    expect((bag.querySelector(".rb-bag__tag-words")?.textContent ?? "").replace(/\s+/g, " ").trim()).toBe("Packed with love");
    expect(peeks(bag)).toEqual([]);
  });

  it("comes off again when the total drops below a full bag", () => {
    type("socks", "50");
    type("socks", "49");
    leave("socks");
    expect(bags()[0].classList.contains("is-full")).toBe(false);
    expect(bags()[0].classList.contains("is-latest")).toBe(false);
    expect(peeks(bags()[0])).toEqual(["socks"]);
  });

  it("keeps the first bag tied while the second fills, with the peeks in the one that is filling", () => {
    type("socks", "60");
    leave("socks");
    expect(bags().length).toBe(2);
    expect(bags()[0].classList.contains("is-full")).toBe(true);
    expect(bags()[0].classList.contains("is-latest")).toBe(true);
    expect(bags()[1].classList.contains("is-full")).toBe(false);
    expect(bags()[1].querySelectorAll(".rb-bag__tie").length).toBe(1);
    expect(peeks(bags()[0])).toEqual([]);
    expect(peeks(bags()[1])).toEqual(["socks"]);
  });

  it("puts the words on the newest full bag only, and on none once the bags are too small to read", () => {
    type("blanket", "13");
    expect(bags().map((b) => b.classList.contains("is-latest"))).toEqual([false, true, false]);
    type("blanket", "20");
    expect(bags().length).toBe(4);
    expect(bags().some((b) => b.classList.contains("is-latest"))).toBe(false);
  });
});

// The owner, 5 October 2026: "make the star moment across the entire page: a bigger moment".
describe("the snow and stars", () => {
  const flakes = (f: Element) => [...f.querySelectorAll<HTMLElement>(".rb-flake")];
  const lands = (flake: HTMLElement) => Number.parseFloat(flake.style.getPropertyValue("--rb-d")) + Number.parseFloat(flake.style.getPropertyValue("--rb-t"));

  it("falls over the WHOLE screen at a full bag: one layer on the page itself, taking no tap, hidden from screen readers", () => {
    type("socks", "49");
    leave("socks");
    vi.advanceTimersByTime(3000);
    expect(flurries().length).toBe(0);
    plus("socks");
    expect(flurries().length).toBe(1);
    const f = flurries()[0];
    // Straight on the page's body, not in the bag's panel: the stylesheet fixes it to the screen.
    expect(f.parentElement).toBe(document.body);
    expect(f.closest(".rb-panel, [data-rb-builder], header, footer, main")).toBeNull();
    expect(f.getAttribute("aria-hidden")).toBe("true");
    expect(f.classList.contains("rb-flurry--full")).toBe(true);
    expect(f.querySelectorAll("a, button, input, select, textarea, [tabindex], img, canvas, audio, video").length).toBe(0);
    for (const svg of f.querySelectorAll("svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
    }
  });

  it("is the big one at a full bag: many pieces, capped at sixty, stars and snow, a few larger stars, about three seconds", () => {
    type("socks", "50");
    const f = flurries()[0];
    const all = flakes(f);
    expect(all.length).toBe(56);
    expect(all.length).toBeLessThanOrEqual(60);
    expect(f.querySelectorAll(".rb-flake--star").length).toBeGreaterThan(15);
    expect(f.querySelectorAll(".rb-flake--snow").length).toBeGreaterThan(15);
    const big = f.querySelectorAll(".rb-flake--big").length;
    expect(big).toBeGreaterThanOrEqual(3);
    expect(big).toBeLessThanOrEqual(6);
    for (const flake of all) expect(lands(flake)).toBeLessThanOrEqual(2.9);
    expect(Math.max(...all.map(lands))).toBeGreaterThan(2.5);
    // Spread across the full width, each with its own size, drift and turn.
    const across = all.map((p) => Number.parseFloat(p.style.getPropertyValue("--rb-x")));
    expect(Math.min(...across)).toBeLessThan(5);
    expect(Math.max(...across)).toBeGreaterThan(95);
    for (const name of ["--rb-w", "--rb-s", "--rb-r", "--rb-d"]) expect(new Set(all.map((p) => p.style.getPropertyValue(name))).size, name).toBeGreaterThan(8);
  });

  it("clears completely when it ends: the layer is taken out of the page", () => {
    type("socks", "50");
    vi.advanceTimersByTime(2850);
    expect(flurries().length).toBe(1);
    vi.advanceTimersByTime(200);
    expect(flurries().length).toBe(0);
    expect($(".rb-flake")).toBeNull();
    expect(document.body.lastElementChild?.classList.contains("rb-flurry")).toBe(false);
  });

  it("is a lighter one at half a bag: the same whole screen, fewer pieces, about two seconds", () => {
    type("socks", "24");
    leave("socks");
    expect(flurries().length).toBe(0);
    plus("socks");
    expect(flurries().length).toBe(1);
    const f = flurries()[0];
    expect(f.parentElement).toBe(document.body);
    expect(f.classList.contains("rb-flurry--half")).toBe(true);
    expect(flakes(f).length).toBe(24);
    for (const flake of flakes(f)) expect(lands(flake)).toBeLessThanOrEqual(2);
    vi.advanceTimersByTime(1950);
    expect(flurries().length).toBe(1);
    vi.advanceTimersByTime(200);
    expect(flurries().length).toBe(0);
  });

  it("has fewer pieces on a small screen, and the full bag is still the bigger moment there", () => {
    start({ width: 390 });
    type("socks", "25");
    expect(flakes(flurries()[0]).length).toBe(16);
    vi.advanceTimersByTime(2500);
    type("socks", "50");
    expect(flakes(flurries()[0]).length).toBe(34);
    expect(flurries()[0].classList.contains("rb-flurry--full")).toBe(true);
  });

  it("falls for each further full bag", () => {
    type("socks", "50");
    vi.advanceTimersByTime(3500);
    type("blanket", "6");
    expect(api!.total()).toBe(9800);
    expect(flurries().length).toBe(0);
    plus("socks", 2);
    expect(api!.total()).toBe(10000);
    expect(flurries().length).toBe(1);
    expect(flurries()[0].classList.contains("rb-flurry--full")).toBe(true);
  });

  it("does not fall again while the total goes on up past the milestone", () => {
    type("socks", "25");
    vi.advanceTimersByTime(3000);
    plus("socks", 3);
    expect(flurries().length).toBe(0);
  });

  it("does not fall on the way down", () => {
    type("socks", "51");
    vi.advanceTimersByTime(30000);
    minus("socks");
    minus("socks");
    type("socks", "25");
    type("socks", "10");
    expect(flurries().length).toBe(0);
  });

  it("has a cooldown: the same milestone, crossed again within about 20 seconds, does not snow again", () => {
    type("socks", "25");
    expect(flurries().length).toBe(1);
    vi.advanceTimersByTime(3000);
    // Back and forth across £25, again and again.
    for (let i = 0; i < 4; i += 1) {
      minus("socks");
      plus("socks");
      vi.advanceTimersByTime(3000);
    }
    expect(flurries().length).toBe(0);
    // 15 seconds gone. After 20 it may come again.
    vi.advanceTimersByTime(5100);
    minus("socks");
    plus("socks");
    expect(flurries().length).toBe(1);
  });

  it("lets a HIGHER milestone through during another one's cooldown", () => {
    type("socks", "25");
    vi.advanceTimersByTime(3000);
    type("socks", "50");
    expect(flurries().length).toBe(1);
    expect(flurries()[0].classList.contains("rb-flurry--full")).toBe(true);
    vi.advanceTimersByTime(3500);
    // The full bag has its own cooldown too.
    minus("socks");
    plus("socks");
    expect(flurries().length).toBe(0);
    type("blanket", "7");
    expect(api!.total()).toBe(10600);
    expect(flurries().length).toBe(1);
  });

  it("is never doubled: one layer at a time, however the total jumps about", () => {
    type("socks", "50");
    type("socks", "49");
    type("socks", "100");
    type("socks", "24");
    type("socks", "25");
    type("socks", "99");
    type("socks", "50");
    expect(flurries().length).toBe(1);
    expect($$(".rb-flake").length).toBeLessThanOrEqual(60);
    vi.advanceTimersByTime(3100);
    expect(flurries().length).toBe(0);
  });

  it("gives way to the bigger moment: a full bag reached while half a bag's snow is falling takes its place", () => {
    type("socks", "25");
    expect(flurries()[0].classList.contains("rb-flurry--half")).toBe(true);
    vi.advanceTimersByTime(800);
    type("socks", "50");
    expect(flurries().length).toBe(1);
    expect(flurries()[0].classList.contains("rb-flurry--full")).toBe(true);
    // The first one's timer does not cut the second short.
    vi.advanceTimersByTime(1500);
    expect(flurries().length).toBe(1);
    vi.advanceTimersByTime(1600);
    expect(flurries().length).toBe(0);
  });

  it("falls for a round-up that reaches the milestone", () => {
    plus("blanket");
    vi.advanceTimersByTime(3000);
    $<HTMLButtonElement>("[data-rb-round]").click();
    expect(api!.total()).toBe(2500);
    expect(flurries().length).toBe(1);
  });

  it("is cleared away at once when the donor moves on to their details", () => {
    type("socks", "50");
    expect(flurries().length).toBe(1);
    $<HTMLButtonElement>("[data-rb-donate]").click();
    expect($("[data-rb-details]").hidden).toBe(false);
    expect(flurries().length).toBe(0);
  });

  it("changes nothing the donor reads or can reach while it falls", () => {
    type("socks", "49");
    leave("socks");
    const add = row("socks").querySelector("[data-rb-plus]") as HTMLButtonElement;
    add.focus();
    add.click();
    expect(flurries().length).toBe(1);
    expect(document.activeElement).toBe(add);
    expect(text("[data-rb-total]")).toBe("£50");
    expect(text("[data-rb-donate]")).toBe("Donate £50");
    expect($("[data-rb-bar]").contains(flurries()[0])).toBe(false);
    expect(document.body.classList.contains("rb-flurry-on")).toBe(false);
  });
});

describe("the elf's note", () => {
  it("appears beside the row just changed: one note, in the list of notes, hidden from screen readers", () => {
    plus("socks");
    const n = note();
    expect(n).not.toBeNull();
    expect(n.closest("[data-rb-item]")).toBe(row("socks"));
    expect(n.getAttribute("aria-hidden")).toBe("true");
    expect(n.classList.contains("is-on")).toBe(true);
    expect(catalogue.NOTES.first).toContain(n.textContent);
    expect($$(".rb-note").length).toBe(1);
  });

  it("goes after a few seconds, and leaves nothing behind", () => {
    plus("socks");
    vi.advanceTimersByTime(3000);
    expect(note()).not.toBeNull();
    vi.advanceTimersByTime(1500);
    expect(note()).toBeNull();
  });

  it("is replaced by the next one: never two at once, never the same twice running", () => {
    plus("socks");
    const first = note().textContent;
    vi.advanceTimersByTime(1200);
    plus("blanket");
    expect($$(".rb-note").length).toBe(1);
    expect(note().closest("[data-rb-item]")).toBe(row("blanket"));
    expect(note().textContent).not.toBe(first);
    expect(catalogue.allNotes()).toContain(note().textContent);
  });

  it("does not flicker under quick taps on one row, but does notice several", () => {
    plus("blanket");
    vi.advanceTimersByTime(2000);
    plus("socks");
    const words = note().textContent;
    plus("socks");
    expect(note().textContent).toBe(words);
    plus("socks");
    minus("socks");
    plus("socks");
    // Still the first note: a held key or quick taps never flicker through several.
    expect(note().textContent).toBe(words);
    expect($$(".rb-note").length).toBe(1);
    // Once it has had its moment, the newest change is the one written.
    vi.advanceTimersByTime(900);
    expect(note().textContent).toContain("3 pairs of socks");
    vi.advanceTimersByTime(5000);
    expect(note()).toBeNull();
  });

  it("writes on another row at once", () => {
    plus("blanket");
    plus("socks");
    expect(note().closest("[data-rb-item]")).toBe(row("socks"));
  });

  it("says how many after a typed jump", () => {
    type("pencil", "10");
    leave("pencil");
    expect(note().textContent).toMatch(/^(And we're off|First thing in|Here we go)/);
    vi.advanceTimersByTime(5000);
    type("book", "4");
    leave("book");
    expect(note().textContent).toContain("4 books");
  });

  it("is kind when something is taken out", () => {
    plus("socks", 2);
    vi.advanceTimersByTime(5000);
    minus("socks");
    expect(catalogue.NOTES.out).toContain(note().textContent);
    expect(note().closest("[data-rb-item]")).toBe(row("socks"));
  });

  it("has a word for an example, beside its line on the paper", () => {
    example("crisis-15").click();
    expect(catalogue.NOTES.example).toContain(note().textContent);
    expect(note().closest("[data-rb-also-list]")).not.toBeNull();
    expect(note().closest(".rb-paper")).not.toBeNull();
    vi.advanceTimersByTime(5000);
    example("crisis-15").click();
    expect(note()).toBeNull();
  });
});

// An existing fault, found by measuring in a real browser (5 October 2026): a long note could lie
// over the words of a neighbouring row. The page now measures where the note's words fall and tries
// each place in turn (the catalogue's notePlacements); if none is clear, it writes no note at all.
// jsdom has no layout, so these give it one: every row 400 by 60, the note 100 by 20.
describe("the note never lies over a name, a price or a control", () => {
  type Box = { left: number; top: number; width: number; height: number };
  let boxes: (el: Element) => Box | null;
  let fits = 0; // how many times the paper has been measured for a note
  let measure: ReturnType<typeof vi.fn>;
  const restore: Array<() => void> = [];
  const prop = (proto: object, name: string, get: (this: HTMLElement) => number) => {
    const old = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, get });
    restore.push(() => (old ? Object.defineProperty(proto, name, old) : delete (proto as Record<string, unknown>)[name]));
  };
  const rowTop = (el: Element) => $$("[data-rb-builder] .rb-paper .rb-item").indexOf(el as HTMLElement) * 60;

  beforeEach(() => {
    boxes = () => null;
    fits = 0;
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      // The paper's own edge is read once each time a note is fitted.
      if (this.classList.contains("rb-paper")) fits += 1;
      const own = boxes(this);
      const b = own ?? (this.classList.contains("rb-paper") ? { left: 0, top: -100, width: 400, height: 5000 } : this.classList.contains("rb-item") ? { left: 0, top: rowTop(this), width: 400, height: 60 } : { left: 0, top: 0, width: 0, height: 0 });
      return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => b } as DOMRect;
    });
    restore.push(() => rect.mockRestore());
    const isNote = (el: HTMLElement) => el.classList.contains("rb-note");
    prop(HTMLElement.prototype, "offsetWidth", function () { return isNote(this) ? 100 : 0; });
    prop(HTMLElement.prototype, "offsetHeight", function () { return isNote(this) ? 20 : 0; });
    prop(HTMLElement.prototype, "offsetLeft", function () { return isNote(this) ? 200 : 0; });
    // As the stylesheet places it: across the rule above the row, or across the one below it.
    prop(HTMLElement.prototype, "offsetTop", function () { return isNote(this) ? (this.classList.contains("rb-note--below") ? 50 : -10) : 0; });
    measure = vi.fn(() => ({ width: 100, fontBoundingBoxAscent: 14, fontBoundingBoxDescent: 6, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }));
    const ctx = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({ font: "", measureText: measure })) as never);
    // The names on the paper have words to measure (one line each, well clear of the note).
    Range.prototype.getClientRects = (() => [{ left: 0, top: 5000, width: 50, height: 20 }]) as never;
    restore.push(() => ctx.mockRestore());
    restore.push(() => {
      delete (Range.prototype as unknown as Record<string, unknown>).getClientRects;
      delete (document as unknown as Record<string, unknown>).fonts;
    });
    start({ layout: true });
  });
  afterEach(() => {
    while (restore.length) restore.pop()!();
  });

  it("is written above the row when nothing is in the way", () => {
    plus("blanket");
    plus("socks");
    expect(note().parentElement).toBe(row("socks"));
    expect(note().classList.contains("is-on")).toBe(true);
    expect(note().classList.contains("rb-note--above")).toBe(true);
    expect(note().className).not.toMatch(/--small|--flat|--below/);
  });

  it("goes below the row when something is in the way above it", () => {
    // The minus button of the row above, hanging low: across the rule the note would lie on.
    const above = row("socks").previousElementSibling!.querySelector("[data-rb-minus]")!;
    boxes = (el) => (el === above ? { left: 210, top: rowTop(row("socks")) - 14, width: 44, height: 20 } : null);
    plus("blanket");
    plus("socks");
    expect(note().parentElement).toBe(row("socks"));
    expect(note().classList.contains("rb-note--below")).toBe(true);
    expect(note().classList.contains("is-on")).toBe(true);
  });

  it("is only ever below the first row of a group: the heading is above it", () => {
    plus("socks");
    plus("blanket");
    expect(note().parentElement).toBe(row("blanket"));
    expect(note().classList.contains("rb-note--below")).toBe(true);
  });

  it("writes NO note when there is nowhere clear, and the page carries on", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Every number box, made to cover the whole paper.
    boxes = (el) => (el.tagName === "INPUT" ? { left: 0, top: -100, width: 400, height: 5000 } : null);
    plus("blanket");
    plus("socks", 3);
    expect(note()).toBeNull();
    expect($(".rb-paper")!.style.transform).toBe("");
    expect(api!.total()).toBe(1100);
    expect(text("[data-rb-total]")).toBe("£11");
    expect(api!.payload()).toMatchObject({ amount: 1100, redBag: true });
    // And a clear row gets its note again.
    boxes = () => null;
    plus("book");
    expect(note().parentElement).toBe(row("book"));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Review, 5 October 2026: a row where nothing fits was measured afresh on every tap or key repeat.
  it("does not measure again and again for a row where nothing fits: once, then once more when the taps stop", () => {
    boxes = (el) => (el.tagName === "INPUT" ? { left: 0, top: -100, width: 400, height: 5000 } : null);
    plus("socks");
    expect(note()).toBeNull();
    expect(fits).toBe(1);
    // Nine more, quickly, as a held key or fast taps would be.
    for (let i = 0; i < 9; i += 1) {
      vi.advanceTimersByTime(30);
      plus("socks");
    }
    expect(fits).toBe(1);
    expect(note()).toBeNull();
    // The moment is up: the NEWEST change is tried once, and that is all.
    vi.advanceTimersByTime(900);
    expect(fits).toBe(2);
    vi.advanceTimersByTime(5000);
    expect(fits).toBe(2);
    // Taking one out and putting it back is held in the same way.
    minus("socks");
    plus("socks");
    minus("socks");
    expect(fits).toBe(3);
    expect(api!.total()).toBe(900);
    // Another row is not held back by it.
    boxes = () => null;
    plus("book");
    expect(fits).toBe(4);
    expect(note().parentElement).toBe(row("book"));
  });

  // Review: a note that cannot be written must not pull off one that is still showing elsewhere.
  it("leaves a note that is showing on another row to finish, when the new row cannot take one", () => {
    plus("blanket");
    const showing = note();
    expect(showing.parentElement).toBe(row("blanket"));
    expect(showing.classList.contains("is-on")).toBe(true);
    const words = showing.textContent;
    vi.advanceTimersByTime(1000);
    boxes = (el) => (el.tagName === "INPUT" ? { left: 0, top: -100, width: 400, height: 5000 } : null);
    plus("socks");
    // Still there, on its own row, the same words, and still the only note.
    expect($$(".rb-note").length).toBe(1);
    expect(note()).toBe(showing);
    expect(showing.parentElement).toBe(row("blanket"));
    expect(showing.classList.contains("is-on")).toBe(true);
    expect(showing.textContent).toBe(words);
    expect(row("socks").querySelector(".rb-note")).toBeNull();
    // And it goes in its own time: about three seconds after it was written, not cut short.
    vi.advanceTimersByTime(2000);
    expect(showing.classList.contains("is-on")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(showing.classList.contains("is-on")).toBe(false);
    vi.advanceTimersByTime(400);
    expect(note()).toBeNull();
  });

  it("still replaces the note that is showing when the new row CAN take one: never two at once", () => {
    plus("blanket");
    plus("socks");
    expect($$(".rb-note").length).toBe(1);
    expect(note().parentElement).toBe(row("socks"));
    vi.advanceTimersByTime(5000);
    expect(note()).toBeNull();
  });

  // Review: measurements taken before the handwriting font arrives are of the wrong letters.
  it("does not keep a measurement taken before the fonts have loaded, and keeps them once they have", () => {
    const listeners: Record<string, () => void> = {};
    const fonts = { status: "loading", addEventListener: (name: string, fn: () => void) => void (listeners[name] = fn) };
    (document as unknown as Record<string, unknown>).fonts = fonts;
    start({ layout: true });
    const asked = (words: string) => measure.mock.calls.filter((c) => c[0] === words).length;
    plus("book");
    expect(asked("Blanket")).toBe(1);
    vi.advanceTimersByTime(5000);
    plus("book");
    // Still loading: measured afresh, not remembered.
    expect(asked("Blanket")).toBe(2);
    fonts.status = "loaded";
    vi.advanceTimersByTime(5000);
    plus("book");
    expect(asked("Blanket")).toBe(3);
    vi.advanceTimersByTime(5000);
    plus("book");
    // Loaded: remembered now.
    expect(asked("Blanket")).toBe(3);
    // A font arriving later (the browser says so): what was remembered is thrown away.
    expect(typeof listeners.loadingdone).toBe("function");
    listeners.loadingdone();
    vi.advanceTimersByTime(5000);
    plus("book");
    expect(asked("Blanket")).toBe(4);
    vi.advanceTimersByTime(5000);
    plus("book");
    expect(asked("Blanket")).toBe(4);
  });

  it("puts the paper's tilt back after measuring, even if the measuring fails", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    $(".rb-paper")!.style.transform = "rotate(-1deg)";
    plus("blanket");
    expect($(".rb-paper")!.style.transform).toBe("rotate(-1deg)");
    boxes = (el) => {
      if (el.tagName === "BUTTON") throw new Error("invented failure");
      return null;
    };
    plus("socks");
    expect($(".rb-paper")!.style.transform).toBe("rotate(-1deg)");
    expect(api!.total()).toBe(900);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("the icon on a line under Also in your bag", () => {
  it("is the example's own, for the eye only, and the line's words are as they were", () => {
    example("hand-20").click();
    const line = $("[data-rb-also-list] li");
    const words = line.querySelector(".rb-also__words")!;
    expect(words.querySelectorAll("svg.rb-also__icon.rb-art").length).toBe(1);
    expect(words.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(words.textContent).toBe("£20 could help with toiletries and warm clothes in a hard moment");
    expect(line.querySelector("button")?.getAttribute("aria-label")).toBe("Remove from your bag: £20 could help with toiletries and warm clothes in a hard moment");
  });

  it("is not on the round-up's line: that is simply money", () => {
    plus("blanket");
    $<HTMLButtonElement>("[data-rb-round]").click();
    expect($("[data-rb-round-line] svg")).toBeNull();
  });
});

describe("for someone who asked for less motion", () => {
  beforeEach(() => start({ reduce: true }));

  it("drops nothing, wobbles nothing and snows nothing", () => {
    plus("socks");
    type("socks", "25");
    leave("socks");
    type("socks", "50");
    leave("socks");
    example("hand-20").click();
    expect(drops().length).toBe(0);
    expect($(".rb-flurry")).toBeNull();
    expect($(".rb-flake")).toBeNull();
    expect($(".rb-bag.is-wobbling")).toBeNull();
    expect($("[data-rb-bar-total]").classList.contains("is-bumped")).toBe(false);
  });

  it("swaps the peeks at once: nothing lingers to sink", () => {
    type("pyjamas", "5");
    leave("pyjamas");
    plus("socks");
    plus("book");
    plus("soft-toy");
    expect(peeks(bags()[0])).toEqual(["soft-toy", "book", "socks"]);
    expect(bags()[0].querySelectorAll(".rb-peek").length).toBe(3);
    expect(sinking(bags()[0])).toEqual([]);
  });

  it("still changes what is shown, at once: the peek, the ribbon and tag, and the note", () => {
    plus("socks");
    expect(peeks(bags()[0])).toEqual(["socks"]);
    expect(note().classList.contains("is-on")).toBe(true);
    plus("book");
    expect(peeks(bags()[0])).toEqual(["book"]);
    type("socks", "47");
    expect(bags()[0].classList.contains("is-full")).toBe(true);
    expect(bags()[0].classList.contains("is-latest")).toBe(true);
    expect(bags()[0].querySelector(".rb-bag__tie")).not.toBeNull();
  });
});

describe("it is all decoration", () => {
  const busy = () => {
    plus("socks", 3);
    plus("blanket");
    type("toy", "5");
    leave("toy");
    example("crisis-15").click();
    $<HTMLButtonElement>("[data-rb-round]").click();
  };

  it("hides every decorative thing from screen readers and keeps it out of the tab order", () => {
    busy();
    type("socks", "60");
    const decorative = $$(".rb-fx, .rb-drop, .rb-note, .rb-flurry, .rb-bag__peeks, .rb-bag__tie, .rb-also__icon, .rb-example__icon");
    expect(decorative.length).toBeGreaterThan(12);
    for (const el of decorative) {
      expect(el.closest('[aria-hidden="true"]'), el.getAttribute("class") ?? "").not.toBeNull();
      expect(el.matches("a, button, input, select, textarea, [tabindex], [contenteditable]")).toBe(false);
      expect(el.querySelectorAll("a, button, input, select, textarea, [tabindex], [contenteditable]").length).toBe(0);
    }
  });

  it("never takes or moves the focus", () => {
    const add = row("socks").querySelector("[data-rb-plus]") as HTMLButtonElement;
    add.focus();
    add.click();
    add.click();
    vi.advanceTimersByTime(5000);
    expect(document.activeElement).toBe(add);
    box("socks").focus();
    type("socks", "50");
    vi.advanceTimersByTime(5000);
    expect(document.activeElement).toBe(box("socks"));
  });

  it("leaves the one live region as it was: one region, the same words, written once for a change", () => {
    const said = $(".rb-said");
    let writes = 0;
    const seen = new MutationObserver((list) => {
      writes += list.length;
    });
    seen.observe(said, { childList: true, characterData: true, subtree: true });
    plus("blanket");
    const records = seen.takeRecords();
    seen.disconnect();
    // The status line and the total: each written once, and nothing else in the region touched.
    expect(records.length + writes).toBe(2);
    expect($$("[data-rb-builder] [aria-live]").length).toBe(1);
    expect($$("[data-rb-builder] [role=status]").length).toBe(1);
    expect(text("[data-rb-status]")).toBe(catalogue.statusLine(800));
    expect(text("[data-rb-total]")).toBe("£8");
    expect(said.querySelector(".rb-note, .rb-drop, .rb-flurry, svg")).toBeNull();
    const words = said.textContent;
    vi.advanceTimersByTime(5000);
    expect(said.textContent).toBe(words);
  });

  it("changes no sum: the total, the status, Donate and the bar are what the catalogue says", () => {
    busy();
    const own = 3 * 100 + 800 + 5 * 500 + 1500;
    expect(api!.total()).toBe(10000);
    expect(own).toBe(5100);
    expect(text("[data-rb-total]")).toBe("£100");
    expect(text("[data-rb-status]")).toBe(catalogue.statusLine(10000));
    expect(text("[data-rb-donate]")).toBe("Donate £100");
    expect(text("[data-rb-bar-total]")).toBe("£100");
  });

  it("sends the checkout exactly what it sent before, and asks the network for nothing of its own", () => {
    busy();
    vi.advanceTimersByTime(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelectorAll("img, link, script, iframe, audio, video, canvas").length).toBe(document.querySelectorAll("header img, footer img").length);
    expect(api!.payload()).toEqual({
      mode: "once",
      plan: null,
      amount: 10000,
      giftAid: false,
      coverFee: false,
      donorType: "individual",
      fullName: "",
      email: "",
      emailConsent: false,
      redBag: true,
    });
  });

  it("pauses while the giving step is not showing", () => {
    type("socks", "5");
    $<HTMLButtonElement>("[data-rb-donate]").click();
    expect($("[data-rb-details]").hidden).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(drops().length).toBe(0);
    expect(note()).toBeNull();
    expect($("[data-rb-details] .rb-note, [data-rb-details] .rb-drop, [data-rb-details] .rb-flurry")).toBeNull();
  });
});

// A second bag "arrives" (the is-new class). It must let go of that once it has arrived: left on, the
// wobble's animation would replace it, and when the wobble ended the bag would arrive all over again,
// vanishing and fading back in after every tap.
describe("a bag that has arrived stays put", () => {
  it("lets go of its arrival once it has played", () => {
    type("socks", "60");
    expect(bags().length).toBe(2);
    expect(bags()[1].classList.contains("is-new")).toBe(true);
    vi.advanceTimersByTime(600);
    expect(bags()[1].classList.contains("is-new")).toBe(false);
  });

  it("lets go of it when the arrival's own animation ends", () => {
    type("socks", "60");
    const bag = bags()[1];
    const done = new Event("animationend", { bubbles: true });
    bag.dispatchEvent(done);
    expect(bag.classList.contains("is-new")).toBe(false);
  });

  it("never wobbles a bag that is still arriving: the wobble takes the arrival off first", () => {
    type("socks", "49");
    leave("socks");
    vi.advanceTimersByTime(2000);
    plus("blanket");
    const bag = bags()[1];
    expect(bag.classList.contains("is-wobbling")).toBe(true);
    expect(bag.classList.contains("is-new")).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(bag.classList.contains("is-wobbling")).toBe(false);
    expect(bag.classList.contains("is-new")).toBe(false);
  });
});

// The feel good layer must never be able to stop the page working. During a deploy a donor can be
// given the new page script with the OLD catalogue, which has none of the layer's functions.
describe("the page works whatever happens to the feel good layer", () => {
  const giving = () => {
    plus("blanket", 2);
    type("socks", "5");
    leave("socks");
    example("crisis-15").click();
    $<HTMLButtonElement>("[data-rb-round]").click();
    minus("blanket");
    vi.advanceTimersByTime(5000);
  };
  const stillWorks = () => {
    // 8 + 5 + 15 = 28, rounded up to 50, then a blanket out: the round-up grows back to keep 50.
    expect(api!.total()).toBe(5000);
    expect(text("[data-rb-total]")).toBe("£50");
    expect(text("[data-rb-status]")).toBe(catalogue.statusLine(5000));
    expect(text("[data-rb-donate]")).toBe("Donate £50");
    expect(text("[data-rb-bar-total]")).toBe("£50");
    expect(bags()[0].classList.contains("is-full")).toBe(true);
    expect($("[data-rb-also-list] li .rb-also__words").textContent).toBe("£15 could help replace a child's favourite cuddly toy");
    $<HTMLButtonElement>("[data-rb-donate]").click();
    expect($("[data-rb-details]").hidden).toBe(false);
    expect(api!.payload()).toMatchObject({ mode: "once", amount: 5000, redBag: true });
  };
  const old = () => {
    const stub: Record<string, unknown> = { ...catalogue };
    for (const k of ["ART", "art", "TAG_LINES", "MAX_PEEKS", "peekCount", "peekOrder", "latestPeeks", "strains", "milestoneCrossed", "FLURRY_COOLDOWN_MS", "flurryKind", "flurryDue", "flurryPlan", "NOTES", "noteKind", "noteFor", "allNotes", "notePlacements", "quadTouches"]) delete stub[k];
    return stub;
  };

  it("with the old catalogue: the whole layer is off, and the total, status, Donate and checkout all work", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    start({ catalogue: old() });
    expect(api).not.toBeNull();
    giving();
    expect($(".rb-fx, .rb-drop, .rb-note, .rb-flurry, .rb-bag__peeks, .rb-bag__tie, .rb-also__icon")).toBeNull();
    expect($(".rb-bag.is-wobbling")).toBeNull();
    stillWorks();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // The catalogue as it was on 4 October 2026 (the first feel good layer), with this newer script: it
  // has peekSlots and no latestPeeks, peekOrder or flurry plan. All off, and the page works.
  it("with the catalogue from before the peeks and the snow changed: the whole layer is off, and the page works", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stub: Record<string, unknown> = { ...catalogue, peekSlots: () => [null, null, null] };
    for (const k of ["peekOrder", "latestPeeks", "FLURRY_COOLDOWN_MS", "flurryKind", "flurryDue", "flurryPlan"]) delete stub[k];
    start({ catalogue: stub });
    giving();
    expect($(".rb-fx, .rb-drop, .rb-note, .rb-flurry, .rb-bag__peeks, .rb-bag__tie, .rb-also__icon")).toBeNull();
    stillWorks();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("with only some of the layer's functions: it is all off, not half on", () => {
    const stub = old();
    stub.art = catalogue.art;
    stub.ART = catalogue.ART;
    start({ catalogue: stub });
    giving();
    expect($(".rb-fx, .rb-drop, .rb-note, .rb-flurry, .rb-bag__peeks, .rb-also__icon")).toBeNull();
    stillWorks();
  });

  for (const broken of ["peekOrder", "latestPeeks", "milestoneCrossed", "flurryDue", "flurryKind", "flurryPlan", "strains", "noteKind", "noteFor", "art"]) {
    it(`when ${broken} throws: it is swallowed, said once in the console, and the page carries on`, () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      start({
        catalogue: {
          ...catalogue,
          [broken]: () => {
            throw new Error("invented failure");
          },
        },
      });
      expect(api).not.toBeNull();
      giving();
      stillWorks();
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  }
});
