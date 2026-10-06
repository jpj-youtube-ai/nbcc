// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderGetInvolvedPage } from "../../src/fundraising/render";
import { SEED_EVENTS } from "./helpers/events-seed";

// The one minute film on Get involved.
//
// What NBCC decided, and what must not quietly break:
//   - a first visit: the film is full size above the cards and plays by itself with the sound OFF
//     (a browser refuses anything else), with captions showing and a "Play with sound" button on it;
//   - every later visit: a slim strip in the same place, "Watch our one minute film", so the events
//     are seen straight away. Pressing it opens the film there and plays it with sound;
//   - which of the two is decided BEFORE the page is drawn, by a few lines in the head, so nobody
//     watches the film appear and then fold away. Nothing later in the visit changes it;
//   - "seen" is one small note in the visitor's own browser. No cookie, and nothing sent to us;
//   - nobody who does not press play downloads any of the film.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const template = readFileSync(resolve(ROOT, "events.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/events.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const { initFilm, FILM_SEEN_KEY } = require(resolve(ROOT, "assets/js/events.js"));

const pageHtml = (fundraisingOn: boolean) =>
  renderGetInvolvedPage(template, { events: SEED_EVENTS, fundraisers: [], fundraisingOn, today: "2026-10-06" });

type Mode = "film-first" | "film-later" | "";

function memoryStorage(start: Record<string, string> = {}) {
  const data: Record<string, string> = { ...start };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = String(v);
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}
const brokenStorage = () => ({
  getItem: () => {
    throw new Error("storage is switched off");
  },
  setItem: () => {
    throw new Error("storage is switched off");
  },
  removeItem: () => {
    throw new Error("storage is switched off");
  },
});

interface Options {
  mode: Mode;
  storage?: ReturnType<typeof memoryStorage> | ReturnType<typeof brokenStorage>;
  reducedMotion?: boolean;
  saveData?: boolean;
  playRefused?: boolean;
  noObserver?: boolean;
}

