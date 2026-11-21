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
let playResult: "ok" | "refused" | "held";
let store: Record<string, string>;
let track: { mode: string };
// With playResult "held", play() waits: refuseHeld() then rejects it, as a slow phone or a cancelled play does.
let refuseHeld: () => void = () => {};

function load(o: { reduce?: boolean; saveData?: boolean; seen?: boolean; playable?: boolean; held?: boolean } = {}) {
  document.open();
  document.write(home);
  document.close();
  video = $<HTMLVideoElement>("[data-hf-video]");
  playResult = o.held ? "held" : o.playable === false ? "refused" : "ok";
  // jsdom has no caption tracks, so the film's one track is stood in for.
  track = { mode: "disabled" };
  Object.defineProperty(video, "textTracks", { value: [track], configurable: true });
  Object.defineProperty(video, "paused", { value: true, writable: true, configurable: true });
  Object.defineProperty(video, "ended", { value: false, writable: true, configurable: true });
  video.play = vi.fn(() => {
    if (playResult === "refused") return Promise.reject(new Error("NotAllowedError"));
    if (playResult === "held") {
      return new Promise<void>((_ok, no) => {
        refuseHeld = () => no(new Error("AbortError"));
      });
    }
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
    expect(track.mode).toBe("showing");
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
  it("shows Fill a bag and Watch again, and moves to Fill a bag for someone using the film, without scrolling", async () => {
    load();
    await flush();
    $<HTMLButtonElement>("[data-hf-sound]").click();
    await flush();
    const fill = $<HTMLAnchorElement>("[data-hf-fill]");
    const focus = vi.spyOn(fill, "focus");
    video.dispatchEvent(new Event("ended"));
    expect($("[data-hf-end]").hidden).toBe(false);
    expect(document.activeElement).toBe(fill);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect($("[data-hf-sound]").hidden).toBe(true);
    expect($("[data-hf-pause]").hidden).toBe(true);
  });

  it("leaves someone reading further down the page where they are when the silent film ends", async () => {
    load();
    await flush();
    const elsewhere = document.querySelector<HTMLAnchorElement>(".hero a")!;
    elsewhere.focus();
    video.dispatchEvent(new Event("ended"));
    expect($("[data-hf-end]").hidden).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
  });

  it("moves nothing when nobody has touched the page while the silent film played", async () => {
    load();
    await flush();
    expect(document.activeElement).toBe(document.body);
    video.dispatchEvent(new Event("ended"));
    expect(document.activeElement).toBe(document.body);
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
    expect(track.mode).toBe("showing");
    btn.click();
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(track.mode).toBe("hidden");
    btn.click();
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(track.mode).toBe("showing");
  });
});

describe("when the phone or browser pauses or plays it itself", () => {
  it("shows the play button when the phone pauses it (another app, the lock screen, headphones out)", async () => {
    load();
    await flush();
    $<HTMLButtonElement>("[data-hf-sound]").click();
    await flush();
    (video as unknown as { paused: boolean }).paused = true;
    video.dispatchEvent(new Event("pause"));
    expect($("[data-hf-play]").hidden).toBe(false);
    expect($("[data-hf-pause]").hidden).toBe(true);
  });

  it("shows the pause button again when the phone plays it (the lock screen, a media key)", async () => {
    load({ seen: true });
    await flush();
    video.muted = false;
    (video as unknown as { paused: boolean }).paused = false;
    video.dispatchEvent(new Event("play"));
    expect($("[data-hf-play]").hidden).toBe(true);
    expect($("[data-hf-pause]").hidden).toBe(false);
    expect($("[data-hf-sound]").hidden).toBe(true);
  });

  it("does not take the browser's pause at the very end for a pause", async () => {
    load();
    await flush();
    (video as unknown as { ended: boolean }).ended = true;
    video.dispatchEvent(new Event("pause"));
    video.dispatchEvent(new Event("ended"));
    expect($("[data-hf-end]").hidden).toBe(false);
    expect($("[data-hf-play]").hidden).toBe(true);
  });
});

describe("keyboard focus stays in the film", () => {
  it.each([
    ["Tap for sound", "[data-hf-sound]", {}],
    ["Play", "[data-hf-play]", { seen: true }],
  ])("moves to Pause after %s, which hides itself", async (_w, sel, o) => {
    load(o);
    await flush();
    const btn = $<HTMLButtonElement>(sel);
    btn.focus();
    btn.click();
    await flush();
    expect(document.activeElement).toBe($("[data-hf-pause]"));
  });

  it("moves to Pause after Watch again", async () => {
    load();
    await flush();
    video.dispatchEvent(new Event("ended"));
    const again = $<HTMLButtonElement>("[data-hf-again]");
    again.focus();
    again.click();
    await flush();
    expect(document.activeElement).toBe($("[data-hf-pause]"));
  });

  it("moves to Play when the phone refuses to play after a press", async () => {
    load({ seen: true, playable: false });
    await flush();
    const play = $<HTMLButtonElement>("[data-hf-play]");
    play.focus();
    play.click();
    await flush();
    expect($("[data-hf-play]").hidden).toBe(false);
    expect(document.activeElement).toBe(play);
  });
});

describe("a slow start", () => {
  it("does not undo a pause pressed before the first start had begun", async () => {
    load({ held: true });
    await flush();
    $<HTMLButtonElement>("[data-hf-pause]").click();
    refuseHeld(); // pausing cancels the waiting play
    await flush();
    expect(document.querySelector("[data-home-film]")!.getAttribute("data-hf-state")).toBe("paused");
    playResult = "ok";
    video.currentTime = 7;
    $<HTMLButtonElement>("[data-hf-play]").click();
    await flush();
    expect(video.currentTime).toBe(7); // carries on, rather than starting again from the beginning
  });
});
