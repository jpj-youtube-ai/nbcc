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
const peeks = (bag: Element) => [...bag.querySelectorAll("[data-rb-peek]")].map((p) => p.getAttribute("data-rb-peek"));

let fetchMock: ReturnType<typeof vi.fn>;
let api: ReturnType<typeof initRedBag>;
let watchers: Array<{ el: Element | null; say: (onScreen: boolean) => void }>;

function start(opts: { reduce?: boolean } = {}) {
  const html = renderRedBagPage(template, { preview: false });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  document.body.classList.remove("rb-bar-on");
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
    NBCCRedBag: catalogue,
    addEventListener: () => undefined,
    fetch: fetchMock,
    innerHeight: 800,
    location: { href: "", pathname: "/fill", search: "" },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    matchMedia: (q: string) => ({ matches: !!opts.reduce && /prefers-reduced-motion/.test(q) }),
    navigator: {},
  };
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
    expect($("[data-rb-bar-total]").classList.contains("is-bumped")).toBe(true);
    vi.advanceTimersByTime(2000);
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

  it("follows the bag: more as it fills, three at most, and each gone when its item is taken out", () => {
    plus("blanket");
    plus("book");
    expect(peeks(bags()[0])).toEqual(["blanket"]);
    plus("headphones");
    expect(peeks(bags()[0])).toEqual(["blanket", "headphones"]);
    plus("toy");
    expect(peeks(bags()[0])).toEqual(["blanket", "headphones", "toy"]);
    type("socks", "10");
    plus("pencil");
    expect(peeks(bags()[0]).length).toBe(3);
    expect(peeks(bags()[0])).toContain("blanket");
    minus("blanket");
    expect(peeks(bags()[0])).not.toContain("blanket");
    for (const key of peeks(bags()[0])) expect(Number(box(key!).value)).toBeGreaterThan(0);
  });

  it("shows nothing for examples or a round-up alone", () => {
    example("school-40").click();
    expect(peeks(bags()[0])).toEqual([]);
  });

  it("is empty again when the bag is", () => {
    plus("socks");
    minus("socks");
    expect(peeks(bags()[0])).toEqual([]);
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
    expect(bags()[0].classList.contains("is-full")).toBe(false);
    expect(bags()[0].classList.contains("is-latest")).toBe(false);
    expect(peeks(bags()[0])).toEqual(["socks"]);
  });

  it("keeps the first bag tied while the second fills, with the peeks in the one that is filling", () => {
    type("socks", "60");
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

describe("the snow and stars", () => {
  const flurries = () => $$(".rb-flurry");

  it("falls once at half a bag, over the bag's panel, taking no tap, and clears completely", () => {
    type("socks", "24");
    expect(flurries().length).toBe(0);
    plus("socks");
    expect(flurries().length).toBe(1);
    const f = flurries()[0];
    expect(f.parentElement).toBe($(".rb-panel"));
    expect(f.getAttribute("aria-hidden")).toBe("true");
    expect(f.querySelectorAll(".rb-flake").length).toBeGreaterThan(8);
    expect(f.querySelectorAll(".rb-flake").length).toBeLessThanOrEqual(16);
    for (const flake of f.querySelectorAll<HTMLElement>(".rb-flake")) {
      const wait = Number.parseFloat(flake.style.getPropertyValue("--rb-d")) + Number.parseFloat(flake.style.getPropertyValue("--rb-t"));
      expect(wait).toBeLessThanOrEqual(2.05);
    }
    vi.advanceTimersByTime(2300);
    expect(flurries().length).toBe(0);
  });

  it("does not fall again while the total goes on up past the milestone", () => {
    type("socks", "25");
    vi.advanceTimersByTime(3000);
    plus("socks", 3);
    expect(flurries().length).toBe(0);
  });

  it("falls again only after the total has dropped below the milestone and come back", () => {
    type("socks", "25");
    vi.advanceTimersByTime(3000);
    minus("socks");
    expect(flurries().length).toBe(0);
    plus("socks");
    expect(flurries().length).toBe(1);
  });

  it("falls at each full bag", () => {
    type("socks", "49");
    vi.advanceTimersByTime(3000);
    plus("socks");
    expect(flurries().length).toBe(1);
    vi.advanceTimersByTime(3000);
    type("blanket", "6");
    expect(api!.total()).toBe(9800);
    expect(flurries().length).toBe(0);
    plus("socks", 2);
    expect(api!.total()).toBe(10000);
    expect(flurries().length).toBe(1);
  });

  it("is never doubled: one at a time", () => {
    type("socks", "25");
    type("socks", "50");
    expect(flurries().length).toBe(1);
  });

  it("falls for a round-up that reaches the milestone", () => {
    plus("blanket");
    vi.advanceTimersByTime(3000);
    $<HTMLButtonElement>("[data-rb-round]").click();
    expect(api!.total()).toBe(2500);
    expect(flurries().length).toBe(1);
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
    expect(note().textContent).toContain("3 pairs of socks");
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
    expect($(".rb-bag.is-wobbling")).toBeNull();
    expect($("[data-rb-bar-total]").classList.contains("is-bumped")).toBe(false);
  });

  it("still changes what is shown, at once: the peek, the ribbon and tag, and the note", () => {
    plus("socks");
    expect(peeks(bags()[0])).toEqual(["socks"]);
    expect(note().classList.contains("is-on")).toBe(true);
    type("socks", "50");
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
