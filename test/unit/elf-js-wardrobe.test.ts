// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderWardrobePage } from "../../src/elf/pages/wardrobe";
import type { WardrobeView } from "../../src/elf/pages/types";
import { wardrobeView } from "./elf-fixtures";

// NBCC Elf Detective School: the script on the wardrobe page. It changes the elf on the stage as
// things are tried on, saves the look without leaving the page, and turns the sections into tabs. It
// runs here against the real page and the real wardrobe file, with a pretend server. Every family and
// detective is invented (see elf-fixtures.ts): Ruby has done doors 1 to 6, wears the reindeer costume
// and gold glasses with a robin at Largs in a candy cane frame, and door 6's snow globe and puffin
// have just arrived.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initWardrobe } = require(resolve(ROOT, "assets/js/elf-wardrobe-ui.js"));
const elf = require(resolve(ROOT, "assets/js/elf-wardrobe.js"));

interface Wardrobe {
  look(): Record<string, unknown>;
  save(): void;
  show(id: string): void;
  stop(): void;
}

let wd: Wardrobe | null = null;
let calls: { url: string; body: Record<string, unknown>; keepalive: unknown }[] = [];
let answer: { status: number; body: unknown } | "offline" = { status: 200, body: { ok: true } };

const PAPER = "/assets/img/elf/paper/";
const NOT_SAVED = "We could not save this look. Check your signal and try again.";
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const pick = (name: string, value: string) => $<HTMLInputElement>(`input[type="radio"][name="${name}"][value="${value}"]`);
const tab = (name: string) => $$<HTMLAnchorElement>(".elf-wd-tab").find((a) => words(a).startsWith(name))!;
const shown = () => $$(".elf-wd-panel").filter((p) => !p.hidden).map((p) => p.id);
/** The pictures on the stage, in order, as part and file. */
const onStage = () => $$<HTMLImageElement>(".elf-wd-stage img").map((i) => [i.getAttribute("data-picture"), (i.getAttribute("src") ?? "").replace(PAPER, "")]);
const picture = (part: string) => ($(`.elf-wd-stage img[data-picture="${part}"]`) as HTMLImageElement | null)?.getAttribute("src")?.replace(PAPER, "") ?? null;
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** The real page with the script started on it. `before` changes the page before the script starts. */
function load(view: WardrobeView = wardrobeView(), opts: Record<string, unknown> = {}, before?: () => void): Wardrobe | null {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderWardrobePage(view), "text/html").documentElement.innerHTML;
  before?.();
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {}, keepalive: init?.keepalive });
    if (answer === "offline") return Promise.reject(new Error("offline"));
    const a = answer;
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  wd = initWardrobe(document, window, { elf, ...opts }) as Wardrobe | null;
  return wd;
}

afterEach(() => {
  wd?.stop();
  wd = null;
  answer = { status: 200, body: { ok: true } };
  vi.useRealTimers();
  window.location.hash = "";
});

