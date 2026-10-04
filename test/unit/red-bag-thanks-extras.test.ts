// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderRedBagThanksPage } from "../../src/red-bag/render";
import { containsBlockedWord } from "../../src/donors/display-name-filter";
import { MATERIALS_STATEMENT } from "../../src/legal/registration";

// Fill a Red Bag: the feel good pieces on the thank you page, /fill/thank-you, driven in jsdom over
// the page exactly as the server draws it:
//   - the Elves' Workshop scene (assets/js/red-bag-workshop.js): for the eye only, plays once, rests;
//   - a name on the picture to share, which never leaves the browser and is screened for abuse;
//   - a certificate to print, with no amount on it.
// Every name here is made up.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const catalogue = require(resolve(ROOT, "assets/js/red-bag-catalogue.js"));
const workshop = require(resolve(ROOT, "assets/js/red-bag-workshop.js")) as {
  scene: (count: number) => string;
  tiedBag: (opts?: { words?: boolean }) => string;
  mount: (...a: unknown[]) => unknown;
};
const thanksScript = require(resolve(ROOT, "assets/js/red-bag-thanks.js")) as {
  initThanks: (doc: Document, win: unknown) => unknown;
  bagsFilled: (gift: unknown, rb: unknown) => number;
  cleanName: (raw: string) => string;
  nameBlocked: (name: string, lists: unknown) => boolean;
  pictureHeadline: (name: string, bags: number) => string;
  certificateFor: (bags: number) => string;
  longDate: (d: Date) => string;
};
const { initThanks, bagsFilled, cleanName, nameBlocked, pictureHeadline, certificateFor, longDate } = thanksScript;
const template = readFileSync(resolve(ROOT, "fill-thank-you.html"), "utf8");
const page = renderRedBagThanksPage(template, { preview: false });

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const text = (sel: string) => ($(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
const LINE = "Bag packed. The elves will take it from here.";

interface Opts {
  kept?: Record<string, string>;
  reduce?: boolean;
  canvas?: boolean;
  workshop?: unknown;
  timers?: boolean;
  body?: string;
  matchMedia?: unknown;
}

let drawn: string[];
let print: ReturnType<typeof vi.fn>;
let winFetch: ReturnType<typeof vi.fn>;
let beacon: ReturnType<typeof vi.fn>;
let timers: Array<() => void>;
let listeners: Record<string, Array<() => void>>;
let errors: ReturnType<typeof vi.spyOn>;

function fakeCanvas() {
  drawn = [];
  const ctx: Record<string, unknown> = new Proxy(
    { font: "" } as Record<string, unknown>,
    {
      get(target, key: string) {
        if (key in target && key !== "font") return target[key];
        if (key === "fillText") return (t: string) => void drawn.push(t);
        // Half an em a letter: enough to make a long line too wide, as a real face would.
        if (key === "measureText") return (t: string) => ({ width: t.length * 0.5 * (parseFloat(String(/(\d+)px/.exec(String(target.font))?.[1] ?? "10")) || 10) });
        if (key in target) return target[key];
        return () => undefined;
      },
      set(target, key: string, value) {
        target[key] = value;
        return true;
      },
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
}

function start(opts: Opts = {}) {
  const parsed = new DOMParser().parseFromString(opts.body ?? page, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  document.documentElement.className = "";
  const store = new Map(Object.entries(opts.kept ?? {}));
  if (opts.canvas) fakeCanvas();
  print = vi.fn();
  winFetch = vi.fn();
  beacon = vi.fn();
  timers = [];
  listeners = {};
  const win: Record<string, unknown> = {
    NBCCRedBag: catalogue,
    NBCCRedBagWorkshop: "workshop" in opts ? opts.workshop : workshop,
    location: { pathname: "/fill/thank-you", search: "" },
    history: { replaceState: vi.fn() },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    navigator: { sendBeacon: beacon },
    matchMedia: "matchMedia" in opts ? opts.matchMedia : (q: string) => ({ matches: /reduce/.test(q) && !!opts.reduce }),
    Path2D: function Path2D() {},
    print,
    fetch: winFetch,
    addEventListener: (name: string, fn: () => void) => void (listeners[name] = listeners[name] ?? []).push(fn),
  };
  if (opts.timers) win.setTimeout = (fn: () => void) => timers.push(fn);
  return initThanks(document, win);
}
const kept = (gift: unknown) => ({ nbcc_red_bag_gift: JSON.stringify(gift) });
const gift = (pence: number, more: Record<string, unknown> = {}) => kept({ pence, giftAid: false, monthly: false, ...more });

function type(value: string) {
  const input = $<HTMLInputElement>("#rbShareName");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}

beforeEach(() => {
  document.body.innerHTML = "";
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("how many bags they filled", () => {
  it("is one bag for each full £50 of what the tab remembered, and never fewer than one", () => {
    expect(bagsFilled({ pence: 200 }, catalogue)).toBe(1);
    expect(bagsFilled({ pence: 4999 }, catalogue)).toBe(1);
    expect(bagsFilled({ pence: 5000 }, catalogue)).toBe(1);
    expect(bagsFilled({ pence: 9999 }, catalogue)).toBe(1);
    expect(bagsFilled({ pence: 10000 }, catalogue)).toBe(2);
    expect(bagsFilled({ pence: 15000, monthly: true }, catalogue)).toBe(3);
    expect(bagsFilled({ pence: 100000 }, catalogue)).toBe(20);
  });

  it("is one bag when nothing was remembered, or it is not a total", () => {
    for (const g of [null, undefined, {}, { pence: "lots" }, { pence: -5 }, { pence: 20.5 }, { pence: 1e21 }]) expect(bagsFilled(g, catalogue)).toBe(1);
  });
});

describe("the Workshop scene's drawing", () => {
  it("is one picture, for the eye only", () => {
    const svg = workshop.scene(1);
    expect(svg.match(/<svg /g)?.length).toBe(1);
    expect(svg).toMatch(/^<svg class="rbw"[^>]* aria-hidden="true"[^>]* focusable="false"/);
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  it("has a shelf with a few tied bags on it, a hanging lamp, the donor's tied bag with its tag, and an elf", () => {
    const d = new DOMParser().parseFromString(workshop.scene(1), "image/svg+xml");
    expect(d.querySelector(".rbw-shelf")).not.toBeNull();
    expect(d.querySelector(".rbw-lamp")).not.toBeNull();
    expect(d.querySelector(".rbw-elf")).not.toBeNull();
    expect(d.querySelectorAll(".rbw-bag--other").length).toBeGreaterThanOrEqual(2);
    expect(d.querySelectorAll(".rbw-bag--yours").length).toBe(1);
    const yours = d.querySelector(".rbw-bag--yours")!;
    expect(yours.querySelector(".rbw-ribbon")).not.toBeNull();
    expect(yours.querySelector(".rbw-tag")).not.toBeNull();
    expect((yours.querySelector("text")?.textContent ?? "").replace(/\s+/g, " ").trim()).toBe("Packed with love");
    // Every bag on the shelf is tied.
    for (const b of d.querySelectorAll(".rbw-bag")) expect(b.querySelector(".rbw-ribbon")).not.toBeNull();
  });

  it("shows as many of the donor's bags as they filled, five at most, and one for anything odd", () => {
    const yours = (n: unknown) => new DOMParser().parseFromString(workshop.scene(n as number), "image/svg+xml").querySelectorAll(".rbw-bag--yours").length;
    expect(yours(2)).toBe(2);
    expect(yours(3)).toBe(3);
    expect(yours(5)).toBe(5);
    expect(yours(9)).toBe(5);
    for (const odd of [0, -1, NaN, "three", undefined, 1.5]) expect(yours(odd)).toBe(1);
  });

  it("carries no colour of its own, no link, no script and nothing from another address", () => {
    for (const n of [1, 5]) {
      const svg = workshop.scene(n);
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|style=|<script|href|https?:|<image|<animate/);
    }
  });

  it("does not use the catalogue's drawings' class, so the giving page's styles stay its own", () => {
    expect(workshop.scene(1)).not.toContain("rb-art");
    expect(workshop.scene(1)).not.toContain('class="rb-bag');
  });
});

describe("watching it leave the Workshop", () => {
  it("plays once on arrival after a gift, then rests", () => {
    start({ kept: gift(5410), timers: true });
    const box = $("[data-rb-workshop]");
    const scene = $("[data-rb-workshop-scene]");
    expect(scene.hidden).toBe(false);
    expect(scene.getAttribute("aria-hidden")).toBe("true");
    expect(scene.querySelectorAll("svg.rbw").length).toBe(1);
    expect(box.classList.contains("is-playing")).toBe(true);
    expect(box.classList.contains("is-rested")).toBe(false);
    // The still bag gives way to the scene.
    expect($(".rb-thanks__bag").hidden).toBe(true);
    // The line's own fade is the last thing to finish.
    $("[data-rb-workshop-line]").dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(box.classList.contains("is-playing")).toBe(false);
    expect(box.classList.contains("is-rested")).toBe(true);
    // Nothing starts it again.
    for (const t of timers) t();
    $("[data-rb-workshop-line]").dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(box.classList.contains("is-playing")).toBe(false);
    expect(scene.querySelectorAll("svg.rbw").length).toBe(1);
    expect(document.querySelector("[data-rb-workshop] button")).toBeNull();
  });

  it("rests by the clock too, where the browser never says the animation ended", () => {
    start({ kept: gift(5410), timers: true });
    expect($("[data-rb-workshop]").classList.contains("is-playing")).toBe(true);
    expect(timers.length).toBeGreaterThan(0);
    for (const t of timers) t();
    expect($("[data-rb-workshop]").classList.contains("is-playing")).toBe(false);
    expect($("[data-rb-workshop]").classList.contains("is-rested")).toBe(true);
  });

  it("does not move for someone who asked for less motion: the end state at once", () => {
    start({ kept: gift(5410), reduce: true, timers: true });
    const box = $("[data-rb-workshop]");
    expect(box.classList.contains("is-playing")).toBe(false);
    expect(box.classList.contains("is-rested")).toBe(true);
    expect($("[data-rb-workshop-scene] svg.rbw")).not.toBeNull();
  });

  it("opened without a remembered gift, shows the same scene at rest: one bag, no lift", () => {
    start();
    const box = $("[data-rb-workshop]");
    expect(box.classList.contains("is-playing")).toBe(false);
    expect(box.classList.contains("is-rested")).toBe(true);
    expect(document.querySelectorAll("[data-rb-workshop-scene] .rbw-bag--yours").length).toBe(1);
    expect($("[data-rb-thanks-plain]").hidden).toBe(false);
  });

  it("puts their bags on the shelf: two for £100, three for £150, five at most", () => {
    start({ kept: gift(10000) });
    expect(document.querySelectorAll("[data-rb-workshop-scene] .rbw-bag--yours").length).toBe(2);
    start({ kept: gift(15000) });
    expect(document.querySelectorAll("[data-rb-workshop-scene] .rbw-bag--yours").length).toBe(3);
    start({ kept: gift(60000) });
    expect(document.querySelectorAll("[data-rb-workshop-scene] .rbw-bag--yours").length).toBe(5);
  });

  it("says the line in the owner's words, as real text, read once: not a live region", () => {
    start({ kept: gift(5410) });
    const line = $("[data-rb-workshop-line]");
    expect(text("[data-rb-workshop-line]")).toBe(LINE);
    expect(line.hidden).toBe(false);
    expect(line.closest("[aria-hidden='true']")).toBeNull();
    expect(line.closest("[aria-live]")).toBeNull();
    expect(line.hasAttribute("aria-live")).toBe(false);
    expect(line.getAttribute("role")).toBeNull();
    expect(document.body.innerHTML.split(LINE).length - 1).toBe(1);
    // The focus still lands on the heading.
    expect(document.activeElement).toBe($("h1"));
  });

  it("keeps the still bag, and everything else working, when the scene's code is not there or throws", () => {
    for (const broken of [
      undefined,
      {},
      {
        mount() {
          throw new Error("scene broke");
        },
      },
    ]) {
      start({ kept: gift(4000, { giftAid: true }), workshop: broken, canvas: true });
      expect($(".rb-thanks__bag").hidden).toBe(false);
      expect($(".rb-thanks__bag .rb-bag").classList.contains("is-full")).toBe(true);
      expect($("[data-rb-workshop-scene]").hidden).toBe(true);
      expect($("[data-rb-workshop]").classList.contains("is-playing")).toBe(false);
      expect(text("[data-rb-thanks-total]")).toBe("Your donation of £40 is on its way to NBCC.");
      expect($("[data-rb-thanks-giftaid]").hidden).toBe(false);
      expect(document.activeElement).toBe($("h1"));
      expect($("[data-rb-name]").hidden).toBe(false);
    }
    // Said once in the console, and no more.
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("is at rest where the browser cannot say whether less motion was asked for", () => {
    start({
      kept: gift(5410),
      matchMedia: () => {
        throw new Error("no media queries");
      },
    });
    expect($("[data-rb-workshop]").classList.contains("is-playing")).toBe(false);
    expect($("[data-rb-workshop]").classList.contains("is-rested")).toBe(true);
    expect(text("[data-rb-thanks-total]")).toBe("Your donation of £54.10 is on its way to NBCC.");
  });
});

describe("a name for the picture: what is kept of what is typed", () => {
  it("trims it, and closes up runs of spaces", () => {
    expect(cleanName("  Maple   Class  ")).toBe("Maple Class");
    expect(cleanName("")).toBe("");
    expect(cleanName("    ")).toBe("");
  });

  it("keeps letters, numbers, spaces and plain punctuation, and drops everything else", () => {
    expect(cleanName("Primary 4, Room 2!")).toBe("Primary 4, Room 2!");
    expect(cleanName("The O'Hara-Lindqvist family")).toBe("The O'Hara-Lindqvist family");
    expect(cleanName("Zoë & Søren")).toBe("Zoë & Søren");
    expect(cleanName("<b>Fern</b>")).toBe("bFernb");
    expect(cleanName("Fern £50 @home #1 \u{1F381}")).toBe("Fern 50 home 1");
    expect(cleanName("a\nb\tc")).toBe("a b c");
  });

  it("stops at 30 characters", () => {
    const long = "The Willowbank Street Knitting Circle of Friends";
    expect(cleanName(long)).toBe("The Willowbank Street Knitting");
    expect(cleanName(long).length).toBeLessThanOrEqual(30);
  });
});

describe("a name for the picture: screening", () => {
  const lists = JSON.parse(new DOMParser().parseFromString(page, "text/html").querySelector("script[data-rb-name-filter]")!.textContent!);

  it("uses the supporter wall's own filter, drawn into the page: the same answer for every name", () => {
    const names = ["Maple Class", "Scunthorpe Juniors", "The Cockburn family", "Dickens Reading Group", "Assisi House", "", "shit", "Total SHIT ltd", "best4n1gger", "a.s.s", "fag", "Fagan's", "what the fuck", "f u c k", "Essex Pass Club", "nigga please"];
    for (const n of names) expect(nameBlocked(n, lists), n).toBe(containsBlockedWord(n));
    expect(nameBlocked("Total SHIT ltd", lists)).toBe(true);
    expect(nameBlocked("Scunthorpe Juniors", lists)).toBe(false);
  });

  it("carries every word of that filter, and no other list", () => {
    expect(Array.isArray(lists.words) && lists.words.length > 20).toBe(true);
    for (const w of lists.words) expect(containsBlockedWord(w), w).toBe(true);
    for (const w of lists.inside) expect(containsBlockedWord(`xx${w}xx`), w).toBe(true);
    const source = readFileSync(resolve(ROOT, "assets/js/red-bag-thanks.js"), "utf8");
    for (const w of lists.words) expect(new RegExp(`["'|(]${w}["'|)]`).test(source), w).toBe(false);
  });

  it("answers blocked for anything when it has no list: closed, not open", () => {
    expect(nameBlocked("Maple Class", null)).toBe(true);
    expect(nameBlocked("Maple Class", {})).toBe(true);
    expect(nameBlocked("Maple Class", { words: "x" })).toBe(true);
  });
});

describe("the words on the picture", () => {
  it("is the plain one with no name, however many bags", () => {
    expect(pictureHeadline("", 1)).toBe("I filled a Red Bag");
    expect(pictureHeadline("", 3)).toBe("I filled a Red Bag");
  });

  it("names them, for one bag and for more", () => {
    expect(pictureHeadline("Maple Class", 1)).toBe("Maple Class filled a Red Bag");
    expect(pictureHeadline("Maple Class", 2)).toBe("Maple Class filled 2 Red Bags");
    expect(pictureHeadline("Maple Class", 20)).toBe("Maple Class filled 20 Red Bags");
  });
});

describe("the name field on the page", () => {
  it("has a label you can see, a hint, a limit, and belongs to no form", () => {
    start({ canvas: true });
    const input = $<HTMLInputElement>("#rbShareName");
    expect($("[data-rb-name]").hidden).toBe(false);
    expect(text('label[for="rbShareName"]')).toBe("Add a name to your picture (optional)");
    expect($('label[for="rbShareName"]').classList.contains("sr-only")).toBe(false);
    expect(input.type).toBe("text");
    expect(input.maxLength).toBe(30);
    expect(input.hasAttribute("name")).toBe(false);
    expect(input.closest("form")).toBeNull();
    expect(input.required).toBe(false);
    const hint = document.getElementById(input.getAttribute("aria-describedby")!.split(" ")[0])!;
    expect(hint.textContent!.replace(/\s+/g, " ").trim()).toBe("A first name, a family, a class or a workplace. It goes on your certificate too, and it never leaves this page.");
    // Above the picture.
    expect(input.compareDocumentPosition($("[data-rb-share-picture]")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws the plain picture with no name", () => {
    start({ kept: gift(10000), canvas: true });
    expect(drawn).toContain("I filled a Red Bag");
    expect(drawn).toContain("Fill one too at nbcc.scot/fill");
    expect(drawn).toContain("Night Before Christmas Campaign (NBCC). Scottish Charity SC047995.");
    expect($("[data-rb-share-picture]").getAttribute("aria-label")).toContain("I filled a Red Bag");
  });

  it("draws their name as they type: one bag", () => {
    start({ kept: gift(5410), canvas: true });
    drawn.length = 0;
    type("Fern");
    expect(drawn).toContain("Fern filled a Red Bag");
    expect(drawn).not.toContain("I filled a Red Bag");
    expect(drawn).toContain("Fill one too at nbcc.scot/fill");
    expect(drawn).toContain("Night Before Christmas Campaign (NBCC). Scottish Charity SC047995.");
    expect($("[data-rb-share-picture]").getAttribute("aria-label")).toBe("A red paper gift bag on cream, with the words: Fern filled a Red Bag. Night Before Christmas Campaign.");
  });

  it("says two bags when they filled two", () => {
    start({ kept: gift(10000), canvas: true });
    drawn.length = 0;
    type("Fern");
    expect(drawn).toContain("Fern filled 2 Red Bags");
  });

  it("says a Red Bag when nothing was remembered", () => {
    start({ canvas: true });
    drawn.length = 0;
    type("  Fern  ");
    expect(drawn).toContain("Fern filled a Red Bag");
  });

  it("puts a long name on a line of its own, small enough to fit the picture", () => {
    start({ kept: gift(10000), canvas: true });
    drawn.length = 0;
    const sizes: Array<[string, number]> = [];
    const ctx = ($("[data-rb-share-picture]") as HTMLCanvasElement).getContext("2d") as unknown as { fillText: unknown; font: string; measureText: (t: string) => { width: number } };
    const real = ctx.fillText as (t: string) => void;
    (ctx as unknown as Record<string, unknown>).fillText = (t: string) => {
      sizes.push([t, ctx.measureText(t).width]);
      real(t);
    };
    type("The Willowbank Street Knitting Circle");
    expect(drawn).toContain("The Willowbank Street Knitting");
    expect(drawn).toContain("filled 2 Red Bags");
    for (const [t, w] of sizes) expect(w, t).toBeLessThanOrEqual(1080 - 2 * 80);
  });

  it("goes back to the plain picture when the name is taken out", () => {
    start({ canvas: true });
    type("Fern");
    drawn.length = 0;
    type("   ");
    expect(drawn).toContain("I filled a Red Bag");
  });

  it("refuses an abusive name in plain words, and keeps the picture plain", () => {
    start({ kept: gift(5410), canvas: true });
    type("Fern");
    drawn.length = 0;
    const input = type("shit");
    expect(text("[data-rb-name-error]")).toBe("Please choose a different name.");
    expect($("[data-rb-name-error]").hidden).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(drawn).toContain("I filled a Red Bag");
    expect(drawn.join(" ")).not.toMatch(/shit/i);
    expect($("[data-rb-share-picture]").getAttribute("aria-label")).not.toMatch(/shit/i);
    // And lets go of it once the name is changed.
    drawn.length = 0;
    type("Fern");
    expect($("[data-rb-name-error]").hidden).toBe(true);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(drawn).toContain("Fern filled a Red Bag");
  });

  it("takes out of the box what it does not keep, and leaves the spaces being typed", () => {
    start({ canvas: true });
    expect(type("Fern <3 ").value).toBe("Fern 3 ");
    expect(type("Maple Class ").value).toBe("Maple Class ");
  });

  it("never puts an amount on the picture", () => {
    start({ kept: gift(12345, { giftAid: true }), canvas: true });
    type("Fern");
    expect(drawn.join(" ")).not.toMatch(/£|123|\b45\b|30\.86/);
  });

  it("saves the picture as it is now shown", () => {
    start({ canvas: true });
    const save = $<HTMLAnchorElement>("[data-rb-share-save]");
    expect(save.hidden).toBe(false);
    expect(save.getAttribute("href")).toBe("data:image/png;base64,AAAA");
    (HTMLCanvasElement.prototype.toDataURL as unknown as ReturnType<typeof vi.fn>).mockReturnValue("data:image/png;base64,BBBB");
    type("Fern");
    expect(save.getAttribute("href")).toBe("data:image/png;base64,BBBB");
    expect(save.getAttribute("download")).toBe("i-filled-a-red-bag.png");
  });

  it("is put away, with the certificate, when the filter's list is not in the page: closed, not open", () => {
    start({ body: page.replace(/<script type="application\/json" data-rb-name-filter>[\s\S]*?<\/script>/, '<script type="application/json" data-rb-name-filter>not json</script>'), kept: gift(5410), canvas: true });
    expect($("[data-rb-name]").hidden).toBe(true);
    expect($("[data-rb-cert-ask]").hidden).toBe(true);
    // The rest of the page is as it was.
    expect(text("[data-rb-thanks-total]")).toBe("Your donation of £54.10 is on its way to NBCC.");
    expect(drawn).toContain("I filled a Red Bag");
    expect($("[data-rb-workshop-scene] svg.rbw")).not.toBeNull();
  });
});

describe("the certificate to print", () => {
  it("is not shown on the screen or read out, and its button is a quiet one", () => {
    start({ canvas: true });
    const cert = $("[data-rb-cert]");
    expect(cert.getAttribute("aria-hidden")).toBe("true");
    const button = $<HTMLButtonElement>("[data-rb-cert-print]");
    expect(button.textContent!.trim()).toBe("Print your certificate");
    expect(button.type).toBe("button");
    expect(button.classList.contains("btn-ghost")).toBe(true);
    expect($("[data-rb-cert-ask]").hidden).toBe(false);
    // After the share, before Fill another bag.
    expect($("[data-rb-share]").compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition($("[data-rb-again]")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("asks for a name first, with the name box in hand, and prints nothing", () => {
    start({ canvas: true });
    $<HTMLButtonElement>("[data-rb-cert-print]").click();
    expect(print).not.toHaveBeenCalled();
    expect(text("[data-rb-cert-status]")).toBe("Add a name above first, and it goes on your certificate.");
    expect(document.activeElement).toBe($("#rbShareName"));
    expect(document.documentElement.classList.contains("rb-print-cert")).toBe(false);
    // The prompt goes once there is a name.
    type("Fern");
    expect(text("[data-rb-cert-status]")).toBe("");
  });

  it("prints the certificate for one bag: the name, what for, the date, the elves, the charity's statement", () => {
    start({ kept: gift(5410, { giftAid: true }), canvas: true });
    type("  Maple   Class ");
    $<HTMLButtonElement>("[data-rb-cert-print]").click();
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains("rb-print-cert")).toBe(true);
    expect(text("[data-rb-cert] .rb-cert__title")).toBe("Certificate of thanks");
    expect(text("[data-rb-cert] .rb-cert__to")).toBe("This certificate is presented to");
    expect(text("[data-rb-cert-name]")).toBe("Maple Class");
    expect(text("[data-rb-cert-for]")).toBe("for filling a Red Bag Full of Joy");
    expect(text("[data-rb-cert-date]")).toBe(longDate(new Date()));
    expect(text("[data-rb-cert-date]")).toMatch(/^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/);
    expect(text("[data-rb-cert] .rb-cert__hand")).toBe("Thank you for being part of this.");
    expect(text("[data-rb-cert] .rb-cert__elves")).toBe("The Elves");
    expect(text("[data-rb-cert] .rb-cert__legal")).toBe(MATERIALS_STATEMENT);
    const logo = $<HTMLImageElement>("[data-rb-cert] img");
    expect(logo.getAttribute("src")).toBe("/assets/img/nbcc-logo.png");
    expect(logo.getAttribute("alt")).toBe("Night Before Christmas Campaign");
    // A tied bag is drawn on it.
    expect($("[data-rb-cert-bag] svg .rbw-ribbon")).not.toBeNull();
    // No amount anywhere on it.
    expect(text("[data-rb-cert]")).not.toMatch(/£|54|13\.5/);
    // Once printed (or the print window closed), the page prints as a page again.
    for (const fn of listeners.afterprint ?? []) fn();
    expect(document.documentElement.classList.contains("rb-print-cert")).toBe(false);
  });

  it("says how many bags when they filled two or more", () => {
    expect(certificateFor(1)).toBe("for filling a Red Bag Full of Joy");
    expect(certificateFor(2)).toBe("for filling 2 Red Bags Full of Joy");
    start({ kept: gift(15000), canvas: true });
    type("Fern");
    $<HTMLButtonElement>("[data-rb-cert-print]").click();
    expect(text("[data-rb-cert-for]")).toBe("for filling 3 Red Bags Full of Joy");
    expect(text("[data-rb-cert]")).not.toMatch(/£|150/);
  });

  it("writes the date the long way", () => {
    expect(longDate(new Date(2026, 9, 5))).toBe("5 October 2026");
    expect(longDate(new Date(2026, 11, 24))).toBe("24 December 2026");
  });

  it("does not print an abusive name", () => {
    start({ canvas: true });
    type("shit");
    $<HTMLButtonElement>("[data-rb-cert-print]").click();
    expect(print).not.toHaveBeenCalled();
    expect(text("[data-rb-name-error]")).toBe("Please choose a different name.");
    expect(document.activeElement).toBe($("#rbShareName"));
    expect(text("[data-rb-cert-name]")).toBe("");
  });

  it("puts the name in as words, never as markup", () => {
    start({ canvas: true });
    const input = $<HTMLInputElement>("#rbShareName");
    input.value = "<img src=x>";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    $<HTMLButtonElement>("[data-rb-cert-print]").click();
    expect($("[data-rb-cert-name]").children.length).toBe(0);
    expect(text("[data-rb-cert-name]")).toBe("img srcx");
  });

  it("works where the picture cannot be drawn", () => {
    start();
    expect($("[data-rb-share-picture]").hidden).toBe(true);
    type("Fern");
    $<HTMLButtonElement>("[data-rb-cert-print]").click();
    expect(print).toHaveBeenCalledTimes(1);
    expect(text("[data-rb-cert-name]")).toBe("Fern");
  });
});

describe("nothing typed goes anywhere", () => {
  it("makes no request of any kind while a name is typed, the picture drawn and the certificate printed", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const open = vi.spyOn(XMLHttpRequest.prototype, "open");
    const send = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);
    const set = vi.spyOn(Storage.prototype, "setItem");
    start({ kept: gift(10000), canvas: true });
    type("Fern");
    type("Maple Class");
    $<HTMLButtonElement>("[data-rb-cert-print]").click();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(winFetch).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");
    // The links to share are as they were: the name is in none of them.
    for (const a of document.querySelectorAll("[data-rb-share] a[target='_blank']")) expect(decodeURIComponent(a.getAttribute("href")!)).not.toMatch(/Maple|Fern/);
    vi.unstubAllGlobals();
  });

  it("has no way to send anything in either script", () => {
    for (const f of ["assets/js/red-bag-thanks.js", "assets/js/red-bag-workshop.js"]) {
      const source = readFileSync(resolve(ROOT, f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(source, f).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\.src\s*=|localStorage|document\.cookie|setItem/);
    }
  });
});

describe("the new pieces can never stop the thank you", () => {
  it("still shows the total, the picture and the share controls when the name box's code throws", () => {
    const body = page.replace('id="rbShareName"', 'id="rbShareName" data-broken');
    const real = Element.prototype.addEventListener;
    vi.spyOn(Element.prototype, "addEventListener").mockImplementation(function (this: Element, ...args: unknown[]) {
      if (this.hasAttribute && this.hasAttribute("data-broken")) throw new Error("name box broke");
      return (real as (...a: unknown[]) => void).apply(this, args);
    });
    start({ body, kept: gift(4000, { giftAid: true }), canvas: true });
    expect(text("[data-rb-thanks-total]")).toBe("Your donation of £40 is on its way to NBCC.");
    expect($("[data-rb-thanks-giftaid]").hidden).toBe(false);
    expect(drawn).toContain("I filled a Red Bag");
    expect($("[data-rb-share-save]").hidden).toBe(false);
    expect($("[data-rb-workshop-scene] svg.rbw")).not.toBeNull();
    expect(document.activeElement).toBe($("h1"));
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
