// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Freddie's film on the home page: the script (assets/js/home-film.js), over the page as index.html
// has it. jsdom has no real video, so play and pause are stood in for on the element.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initHomeFilm } = require(resolve(ROOT, "assets/js/home-film.js")) as {
  initHomeFilm: (doc: Document, win: unknown) => unknown;
};
const home = readFileSync(resolve(ROOT, "index.html"), "utf8");

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

let video: HTMLVideoElement;
let playResult: "ok" | "refused";
let store: Record<string, string>;

function load(o: { reduce?: boolean; saveData?: boolean; seen?: boolean; playable?: boolean } = {}) {
  document.open();
  document.write(home);
  document.close();
  video = $<HTMLVideoElement>("[data-hf-video]");
  playResult = o.playable === false ? "refused" : "ok";
  Object.defineProperty(video, "paused", { value: true, writable: true, configurable: true });
  video.play = vi.fn(() => {
    if (playResult === "refused") return Promise.reject(new Error("NotAllowedError"));
    (video as unknown as { paused: boolean }).paused = false;
    video.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  video.pause = vi.fn(() => {
    (video as unknown as { paused: boolean }).paused = true;
    video.dispatchEvent(new Event("pause"));
  });
  store = o.seen ? { "nbcc-freddie-film-seen": "1" } : {};
  const win = {
    matchMedia: (q: string) => ({ matches: q.includes("reduce") ? !!o.reduce : false }),
    navigator: { connection: o.saveData ? { saveData: true } : {} },
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
  };
  initHomeFilm(document, win);
}

beforeEach(() => vi.restoreAllMocks());

describe("on a first visit", () => {
  it("starts by itself, silently, with captions, the browser's own controls off, and Tap for sound showing", async () => {
    load();
    await flush();
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("controls")).toBe(false);
    expect(video.textTracks.length === 0 || video.textTracks[0].mode !== "disabled").toBe(true);
    expect($("[data-hf-sound]").hidden).toBe(false);
    expect($("[data-hf-pause]").hidden).toBe(false);
    expect($("[data-hf-play]").hidden).toBe(true);
  });

  it("remembers the visit, so the next one waits for a tap", async () => {
    load();
    await flush();
    expect(store["nbcc-freddie-film-seen"]).toBe("1");
  });
});

describe("Tap for sound", () => {
  it("turns the sound on and starts again from the beginning", async () => {
    load();
    await flush();
    video.currentTime = 40;
    $<HTMLButtonElement>("[data-hf-sound]").click();
    await flush();
    expect(video.muted).toBe(false);
    expect(video.currentTime).toBe(0);
    expect(video.play).toHaveBeenCalledTimes(2);
    expect($("[data-hf-sound]").hidden).toBe(true);
  });
});

describe("pause and play", () => {
  it("pauses, and the big play button carries on from where it was", async () => {
    load();
    await flush();
    $<HTMLButtonElement>("[data-hf-pause]").click();
    expect(video.pause).toHaveBeenCalled();
    expect($("[data-hf-play]").hidden).toBe(false);
    video.currentTime = 12;
    $<HTMLButtonElement>("[data-hf-play]").click();
    await flush();
    expect(video.currentTime).toBe(12);
    expect($("[data-hf-play]").hidden).toBe(true);
  });
});

describe("when it does not start by itself", () => {
  it.each([
    ["asks for less motion", { reduce: true }],
    ["asks to save data", { saveData: true }],
    ["has been before", { seen: true }],
  ])("waits with its still and a big play button for someone who %s", async (_w, o) => {
    load(o);
    await flush();
    expect(video.play).not.toHaveBeenCalled();
    expect($("[data-hf-play]").hidden).toBe(false);
    expect($("[data-hf-sound]").hidden).toBe(true);
  });

  it("pressing play then plays with the sound on, from the start", async () => {
    load({ seen: true });
    await flush();
    $<HTMLButtonElement>("[data-hf-play]").click();
    await flush();
    expect(video.muted).toBe(false);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it("shows the play button, never a blank box, when the phone refuses to play it", async () => {
    load({ playable: false });
    await flush();
    expect($("[data-hf-play]").hidden).toBe(false);
    expect($("[data-hf-sound]").hidden).toBe(true);
  });
});

describe("the ending", () => {
  it("shows Fill a bag and Watch again, and moves to Fill a bag", async () => {
    load();
    await flush();
    video.dispatchEvent(new Event("ended"));
    expect($("[data-hf-end]").hidden).toBe(false);
    expect(document.activeElement).toBe($("[data-hf-fill]"));
    expect($("[data-hf-sound]").hidden).toBe(true);
    expect($("[data-hf-pause]").hidden).toBe(true);
  });

  it("Watch again plays it from the start with the sound on", async () => {
    load();
    await flush();
    video.dispatchEvent(new Event("ended"));
    video.currentTime = 103;
    $<HTMLButtonElement>("[data-hf-again]").click();
    await flush();
    expect(video.currentTime).toBe(0);
    expect(video.muted).toBe(false);
    expect($("[data-hf-end]").hidden).toBe(true);
  });
});

describe("captions", () => {
  it("can be turned off and on, and the button says which", async () => {
    load();
    await flush();
    const btn = $<HTMLButtonElement>("[data-hf-captions]");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    btn.click();
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});