describe("trying things on", () => {
  it("changes the elf on the stage the moment a costume is picked, glasses fitted to it", () => {
    load();
    expect(picture("body")).toBe("costumes/reindeer-s3.webp");
    pick("costume", "tree").click();
    expect(picture("body")).toBe("costumes/tree-s3.webp");
    expect(picture("glasses")).toBe("pieces/specs-gold--tree.webp");
    expect($(".elf-wd-stage").getAttribute("aria-label")).toBe("Detective Ruby Tinselfoot's elf");
  });

  it("keeps the words about the look in step with the picture", () => {
    load();
    pick("scene", "loch").click();
    expect(picture("scene")).toBe("scenes/loch.webp");
    expect(words($(".elf-wd-wearing"))).toBe("Reindeer costume and gold glasses, with a robin. Highland loch, in a candy cane frame.");
  });

  it("changes the skin and the hair too, once the costume is off", () => {
    load();
    pick("costume", "").click();
    pick("skin", "s5").click();
    pick("hair", "black").click();
    pick("hairStyle", "curly").click();
    expect(picture("body")).toBe("elves/elf-sister-s5-curly-black.webp");
    expect(wd!.look()).toEqual({ ...wardrobeView().look, costume: null, skin: "s5", hair: "black", hairStyle: "curly" });
  });

  it("changes a girl to a boy", () => {
    load();
    pick("costume", "").click();
    pick("sibling", "brother").click();
    expect(picture("body")).toBe("elves/elf-brother-s3-bunches-ginger.webp");
  });

  it("adds and takes away the pictures a look needs, keeping them in stage order", () => {
    load();
    pick("friend", "").click();
    pick("glasses", "").click();
    pick("costume", "").click();
    pick("bow", "bow-red").click();
    expect(onStage()).toEqual([["scene", "scenes/largs.webp"], ["body", "elves/elf-sister-s3-bunches-ginger.webp"], ["bow", "pieces/bow-red.webp"]]);
    pick("glasses", "stars-blue").click();
    pick("friend", "snowman").click();
    expect(onStage().map((p) => p[0])).toEqual(["scene", "body", "glasses", "bow", "friend"]);
  });

  it("draws no bow tie under a costume", () => {
    load();
    pick("bow", "bow-red").click();
    expect(picture("bow")).toBeNull();
    pick("costume", "").click();
    expect(picture("bow")).toBe("pieces/bow-red.webp");
  });

  it("puts the frame chosen round the stage, and none when none is chosen", () => {
    load();
    pick("frame", "gold").click();
    expect($(".elf-wd-frame").classList.contains("elf-frame--gold")).toBe(true);
    expect($(".elf-wd-frame").classList.contains("elf-frame--candy")).toBe(false);
    pick("frame", "").click();
    expect([...$(".elf-wd-frame").classList].filter((c) => c.startsWith("elf-frame--"))).toEqual([]);
    expect($(".elf-wd-frame").classList.contains("elf-frame")).toBe(true);
  });

  it("shows the costume tiles in the skin chosen", () => {
    load();
    pick("skin", "s5").click();
    const tiles = $$<HTMLImageElement>("img[data-costume]");
    expect(tiles.length).toBe(51);
    for (const t of tiles) expect(t.getAttribute("src")).toBe(`${PAPER}tiles/costumes/${t.getAttribute("data-costume")}-s5.webp`);
  });
});

describe("what is locked", () => {
  it("stays locked: the script never makes a locked thing pickable", () => {
    load();
    const before = $$<HTMLInputElement>('form.elf-wd input[type="radio"]:disabled').map((i) => i.value);
    expect(before.length).toBe(36);
    pick("costume", "tree").click();
    wd!.show("wd-scenes");
    expect($$<HTMLInputElement>('form.elf-wd input[type="radio"]:disabled').map((i) => i.value)).toEqual(before);
  });

  it("says why when a locked costume is tapped, and changes nothing", () => {
    load();
    const before = onStage();
    const santa = pick("costume", "santa");
    document.querySelector<HTMLElement>(`label[for="${santa.id}"]`)!.click();
    expect(santa.checked).toBe(false);
    expect(onStage()).toEqual(before);
    expect(words($(".elf-wd-status"))).toBe("Santa suit, opens with door 24.");
    expect(santa.closest(".elf-wd-tile")!.classList.contains("is-rattled")).toBe(true);
    expect(calls).toEqual([]);
  });

  it("is never drawn, even if the page is meddled with", () => {
    load();
    const santa = pick("costume", "santa");
    santa.disabled = false;
    santa.click();
    expect(picture("body")).toBe("elves/elf-sister-s3-bunches-ginger.webp");
    expect(words($(".elf-wd-wearing"))).toMatch(/^No costume/);
  });

  it("reads the doors done from the page, so a costume opens once its door is done", () => {
    load(wardrobeView({ state: { doors: [24] } }));
    pick("costume", "santa").click();
    expect(picture("body")).toBe("costumes/santa-s3.webp");
  });

  it("counts nothing but whole door numbers in what the page says is done", () => {
    load(wardrobeView({ state: { doors: [24] } }), {}, () => $("form.elf-wd").setAttribute("data-doors", "x, 99,24.5,"));
    pick("costume", "santa").click();
    expect(picture("body")).toBe("elves/elf-sister-s3-bunches-ginger.webp");
  });
});

