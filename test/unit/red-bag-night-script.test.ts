// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderRedBagPage } from "../../src/red-bag/render";
import type { RedBagList } from "../../src/red-bag/list";

// The night treatment on /fill, in the browser: assets/js/fill-night.js listening to the page's own
// script (assets/js/red-bag.js), over the page exactly as the server draws it at night, and the
// stylesheet's promises. The lights and the sum come from the page's own total, never from its words.
// Every name and price here is invented.

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const require = createRequire(import.meta.url);
const rules = require(resolve(ROOT, "assets/js/red-bag-list.js"));
const catalogue = require(resolve(ROOT, "assets/js/red-bag-catalogue.js"));
const { initRedBag } = require(resolve(ROOT, "assets/js/red-bag.js")) as {
  initRedBag: (doc: Document, win: unknown) => { total: () => number; payload: () => Record<string, unknown> } | null;
};
const { initFillNight } = require(resolve(ROOT, "assets/js/fill-night.js")) as {
  initFillNight: (doc: Document, win: unknown) => unknown;
};
const template = read("fill-a-red-bag.html");
const CSS = read("assets/css/fill-night.css");

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const row = (key: string) => $(`[data-rb-item="${key}"]`);
const plus = (key: string, times = 1) => {
  for (let i = 0; i < times; i += 1) (row(key).querySelector("[data-rb-plus]") as HTMLButtonElement).click();
};
const minus = (key: string) => (row(key).querySelector("[data-rb-minus]") as HTMLButtonElement).click();
const lit = () => document.querySelectorAll(".fb-lights .bulb.on").length;
const sum = () => $("#fnSum");
const night = () => $("#fnNight");
const pause = () => $<HTMLButtonElement>("#fnPause");

const PRICES: Record<string, number> = { toy: 2500, socks: 500, pencil: 10, blanket: 4990 };
function invented(): RedBagList {
  const list = rules.builtIn() as RedBagList;
  for (const item of list.items) {
    item.hidden = !(item.key in PRICES);
    if (item.key in PRICES) item.pence = PRICES[item.key];
  }
  return list;
}

let frames: Array<(now: number) => void>;
let drawn: number;
let seen: ((yes: boolean) => void) | null;
let rebuilt: (() => void) | null;
let api: ReturnType<typeof initRedBag>;
let win: Record<string, unknown>;

const fakeContext = () => ({
  clearRect: () => {
    drawn += 1;
  },
  setTransform: () => undefined,
  beginPath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  closePath: () => undefined,
  arc: () => undefined,
  fill: () => undefined,
});

interface Start {
  reduce?: boolean;
  noCanvas?: boolean;
  noObservers?: boolean;
  noRedBag?: boolean;
  noNight?: boolean;
  search?: string;
  plainPage?: boolean;
}

function start(opts: Start = {}) {
  const html = renderRedBagPage(template, { preview: false, list: invented(), night: opts.plainPage !== true });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  document.body.classList.remove("rb-bar-on");
  expect(catalogue.useListFrom(parsed)).toBe(true);
  frames = [];
  drawn = 0;
  seen = null;
  rebuilt = null;
  HTMLCanvasElement.prototype.getContext = (opts.noCanvas ? () => null : fakeContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  win = {
    NBCCRedBag: catalogue,
    CustomEvent: window.CustomEvent,
    matchMedia: (q: string) => ({ matches: opts.reduce === true && q.includes("reduce") }),
    requestAnimationFrame: (cb: (now: number) => void) => frames.push(cb),
    performance: { now: () => 0 },
    devicePixelRatio: 2,
    addEventListener: () => undefined,
    location: { href: "", pathname: "/fill", search: opts.search ?? "", hash: "" },
    history: { state: null, replaceState: () => undefined },
    fetch: () => Promise.reject(new Error("no")),
    navigator: {},
  };
  if (!opts.noObservers) {
    win.IntersectionObserver = class {
      cb: (es: Array<{ isIntersecting: boolean }>) => void;
      constructor(cb: (es: Array<{ isIntersecting: boolean }>) => void) {
        this.cb = cb;
      }
      observe(el: Element) {
        if (el.id === "fnNight") seen = (yes) => this.cb([{ isIntersecting: yes }]);
      }
    };
    win.ResizeObserver = class {
      cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
      }
      observe() {
        rebuilt = this.cb;
      }
    };
  }
  // In the order the page loads them: the night first, so it hears the page's first word.
  if (!opts.noNight) initFillNight(document, win);
  if (!opts.noRedBag) api = initRedBag(document, win);
}