function setUp(opts: Options) {
  const doc = new DOMParser().parseFromString(pageHtml(true), "text/html");
  if (opts.mode) doc.documentElement.classList.add(opts.mode);
  const video = doc.querySelector("[data-film-video]") as HTMLVideoElement;
  const play = vi.fn(() => (opts.playRefused ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve()));
  const pause = vi.fn();
  const load = vi.fn();
  Object.assign(video, { play, pause, load });

  const observers: Array<{ cb: (entries: unknown[]) => void; disconnect: ReturnType<typeof vi.fn> }> = [];
  class FakeObserver {
    cb: (entries: unknown[]) => void;
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
    constructor(cb: (entries: unknown[]) => void) {
      this.cb = cb;
      observers.push(this);
    }
  }
  const storage = opts.storage ?? memoryStorage();
  const win = {
    localStorage: storage,
    matchMedia: (q: string) => ({ matches: !!opts.reducedMotion && /prefers-reduced-motion:\s*reduce/.test(q) }),
    navigator: { connection: { saveData: !!opts.saveData } },
    IntersectionObserver: opts.noObserver ? undefined : FakeObserver,
  };
  const film = initFilm(doc, win);
  const scrollTo = (ratio: number) =>
    observers.forEach((o) => o.cb([{ target: video, intersectionRatio: ratio, isIntersecting: ratio > 0 }]));
  return {
    doc,
    win,
    film,
    video,
    play,
    pause,
    load,
    storage,
    scrollTo,
    root: doc.querySelector("[data-film]") as HTMLElement,
    sound: doc.querySelector("[data-film-sound]") as HTMLButtonElement,
    strip: doc.querySelector("[data-film-open]") as HTMLButtonElement,
    close: doc.querySelector("[data-film-close]") as HTMLButtonElement,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the film in the page", () => {
  it("sits after the page heading and before the cards", () => {
    const doc = new DOMParser().parseFromString(pageHtml(true), "text/html");
    const film = doc.querySelector("[data-film]")!;
    const h1 = doc.querySelector("h1")!;
    const deck = doc.querySelector("[data-deck]")!;
    expect(film).not.toBeNull();
    expect(h1.compareDocumentPosition(film) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(film.compareDocumentPosition(deck) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Straight after the intro, and above the chips: nothing else comes between it and the heading.
    expect(film.previousElementSibling?.classList.contains("events-intro")).toBe(true);
    expect(film.nextElementSibling?.classList.contains("events-deck")).toBe(true);
    expect(film.closest("main")).not.toBeNull();
  });

  it("is one film and one only", () => {
    const doc = new DOMParser().parseFromString(pageHtml(true), "text/html");
    expect(doc.querySelectorAll("video")).toHaveLength(1);
    expect(doc.querySelectorAll("[data-film]")).toHaveLength(1);
    expect(doc.querySelectorAll(".gi-film__words")).toHaveLength(1);
  });

  // The film is about fundraising for NBCC. With fundraising switched off the page says nothing of
  // fundraising anywhere, so the film, its words and its few lines of script are not in it at all.
  it("is not on the page at all while fundraising is switched off", () => {
    const off = pageHtml(false);
    const doc = new DOMParser().parseFromString(off, "text/html");
    expect(doc.querySelector("[data-film]")).toBeNull();
    expect(doc.querySelector("video")).toBeNull();
    expect(off).not.toContain("<script>");
    expect(off).not.toContain("get-involved-film");
    expect(off).not.toContain("nbcc-film-seen");
  });

  it("is not in the template itself: the server adds it", () => {
    expect(template).not.toContain("<video");
    expect(template).not.toContain("<script>");
    expect(template.split("<!-- getinvolved:film -->")).toHaveLength(2);
    expect(template.split("<!-- getinvolved:film-head -->")).toHaveLength(2);
  });

  const doc = new DOMParser().parseFromString(pageHtml(true), "text/html");
  const video = doc.querySelector("[data-film-video]") as HTMLVideoElement;

  it("downloads nothing of the film until it is played", () => {
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.hasAttribute("autoplay")).toBe(false);
    // The still is a background of the frame (events.css), so a folded away film asks for no big picture.
    expect(video.hasAttribute("poster")).toBe(false);
    expect(css).toMatch(/\.gi-film__frame\s*\{[^}]*get-involved-film-poster\.jpg/);
  });

  it("plays in the page on an iPhone, and works with its own controls when there is no script", () => {
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.querySelector("source")?.getAttribute("src")).toBe("/assets/video/get-involved-film.mp4");
    expect(video.querySelector("source")?.getAttribute("type")).toBe("video/mp4");
  });

  it("has a name a screen reader can say, and a heading", () => {
    expect((video.getAttribute("aria-label") || "").length).toBeGreaterThan(10);
    const section = doc.querySelector("[data-film]")!;
    const heading = doc.getElementById(section.getAttribute("aria-labelledby") || "");
    expect(heading?.textContent).toBe("Our one minute film");
  });

  it("carries English captions that show by default", () => {
    const tracks = video.querySelectorAll("track");
    expect(tracks).toHaveLength(1);
    const track = tracks[0];
    expect(track.getAttribute("kind")).toBe("captions");
    expect(track.getAttribute("srclang")).toBe("en");
    expect(track.getAttribute("label")).toBe("English");
    expect(track.hasAttribute("default")).toBe(true);
    expect(track.getAttribute("src")).toBe("/assets/video/get-involved-film.en.vtt");
  });

  it("uses real buttons, in the site's wording", () => {
    const sound = doc.querySelector("[data-film-sound]")!;
    const strip = doc.querySelector("[data-film-open]")!;
    const close = doc.querySelector("[data-film-close]")!;
    for (const b of [sound, strip, close]) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
    }
    expect(strip.textContent?.replace(/\s+/g, " ").trim()).toBe("Watch our one minute film");
    expect(close.textContent?.replace(/\s+/g, " ").trim()).toBe("Close the film");
  });

  it("gives the strip a small picture of its own, loaded lazily, with its size set", () => {
    const img = doc.querySelector("[data-film-open] img")!;
    expect(img.getAttribute("src")).toBe("/assets/video/get-involved-film-thumb.jpg");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBeTruthy();
    expect(img.getAttribute("height")).toBeTruthy();
    expect(img.getAttribute("alt")).toBe("");
    expect(statSync(resolve(ROOT, "assets/video/get-involved-film-thumb.jpg")).size).toBeLessThan(10 * 1024);
  });

  it("keeps the room for the film so nothing jumps, and never scrolls inside itself", () => {
    expect(css).toMatch(/\.gi-film__frame\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
    const rules = css.match(/\.gi-film[^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThan(5);
    for (const rule of rules) expect(rule).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });

  it("has no em dashes in its words", () => {
    expect(doc.querySelector("[data-film]")!.textContent).not.toMatch(/[–—]/);
  });
});

describe("full size or strip: decided before the page is drawn", () => {
  const page = pageHtml(true);
  const head = page.slice(0, page.indexOf("</head>"));
  const inline = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  function decide(storage: unknown) {
    const classes = new Set<string>();
    const fakeDoc = { documentElement: { classList: { add: (c: string) => classes.add(c) } } };
    new Function("localStorage", "document", inline[0])(storage, fakeDoc);
    return [...classes];
  }

  it("is a few lines in the head that wait for nothing", () => {
    expect(inline).toHaveLength(1);
    expect(inline[0].length).toBeLessThan(400);
    // In the head and neither deferred nor a separate file: it has run before the body is drawn.
    expect(page.indexOf("<script>")).toBeLessThan(page.indexOf("<body"));
    expect(page.split("<script>")).toHaveLength(2);
  });

  it("a first visit is full size", () => {
    const storage = memoryStorage();
    expect(decide(storage)).toEqual(["film-first"]);
    // Deciding is not seeing: the note is only written once the film has been shown.
    expect(storage.getItem(FILM_SEEN_KEY)).toBeNull();
    expect(Object.keys(storage.data)).toEqual([]);
  });

  it("a later visit is the strip", () => {
    expect(decide(memoryStorage({ [FILM_SEEN_KEY]: "1" }))).toEqual(["film-later"]);
  });

  it("a browser with storage switched off is the strip", () => {
    expect(decide(brokenStorage())).toEqual(["film-later"]);
    expect(decide(undefined)).toEqual(["film-later"]);
  });

  it("a browser that can read but not write is the strip, or it would be a first visit for ever", () => {
    const storage = { ...memoryStorage(), setItem: () => { throw new Error("full"); } };
    expect(decide(storage)).toEqual(["film-later"]);
  });

  it("the stylesheet folds the film away from that class alone, so the strip is there on first paint", () => {
    expect(css).toMatch(/\.film-later \.gi-film:not\(\.is-open\) \.gi-film__player\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.gi-film__strip\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.film-later \.gi-film:not\(\.is-open\) \.gi-film__strip\s*\{[^}]*display:\s*flex/);
  });

  it("nothing in the page's script changes the decision during a visit", () => {
    const js = readFileSync(resolve(ROOT, "assets/js/events.js"), "utf8");
    expect(js).not.toMatch(/classList\.(add|remove|toggle)\(\s*["']film-(first|later)/);
    expect(js).not.toMatch(/documentElement\.className\s*=/);
  });
});

describe("a first visit", () => {
  it("does not start until the film is on screen", () => {
    const t = setUp({ mode: "film-first" });
    expect(t.play).not.toHaveBeenCalled();
    t.scrollTo(0.1);
    expect(t.play).not.toHaveBeenCalled();
  });

  it("plays with the sound off, without controls, with the sound button showing", () => {
    const t = setUp({ mode: "film-first" });
    t.scrollTo(0.8);
    expect(t.play).toHaveBeenCalledTimes(1);
    expect(t.video.muted).toBe(true);
    expect(t.video.controls).toBe(false);
    expect(t.sound.hidden).toBe(false);
    expect(t.sound.textContent?.trim()).toBe("Play with sound");
  });

  it("writes the note only once the film is really playing, and only once", () => {
    const t = setUp({ mode: "film-first" });
    const setItem = vi.spyOn(t.storage, "setItem");
    t.scrollTo(0.8);
    expect(setItem).not.toHaveBeenCalled();
    t.video.dispatchEvent(new Event("playing"));
    t.video.dispatchEvent(new Event("playing"));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(FILM_SEEN_KEY, "1");
  });

  it("stays full size after the note is written", () => {
    const t = setUp({ mode: "film-first" });
    t.scrollTo(0.8);
    t.video.dispatchEvent(new Event("playing"));
    expect(t.doc.documentElement.classList.contains("film-first")).toBe(true);
    expect(t.doc.documentElement.classList.contains("film-later")).toBe(false);
    expect(t.root.classList.contains("is-open")).toBe(false);
  });

  it("pauses when scrolled well away, and carries on when scrolled back", () => {
    const t = setUp({ mode: "film-first" });
    t.scrollTo(0.8);
    t.scrollTo(0.4); // still mostly there: leave it be
    expect(t.pause).not.toHaveBeenCalled();
    t.scrollTo(0.1);
    expect(t.pause).toHaveBeenCalledTimes(1);
    t.scrollTo(0.9);
    expect(t.play).toHaveBeenCalledTimes(2);
  });

  it("pauses while the tab is hidden", () => {
    const t = setUp({ mode: "film-first" });
    t.scrollTo(0.8);
    Object.defineProperty(t.doc, "visibilityState", { value: "hidden", configurable: true });
    t.doc.dispatchEvent(new Event("visibilitychange"));
    expect(t.pause).toHaveBeenCalledTimes(1);
    Object.defineProperty(t.doc, "visibilityState", { value: "visible", configurable: true });
    t.doc.dispatchEvent(new Event("visibilitychange"));
    expect(t.play).toHaveBeenCalledTimes(2);
  });

  it("does not start again by itself once it has played to the end", () => {
    const t = setUp({ mode: "film-first" });
    t.scrollTo(0.8);
    t.video.dispatchEvent(new Event("ended"));
    t.scrollTo(0.1);
    t.scrollTo(0.9);
    expect(t.play).toHaveBeenCalledTimes(1);
    expect(t.sound.hidden).toBe(false);
  });

  it("the sound button starts the film again from the beginning, with sound and controls", () => {
    const t = setUp({ mode: "film-first" });
    t.scrollTo(0.8);
    t.video.currentTime = 20;
    t.sound.click();
    expect(t.video.currentTime).toBe(0);
    expect(t.video.muted).toBe(false);
    expect(t.video.controls).toBe(true);
    expect(t.play).toHaveBeenCalledTimes(2);
    expect(t.sound.hidden).toBe(true);
  });

  it("is left alone once it is playing with sound: scrolling and tab changes no longer touch it", () => {
    const t = setUp({ mode: "film-first" });
    t.scrollTo(0.8);
    t.sound.click();
    t.scrollTo(0);
    Object.defineProperty(t.doc, "visibilityState", { value: "hidden", configurable: true });
    t.doc.dispatchEvent(new Event("visibilitychange"));
    expect(t.pause).not.toHaveBeenCalled();
  });

  for (const [why, opts] of [
    ["the visitor has asked for less motion", { reducedMotion: true }],
    ["the visitor has asked to save data", { saveData: true }],
    ["the browser cannot say when the film is on screen", { noObserver: true }],
  ] as Array<[string, Partial<Options>]>) {
    it(`does not play by itself when ${why}: a still and a play button, and it counts as seen`, () => {
      const t = setUp({ mode: "film-first", ...opts });
      t.scrollTo(0.9);
      expect(t.play).not.toHaveBeenCalled();
      expect(t.load).not.toHaveBeenCalled();
      expect(t.video.controls).toBe(false);
      expect(t.sound.hidden).toBe(false);
      expect(t.sound.textContent?.trim()).toBe("Play the film");
      expect(t.storage.getItem(FILM_SEEN_KEY)).toBe("1");
      t.sound.click();
      expect(t.play).toHaveBeenCalledTimes(1);
      expect(t.video.muted).toBe(false);
      expect(t.video.controls).toBe(true);
    });
  }

  it("falls back to the still and a play button if the browser refuses to play", async () => {
    const t = setUp({ mode: "film-first", playRefused: true });
    t.scrollTo(0.8);
    await flush();
    expect(t.sound.hidden).toBe(false);
    expect(t.sound.textContent?.trim()).toBe("Play the film");
    expect(t.storage.getItem(FILM_SEEN_KEY)).toBe("1");
    t.scrollTo(0.1);
    t.scrollTo(0.9);
    expect(t.play).toHaveBeenCalledTimes(1);
  });
});

describe("a later visit", () => {
  it("plays nothing and fetches nothing", () => {
    const t = setUp({ mode: "film-later", storage: memoryStorage({ [FILM_SEEN_KEY]: "1" }) });
    t.scrollTo(1);
    t.video.dispatchEvent(new Event("playing"));
    expect(t.play).not.toHaveBeenCalled();
    expect(t.load).not.toHaveBeenCalled();
    expect(t.video.getAttribute("preload")).toBe("none");
    expect(t.video.hasAttribute("poster")).toBe(false);
    expect(t.root.classList.contains("is-open")).toBe(false);
  });

  it("the strip opens the film in place and plays it from the start with sound and controls", () => {
    const t = setUp({ mode: "film-later", storage: memoryStorage({ [FILM_SEEN_KEY]: "1" }) });
    t.video.currentTime = 12;
    t.strip.click();
    expect(t.root.classList.contains("is-open")).toBe(true);
    expect(t.video.currentTime).toBe(0);
    expect(t.video.muted).toBe(false);
    expect(t.video.controls).toBe(true);
    expect(t.play).toHaveBeenCalledTimes(1);
    expect(t.sound.hidden).toBe(true);
    // Captions stay on offer: the track is still there for the player's own captions button.
    expect(t.video.querySelectorAll('track[kind="captions"]')).toHaveLength(1);
  });

  it("moves focus to the player when it opens, and back to the strip when it is closed", () => {
    const t = setUp({ mode: "film-later", storage: memoryStorage({ [FILM_SEEN_KEY]: "1" }) });
    globalThis.document.body.replaceChildren(t.doc.body); // focus only moves in the live document
    t.strip.focus();
    t.strip.click();
    expect([t.video, t.close]).toContain(globalThis.document.activeElement);
    t.close.click();
    expect(t.pause).toHaveBeenCalledTimes(1);
    expect(t.root.classList.contains("is-open")).toBe(false);
    expect(globalThis.document.activeElement).toBe(t.strip);
  });

  it("with storage switched off it is the strip too, and nothing throws", () => {
    const t = setUp({ mode: "film-later", storage: brokenStorage() });
    t.scrollTo(1);
    expect(t.play).not.toHaveBeenCalled();
    expect(() => t.strip.click()).not.toThrow();
    expect(t.play).toHaveBeenCalledTimes(1);
  });
});

describe("when the note cannot be written", () => {
  it("a first visit still plays, and nothing throws", () => {
    const t = setUp({ mode: "film-first", storage: brokenStorage() });
    t.scrollTo(0.8);
    expect(() => t.video.dispatchEvent(new Event("playing"))).not.toThrow();
    expect(t.play).toHaveBeenCalledTimes(1);
  });
});

describe("with no decision at all (the head script did not run)", () => {
  it("leaves the film as the plain player it is without script", () => {
    const t = setUp({ mode: "" });
    t.scrollTo(1);
    expect(t.play).not.toHaveBeenCalled();
    expect(t.video.controls).toBe(true);
    expect(t.sound.hidden).toBe(true);
  });
});

describe("the rest of the page", () => {
  it("has no film, and nothing breaks, on a page without one (the admin's card previews)", () => {
    const doc = new DOMParser().parseFromString("<main><ol data-deck></ol></main>", "text/html");
    expect(initFilm(doc, {})).toBeNull();
  });
});

describe("what the film says, for anyone who cannot play it", () => {
  const doc = new DOMParser().parseFromString(pageHtml(true), "text/html");
  const details = doc.querySelector("details.gi-film__words")!;
  const vtt = readFileSync(resolve(ROOT, "assets/video/get-involved-film.en.vtt"), "utf8");

  const cues = vtt
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .slice(1)
    .filter((b) => b.includes("-->"))
    .map((block) => {
      const lines = block.split("\n");
      const at = lines.findIndex((l) => l.includes("-->"));
      const m = lines[at].match(/^(\d\d):(\d\d):(\d\d)\.(\d\d\d) --> (\d\d):(\d\d):(\d\d)\.(\d\d\d)$/);
      expect(m, `a cue's times: ${lines[at]}`).not.toBeNull();
      const n = (m as RegExpMatchArray).slice(1).map(Number);
      return {
        start: n[0] * 3600 + n[1] * 60 + n[2] + n[3] / 1000,
        end: n[4] * 3600 + n[5] * 60 + n[6] + n[7] / 1000,
        lines: lines.slice(at + 1).filter((l) => l.trim() !== ""),
      };
    });

  // The voice-over, word for word as NBCC supplied it.
  const SCRIPT = [
    "Got an idea that could raise money for NBCC?",
    "Good. Because fundraising for NBCC just got easier.",
    "A sponsored walk. A bake sale. A quiz night. Whatever you have in mind.",
    "Raise money your way, and we will help. With your own page, posters, a bucket, and more.",
    "Start at nbcc.scot/get-involved.",
    "It takes a few minutes. Tell us what you're planning.",
    "Give it a name.",
    "Set a target, if you'd like one. Say what would help.",
    "Check it, and send it.",
    "Putting on an event? We can list it. You can even ask us along.",
    "A real person reads every sign up, and gets in touch.",
    "Once it's a yes, your page is live.",
    "Share it. Print your QR code. And watch it add up.",
    "It all helps children, young people and vulnerable adults across South West Scotland.",
    "So. Got an idea? Let's make it happen.",
    "nbcc.scot/get-involved",
    "NBCC. Here all year.",
  ];

  it("is a folded away 'Read what the film says' under the film", () => {
    expect(details.querySelector("summary")?.textContent?.trim()).toBe("Read what the film says");
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.closest("[data-film]")).not.toBeNull();
  });

  it("holds the voice-over word for word, in order", () => {
    const lines = [...details.querySelectorAll("p")].map((p) => p.textContent?.replace(/\s+/g, " ").trim());
    expect(lines).toEqual(SCRIPT);
  });

  it("the captions file is WebVTT", () => {
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(cues.length).toBeGreaterThanOrEqual(SCRIPT.length);
  });

  it("the captions are in order, never overlap, each long enough to read, all inside the film", () => {
    let last = 0;
    for (const cue of cues) {
      expect(cue.start, cue.lines.join(" ")).toBeGreaterThanOrEqual(last);
      expect(cue.end - cue.start, cue.lines.join(" ")).toBeGreaterThanOrEqual(1);
      expect(cue.end).toBeLessThanOrEqual(71);
      last = cue.end;
    }
  });

  it("the captions are one or two short lines each", () => {
    for (const cue of cues) {
      expect(cue.lines.length).toBeGreaterThanOrEqual(1);
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) expect(line.length, line).toBeLessThanOrEqual(40);
    }
  });

  it("the captions say exactly what the voice says, nothing added and nothing changed", () => {
    const said = cues.map((c) => c.lines.join(" ")).join(" ");
    expect(said).toBe(SCRIPT.join(" "));
  });
});