describe("saving", () => {
  it("saves the look by itself once the changes settle, in one go", async () => {
    vi.useFakeTimers();
    load();
    pick("scene", "loch").click();
    pick("skin", "s5").click();
    vi.advanceTimersByTime(300);
    pick("hair", "black").click();
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(900);
    await flush();
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/elf/look");
    expect(calls[0].body).toEqual({ detectiveId: "d1", look: { ...wardrobeView().look, scene: "loch", skin: "s5", hair: "black" }, tried: [] });
    expect(words($(".elf-wd-status"))).toBe("Saved");
    expect($(".elf-wd-status").classList.contains("is-error")).toBe(false);
  });

  it("hides the Save button, because the look saves itself", () => {
    load();
    expect($<HTMLButtonElement>('form.elf-wd button[type="submit"]').hidden).toBe(true);
  });

  it("says plainly when the look could not be saved, and offers the Save button", async () => {
    answer = { status: 500, body: { ok: false } };
    load();
    pick("scene", "loch").click();
    wd!.save();
    await flush();
    expect(words($(".elf-wd-status"))).toBe(NOT_SAVED);
    expect($(".elf-wd-status").classList.contains("is-error")).toBe(true);
    const button = $<HTMLButtonElement>('form.elf-wd button[type="submit"]');
    expect(button.hidden).toBe(false);

    answer = { status: 200, body: { ok: true } };
    const event = new Event("submit", { bubbles: true, cancelable: true });
    $("form.elf-wd").dispatchEvent(event);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(calls.length).toBe(2);
    expect(words($(".elf-wd-status"))).toBe("Saved");
    expect(button.hidden).toBe(true);
  });

  it("says the same when there is no signal at all, or the server answers no", async () => {
    answer = "offline";
    load();
    pick("scene", "loch").click();
    wd!.save();
    await flush();
    expect(words($(".elf-wd-status"))).toBe(NOT_SAVED);
    answer = { status: 200, body: { ok: false, reason: "unknown-detective" } };
    wd!.save();
    await flush();
    expect($(".elf-wd-status").classList.contains("is-error")).toBe(true);
  });

  it("sends a change made while a save is on its way, straight after", async () => {
    load();
    pick("scene", "loch").click();
    wd!.save();
    pick("scene", "forest").click();
    wd!.save();
    expect(calls.length).toBe(1);
    await flush();
    await flush();
    expect(calls.length).toBe(2);
    expect((calls[1].body.look as { scene: string }).scene).toBe("forest");
  });

  it("saves a change that is still waiting when the page is left", () => {
    vi.useFakeTimers();
    load();
    pick("scene", "loch").click();
    expect(calls).toEqual([]);
    window.dispatchEvent(new Event("pagehide"));
    expect(calls.length).toBe(1);
    expect(calls[0].keepalive).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(calls.length).toBe(1);
  });

  it("sends the latest change straight away when the page is left while an earlier save is on its way", () => {
    load();
    pick("scene", "loch").click();
    wd!.save();
    pick("scene", "forest").click();
    wd!.save();
    expect(calls.length).toBe(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(calls.length).toBe(2);
    expect((calls[1].body.look as { scene: string }).scene).toBe("forest");
    expect(calls[1].keepalive).toBe(true);
  });

  it("saves when the page is hidden too, which is all a phone says when an app is swiped away", () => {
    vi.useFakeTimers();
    load();
    pick("scene", "loch").click();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(calls.length).toBe(1);
  });

  it("treats an answer that is not JSON as not saved", async () => {
    load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("not json")) }));
    pick("scene", "loch").click();
    wd!.save();
    await flush();
    expect($(".elf-wd-status").classList.contains("is-error")).toBe(true);
  });

  it("keeps the warning about a failed save when a locked costume is tapped", async () => {
    answer = { status: 500, body: {} };
    load();
    pick("scene", "loch").click();
    wd!.save();
    await flush();
    document.querySelector<HTMLElement>(`label[for="${pick("costume", "santa").id}"]`)!.click();
    expect(words($(".elf-wd-status"))).toBe(NOT_SAVED);
  });

  it("draws and saves choices the browser put back that the stage does not show", () => {
    vi.useFakeTimers();
    document.documentElement.innerHTML = new DOMParser().parseFromString(renderWardrobePage(wardrobeView()), "text/html").documentElement.innerHTML;
    pick("scene", "loch").checked = true;
    calls = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)), keepalive: init?.keepalive });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    });
    wd = initWardrobe(document, window, { elf }) as Wardrobe;
    expect(words($(".elf-wd-wearing"))).toContain("Highland loch");
    expect(picture("scene")).toBe("scenes/loch.webp");
    vi.advanceTimersByTime(1000);
    expect(calls.length).toBe(1);
  });

  it("sends nothing when the page is left with nothing changed", () => {
    load();
    window.dispatchEvent(new Event("pagehide"));
    expect(calls).toEqual([]);
  });
});