const runFrames = (n = 1) => {
  for (let i = 0; i < n; i += 1) {
    const now = frames.splice(0);
    now.forEach((f) => f(1000 + i * 16));
  }
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the page's small hook", () => {
  const heard = () => {
    const out: Array<{ pence: number; bags: number }> = [];
    document.addEventListener("rb:bag", ((e: CustomEvent) => out.push(e.detail)) as EventListener);
    return out;
  };

  it("says the total and how many bags are drawn, from the page's own state", () => {
    start({ noNight: true });
    const said = heard();
    plus("toy");
    expect(said[said.length - 1]).toEqual({ pence: 2500, bags: 1 });
    plus("toy", 2);
    expect(said[said.length - 1]).toEqual({ pence: 7500, bags: 2 });
  });

  it("counts a round-up, because the lights follow the total shown", () => {
    start({ noNight: true });
    plus("socks");
    const said = heard();
    $<HTMLButtonElement>("[data-rb-round]").click();
    expect(said[said.length - 1].pence).toBe(2500);
    expect(api!.total()).toBe(2500);
  });

  it("says each change once", () => {
    start({ noNight: true });
    const said = heard();
    plus("socks");
    expect(said).toHaveLength(1);
  });

  it("does nothing at all where the browser has no such event", () => {
    start({ noNight: true });
    delete win.CustomEvent;
    plus("toy");
    expect(api!.total()).toBe(2500);
  });

  it("cannot be stopped by a listener that fails", () => {
    start({ noNight: true });
    const reported = vi.fn((e: ErrorEvent) => e.preventDefault());
    const fails = () => {
      throw new Error("a listener's own trouble");
    };
    window.addEventListener("error", reported);
    document.addEventListener("rb:bag", fails);
    plus("toy");
    document.removeEventListener("rb:bag", fails);
    window.removeEventListener("error", reported);
    expect(api!.total()).toBe(2500);
    expect($("[data-rb-total]").textContent).toBe("£25");
    errors.mockClear();
  });

  it("changes nothing the page sends", () => {
    start({ noNight: true });
    plus("toy");
    const quiet = JSON.stringify(api!.payload());
    start();
    plus("toy");
    expect(JSON.stringify(api!.payload())).toBe(quiet);
  });
});

describe("the lights", () => {
  it("are all off for an empty bag", () => {
    start();
    expect(document.querySelectorAll(".fb-lights .bulb")).toHaveLength(10);
    expect(lit()).toBe(0);
  });

  it("light one for every £5 of the first £50, from the real total", () => {
    start();
    plus("socks");
    expect(lit()).toBe(1);
    plus("socks");
    expect(lit()).toBe(2);
    plus("toy");
    expect(lit()).toBe(7);
  });

  it("do not light for less than £5", () => {
    start();
    plus("pencil", 49);
    expect(api!.total()).toBe(490);
    expect(lit()).toBe(0);
  });

  it("stop at nine for £49.90, and all ten come on at £50", () => {
    start();
    plus("blanket");
    expect(api!.total()).toBe(4990);
    expect(lit()).toBe(9);
    plus("pencil");
    expect(api!.total()).toBe(5000);
    expect(lit()).toBe(10);
  });

  it("stay at ten beyond £50", () => {
    start();
    plus("toy", 9);
    expect(lit()).toBe(10);
  });

  it("go out again as things come out", () => {
    start();
    plus("toy", 2);
    expect(lit()).toBe(10);
    minus("toy");
    expect(lit()).toBe(5);
  });

  it("count a round-up", () => {
    start();
    plus("socks");
    $<HTMLButtonElement>("[data-rb-round]").click();
    expect(lit()).toBe(5);
  });

  it("do not read the words on the page", () => {
    start();
    plus("socks");
    $("[data-rb-total]").textContent = "£1,000";
    expect(lit()).toBe(1);
  });
});