describe("what is new", () => {
  it("opens a present when it is picked: the wrapping comes off, the costume goes on, and the server is told", async () => {
    load();
    const globe = pick("costume", "snowglobe");
    const tile = globe.closest(".elf-wd-tile")!;
    expect(tile.classList.contains("is-wrapped")).toBe(true);
    globe.click();
    expect(tile.classList.contains("is-new")).toBe(false);
    expect(tile.classList.contains("is-wrapped")).toBe(false);
    expect(words(tile.querySelector(".sr-only"))).toBe("Snow globe");
    expect(picture("body")).toBe("costumes/snowglobe-s3.webp");
    wd!.save();
    await flush();
    expect(calls[0].body.tried).toEqual(["snowglobe"]);
  });

  it("tells the server once: a thing already told is not sent again", async () => {
    load();
    pick("costume", "snowglobe").click();
    wd!.save();
    await flush();
    pick("costume", "puffin").click();
    wd!.save();
    await flush();
    expect(calls[1].body.tried).toEqual(["puffin"]);
  });

  it("keeps what was tried for the next save when a save fails", async () => {
    answer = { status: 500, body: {} };
    load();
    pick("costume", "snowglobe").click();
    wd!.save();
    await flush();
    answer = { status: 200, body: { ok: true } };
    wd!.save();
    await flush();
    expect(calls[1].body.tried).toEqual(["snowglobe"]);
  });

  it("takes the mark off a section once nothing in it is new", () => {
    load();
    expect(tab("Costumes").querySelector(".elf-wd-tab__new")).not.toBeNull();
    pick("costume", "snowglobe").click();
    expect(tab("Costumes").querySelector(".elf-wd-tab__new")).not.toBeNull();
    pick("costume", "puffin").click();
    expect(tab("Costumes").querySelector(".elf-wd-tab__new")).toBeNull();
    expect(words(tab("Costumes"))).toBe("Costumes");
  });
});