describe("the sum on the bag", () => {
  it("shows from the start, once the script is there to keep it true", () => {
    start();
    expect(sum().hidden).toBe(false);
    expect(sum().querySelector("b")!.textContent).toBe("£0");
    expect(sum().textContent).toContain("of £50");
  });

  it("follows the total", () => {
    start();
    plus("toy");
    plus("pencil");
    expect(sum().querySelector("b")!.textContent).toBe("£25.10");
  });

  it("is hidden for a full bag", () => {
    start();
    plus("toy", 2);
    expect(sum().hidden).toBe(true);
    expect(night().classList.contains("full")).toBe(true);
  });

  it("is hidden for several bags", () => {
    start();
    plus("toy", 3);
    expect(document.querySelectorAll("[data-rb-bags] .rb-bag")).toHaveLength(2);
    expect(sum().hidden).toBe(true);
  });

  it("comes back as the bag empties", () => {
    start();
    plus("toy", 3);
    minus("toy");
    minus("toy");
    expect(sum().hidden).toBe(false);
    expect(night().classList.contains("full")).toBe(false);
  });

  it("stays hidden where the night's script never ran", () => {
    start({ noNight: true });
    plus("toy");
    expect(sum().hidden).toBe(true);
  });
});

describe("a carried bag at night", () => {
  it("lights up with what drops in", () => {
    start({ search: "?bag=toy:2" });
    expect(lit()).toBe(5);
    vi.advanceTimersByTime(380);
    expect(lit()).toBe(10);
    expect(sum().hidden).toBe(true);
  });

  it("is all there at once with less motion", () => {
    start({ search: "?bag=toy:1,socks:1", reduce: true });
    expect(lit()).toBe(6);
    expect(sum().querySelector("b")!.textContent).toBe("£30");
  });
});

describe("the snow", () => {
  it("falls once the page is on screen", () => {
    start();
    seen!(true);
    runFrames(3);
    expect(drawn).toBeGreaterThan(1);
  });

  it("pauses off screen and picks up again", () => {
    start();
    seen!(true);
    runFrames(2);
    seen!(false);
    runFrames(1);
    const stopped = drawn;
    expect(frames).toHaveLength(0);
    seen!(true);
    runFrames(2);
    expect(drawn).toBeGreaterThan(stopped);
  });

  it("does not start off screen", () => {
    start();
    expect(frames).toHaveLength(0);
  });

  it("is held by Pause the snow, whose words change, with no pressed state to hear as well", () => {
    start();
    seen!(true);
    runFrames(1);
    expect(pause().hidden).toBe(false);
    expect(pause().textContent).toBe("Pause the snow");
    pause().click();
    expect(pause().textContent).toBe("Start the snow");
    expect(pause().hasAttribute("aria-pressed")).toBe(false);
    expect(night().classList.contains("held")).toBe(true);
    runFrames(1);
    const held = drawn;
    runFrames(3);
    expect(drawn).toBe(held);
    pause().click();
    expect(pause().textContent).toBe("Pause the snow");
    expect(night().classList.contains("held")).toBe(false);
    runFrames(2);
    expect(drawn).toBeGreaterThan(held);
  });

  it("leaves the bag working while paused", () => {
    start();
    pause().click();
    plus("socks");
    expect(lit()).toBe(1);
  });

  it("does not run twice over when Pause is pressed quickly", () => {
    start();
    seen!(true);
    pause().click();
    pause().click();
    pause().click();
    pause().click();
    expect(frames).toHaveLength(1);
  });

  it("does not fall for someone who has asked for less motion, and offers no Pause", () => {
    start({ reduce: true });
    seen?.(true);
    expect(frames).toHaveLength(0);
    expect(drawn).toBe(0);
    expect(pause().hidden).toBe(true);
    plus("socks");
    expect(lit()).toBe(1);
  });

  it("leaves the page working where there is no canvas, and offers no Pause", () => {
    start({ noCanvas: true });
    expect(frames).toHaveLength(0);
    expect(pause().hidden).toBe(true);
    plus("toy");
    expect(lit()).toBe(5);
  });

  it("leaves the page working where the canvas throws", () => {
    HTMLCanvasElement.prototype.getContext = (() => {
      throw new Error("blocked");
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    document.body.innerHTML = renderRedBagPage(template, { preview: false, list: invented(), night: true });
    expect(() => initFillNight(document, { NBCCRedBag: catalogue, matchMedia: () => ({ matches: false }) })).not.toThrow();
  });

  it("works with no observers in the browser", () => {
    start({ noObservers: true });
    runFrames(2);
    expect(drawn).toBeGreaterThan(0);
  });

  it("never asks a phone for a sky bigger than it can hold, however long the page", () => {
    start();
    const sky = $<HTMLCanvasElement>(".fn-sky");
    Object.defineProperty(night(), "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(night(), "clientHeight", { value: 12000, configurable: true });
    rebuilt!();
    expect(sky.width * sky.height).toBeLessThanOrEqual(6000000);
    expect(sky.width).toBeGreaterThan(0);
  });
});

describe("on a page with no night", () => {
  it("does nothing", () => {
    start({ plainPage: true });
    expect(initFillNight(document, win)).toBeNull();
  });

  it("does nothing without the catalogue", () => {
    start();
    expect(initFillNight(document, {})).toBeNull();
    expect(initFillNight(document, undefined)).toBeNull();
  });
});

describe("the page's script with the night absent", () => {
  it("works on the night's markup all the same", () => {
    start({ noNight: true, search: "?bag=toy:1" });
    settleOnly();
    expect(api!.total()).toBe(2500);
  });
  const settleOnly = () => vi.advanceTimersByTime(5000);
});

describe("the stylesheet", () => {
  const rule = (selector: string) => {
    const at = CSS.indexOf(`${selector}{`);
    expect(at, selector).toBeGreaterThan(-1);
    return CSS.slice(at, CSS.indexOf("}", at));
  };

  it("never lets anything scroll inside a box", () => {
    expect(CSS).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });

  it("leans on nothing of the stage's, which /fill does not load", () => {
    expect(CSS).not.toMatch(/(^|[\s,}])\.fb(\.|\s|\{|,)/m);
    expect(CSS).not.toContain("--ease");
  });

  it("moves with transform and opacity, and stops for less motion", () => {
    expect(CSS).toContain("@media (prefers-reduced-motion:reduce)");
  });

  it("keeps the panel's own colours off the night's", () => {
    expect(rule(".fn-night .rb-panel")).toContain("color:var(--slate)");
    expect(rule(".fn-night .rb-panel")).toContain("background:var(--cream)");
    expect(CSS).toMatch(/\.fn-night \.rb-paper\{[^}]*color:var\(--slate\)/);
  });

  it("keeps a pressed example readable, hovered or not", () => {
    expect(rule('.fn-night .rb-example[aria-pressed="true"],.fn-night .rb-example[aria-pressed="true"]:hover')).toContain("color:var(--cream)");
    expect(CSS.indexOf(".fn-night .rb-example:hover")).toBeLessThan(CSS.indexOf('.fn-night .rb-example[aria-pressed="true"]'));
  });

  it("keeps a hovered example readable", () => {
    expect(rule(".fn-night .rb-example:hover")).toContain("color:var(--slate)");
  });

  it("hides the sum when the page says so, whatever else it is", () => {
    expect(CSS).toContain(".fn-sum[hidden]");
  });

  it("cuts the elf above the logo's line, and keeps the cut behind a heap of snow", () => {
    const elf = rule(".fn-elf");
    expect(elf).toContain("aspect-ratio:150/98");
    expect(elf).toContain("object-fit:cover");
    expect(elf).toContain("object-position:50% 0");
    expect(elf).toContain("z-index:0");
    const heap = rule(".fn-night .rb-panel::after");
    expect(heap).toContain("z-index:2");
    expect(heap).toContain("background:var(--cream)");
    expect(heap).toContain("var(--elf-left)");
  });

  it("sends the elf away when several bags fill the width", () => {
    expect(CSS).toContain('.fn-night .rb-panel:has(.rb-bags:not([data-count="1"])) .fn-elf{display:none}');
  });

  it("gives the sum a place worked from the width alone, as the bag's size is", () => {
    expect(rule(".fn-sum")).toMatch(/padding:0 calc\(100% - var\(--bag-left\)/);
    expect(rule(".fn-sum")).not.toMatch(/(^|;)bottom:/);
  });

  it("keeps the menu's strip above the lights' ends", () => {
    expect(rule(".fn-night::before")).toContain("z-index:1");
    expect(rule(".fn-night .fb-lights")).toContain("z-index:0");
  });

  it("dims the glow where the words sit over it", () => {
    const stacked = CSS.slice(CSS.indexOf("@media (max-width:860px)"));
    expect(stacked).toMatch(/\.fn-night\{background:radial-gradient/);
  });

  it("changes layout where the page does, at 860px", () => {
    expect(CSS).toContain("@media (max-width:860px)");
  });
});