describe("the sections as tabs", () => {
  it("shows one section at a time, starting with the first that holds something new", () => {
    load();
    expect($(".elf-wd-tabs").getAttribute("role")).toBe("tablist");
    expect(shown()).toEqual(["wd-costumes"]);
    expect(tab("Costumes").getAttribute("aria-selected")).toBe("true");
    expect($$(".elf-wd-tab").filter((t) => t.getAttribute("aria-selected") === "true").length).toBe(1);
    expect($("form.elf-wd").classList.contains("is-live")).toBe(true);
  });

  it("starts at the first section when nothing is new", () => {
    load(wardrobeView({ fresh: [] }));
    expect(shown()).toEqual(["wd-costumes"]);
  });

  it("opens a section when its tab is pressed, without jumping down the page", () => {
    load();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    tab("Scenes").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(shown()).toEqual(["wd-scenes"]);
    expect(tab("Scenes").getAttribute("aria-selected")).toBe("true");
    expect(tab("Costumes").getAttribute("aria-selected")).toBe("false");
  });

  it("is a real set of tabs to a screen reader and a keyboard", () => {
    load();
    const tabs = $$(".elf-wd-tab");
    for (const t of tabs) {
      expect(t.getAttribute("role")).toBe("tab");
      const panel = document.getElementById(t.getAttribute("aria-controls")!)!;
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(t.id);
      expect(t.parentElement!.getAttribute("role")).toBe("presentation");
    }
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0").length).toBe(1);
    expect(tab("Costumes").getAttribute("tabindex")).toBe("0");

    tab("Costumes").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-scenes"]);
    expect(document.activeElement).toBe(tab("Scenes"));
    tab("Scenes").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-costumes"]);
    tab("Costumes").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-glasses"]);
    tab("Glasses and bow ties").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-costumes"]);
    tab("Costumes").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(shown()).toEqual(["wd-glasses"]);
  });

  it("opens the section named in the address, if there is one", () => {
    window.location.hash = "#wd-frames";
    load();
    expect(shown()).toEqual(["wd-frames"]);
    window.location.hash = "#somewhere-else";
    load();
    expect(shown()).toEqual(["wd-costumes"]);
  });
});

describe("without the wardrobe file", () => {
  it("leaves the page as it was: every section showing and the Save button there", () => {
    const got = load(wardrobeView(), { elf: null });
    expect(got).toBeNull();
    expect(shown().length).toBe(5);
    expect($(".elf-wd-fold").classList.contains("is-folded")).toBe(false);
    expect($<HTMLButtonElement>('form.elf-wd button[type="submit"]').hidden).toBe(false);
    expect($(".elf-wd-tabs").getAttribute("role")).toBeNull();
  });
});

// The paper wardrobe's moves (mockup 6, docs/superpowers/specs/2026-11-04-elf-paper-design.md).
describe("the paper wardrobe", () => {
  /** The window, to put in what jsdom does not have: a media query and a sound maker. */
  const host = window as unknown as Record<string, unknown>;

  /** Ask for less motion, as a visitor's settings would, for the length of `run`. */
  function lessMotion<T>(run: () => T): T {
    const before = host.matchMedia;
    host.matchMedia = (q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      return run();
    } finally {
      host.matchMedia = before;
    }
  }

  it("folds step 1 away once the elf is made, and opens it on Change", () => {
    load();
    const fold = $(".elf-wd-fold");
    const change = $<HTMLButtonElement>("button.elf-wd-change");
    expect(change.hidden).toBe(false);
    expect(fold.classList.contains("is-folded")).toBe(true);
    expect(change.getAttribute("aria-expanded")).toBe("false");
    change.click();
    expect(fold.classList.contains("is-folded")).toBe(false);
    expect(change.getAttribute("aria-expanded")).toBe("true");
    $<HTMLButtonElement>("button.elf-wd-done").click();
    expect(fold.classList.contains("is-folded")).toBe(true);
    expect(change.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens step 1 for an elf that has never been made", () => {
    load(wardrobeView({ made: false }));
    expect($(".elf-wd-fold").classList.contains("is-folded")).toBe(false);
    expect($("button.elf-wd-change").getAttribute("aria-expanded")).toBe("true");
  });

  it("says why a locked costume is locked on its note, and does not wear it", () => {
    load();
    const cracker = pick("costume", "cracker");
    document.querySelector<HTMLElement>(`label[for="${cracker.id}"]`)!.click();
    const tile = cracker.closest(".elf-wd-tile")!;
    expect(tile.classList.contains("is-telling")).toBe(true);
    expect(words(tile.querySelector(".elf-wd-why"))).toBe("Crack today's door to open it");
    expect(words($(".elf-wd-status"))).toBe("Christmas cracker, crack today's door to open it.");
    expect(cracker.checked).toBe(false);
    expect(picture("body")).toBe("costumes/reindeer-s3.webp");
  });

  it("keeps at most three favourite looks, newest first, and wears one again when tapped", async () => {
    load();
    for (const id of ["snowman", "workshop", "tree", "advent"]) {
      pick("costume", id).click();
      $<HTMLButtonElement>(".elf-wd-snap").click();
    }
    const photos = $$<HTMLButtonElement>(".elf-wd-looks .elf-wd-polaroid");
    expect(photos.map((p) => p.getAttribute("aria-label"))).toEqual([
      "Wear this look again: Advent calendar",
      "Wear this look again: Christmas tree",
      "Wear this look again: Workshop elf",
    ]);
    wd!.save();
    await flush();
    const sent = calls[calls.length - 1].body.favourites as { costume: string }[];
    expect(sent.map((f) => f.costume)).toEqual(["advent", "tree", "workshop"]);
    photos[2].click();
    expect(pick("costume", "workshop").checked).toBe(true);
    expect(picture("body")).toBe("costumes/workshop-s3.webp");
  });

  it("plays no sound until the sounds switch is on", () => {
    const made: unknown[] = [];
    host.AudioContext = class {
      currentTime = 0;
      sampleRate = 8000;
      destination = {};
      constructor() {
        made.push(this);
      }
      createOscillator() {
        return { type: "", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} };
      }
      createGain() {
        return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
      createBuffer() {
        return { getChannelData: () => new Float32Array(8) };
      }
      createBufferSource() {
        return { buffer: null, connect() {}, start() {} };
      }
    };
    try {
      load();
      pick("costume", "snowman").click();
      pick("scene", "village").click();
      expect(made.length).toBe(0);
      const sound = $<HTMLButtonElement>(".elf-wd-sound");
      expect(sound.hidden).toBe(false);
      sound.click();
      expect(made.length).toBe(1);
      expect(sound.getAttribute("aria-pressed")).toBe("true");
      expect(words(sound)).toBe("Sounds on");
    } finally {
      delete host.AudioContext;
    }
  });

  it("lands Surprise me on a costume that is unlocked, and saves it", async () => {
    lessMotion(() => load());
    const before = pick("costume", "reindeer").checked;
    lessMotion(() => $<HTMLButtonElement>(".elf-wd-surprise").click());
    const worn = $<HTMLInputElement>('input[name="costume"]:checked');
    expect(before).toBe(true);
    expect(worn.disabled).toBe(false);
    expect(worn.value).not.toBe("");
    wd!.save();
    await flush();
    expect((calls[calls.length - 1].body.look as { costume: string }).costume).toBe(worn.value);
  });

  it("talks back when a costume goes on, and says hello to a friend", () => {
    load();
    pick("costume", "snowman").click();
    expect(["So cosy", "I love it", "Ho ho ho", "Look at me", "Snug as a bug", "Ta da", "Just my size", "Jingle jingle"]).toContain(words($(".elf-wd-say")));
    pick("friend", "penguinchick").click();
    expect(words($(".elf-wd-say"))).toBe("Hello penguin chick");
  });

  it("makes no bursts or snow for a visitor who asked for less motion", () => {
    lessMotion(() => load());
    lessMotion(() => {
      pick("costume", "snowman").click();
      $(".elf-wd-stage").click();
    });
    expect(document.querySelectorAll(".elf-wd-spark, .elf-wd-snow .is-flurry").length).toBe(0);
  });

  it("makes it snow on the stage, and bursts a picked tile, for everyone else", () => {
    load();
    pick("costume", "snowman").click();
    $(".elf-wd-stage").click();
    expect(document.querySelectorAll(".elf-wd-spark").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".elf-wd-snow .is-flurry").length).toBeGreaterThan(0);
  });

  it("shows the tools it brings to life", () => {
    load();
    expect($(".elf-wd-tools").hidden).toBe(false);
  });
});
