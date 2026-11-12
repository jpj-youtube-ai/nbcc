// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderCalendarPage } from "../../src/elf/pages/calendar";
import { AFTERNOON, calendarView } from "./elf-fixtures";

// The script behind Elf Detective School's film (assets/js/elf-film.js, TASK-616), run against the real
// page with a pretend video: it plays by itself without sound, a button turns the sound on, people who
// asked for less motion or data saving see the poster and a play button, and the film waits while it
// is scrolled out of view but never starts again once it has ended or once the person has paused it.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initElfFilm } = require(resolve(ROOT, "assets/js/elf-film.js"));

interface Options {
  reducedMotion?: boolean;
  saveData?: boolean;
  noConnection?: boolean;
  playRefused?: boolean;
  noObserver?: boolean;
  /** The browser has already started it by itself (the autoplay attribute) before the script runs. */
  started?: boolean;
}

function setUp(opts: Options = {}) {
  const doc = new DOMParser().parseFromString(renderCalendarPage(calendarView(AFTERNOON)), "text/html");
  const video = doc.querySelector("video") as HTMLVideoElement;
  // A pretend player: the real element's state, moved by hand.
  const state = { paused: !opts.started, muted: true, ended: false };
  for (const key of ["paused", "muted", "ended"] as const) {
    Object.defineProperty(video, key, {
      get: () => state[key],
      set: (value: boolean) => {
        state[key] = value;
        if (key === "muted") video.dispatchEvent(new Event("volumechange"));
      },
      configurable: true,
    });
  }
  const play = vi.fn(() => {
    if (opts.playRefused) return Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    state.paused = false;
    state.ended = false;
    video.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  const pause = vi.fn(() => {
    if (state.paused) return;
    state.paused = true;
    video.dispatchEvent(new Event("pause"));
  });
  Object.assign(video, { play, pause });

  const observers: Array<{ cb: (entries: unknown[]) => void }> = [];
  class FakeObserver {
    cb: (entries: unknown[]) => void;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(cb: (entries: unknown[]) => void) {
      this.cb = cb;
      observers.push(this);
    }
  }
  const win = {
    matchMedia: (q: string) => ({ matches: !!opts.reducedMotion && /prefers-reduced-motion:\s*reduce/.test(q) }),
    navigator: opts.noConnection ? {} : { connection: { saveData: !!opts.saveData } },
    IntersectionObserver: opts.noObserver ? undefined : FakeObserver,
  };
  const film = initElfFilm(doc, win);
  const scrollTo = (ratio: number) =>
    observers.forEach((o) => o.cb([{ target: video, intersectionRatio: ratio, isIntersecting: ratio > 0 }]));
  const sound = doc.querySelector("[data-elf-film-sound]") as HTMLButtonElement;
  return { doc, video, state, play, pause, film, scrollTo, sound, observers };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const ended = (t: ReturnType<typeof setUp>) => {
  t.state.paused = true;
  t.state.ended = true;
  t.video.dispatchEvent(new Event("ended"));
};

describe("playing by itself when people arrive", () => {
  it("asks the film to play, and keeps it muted", async () => {
    const t = setUp();
    await flush();
    expect(t.play).toHaveBeenCalled();
    expect(t.video.muted).toBe(true);
    expect(t.video.hasAttribute("autoplay")).toBe(true);
  });

  it("does not ask again when the browser has already started it", async () => {
    const t = setUp({ started: true });
    await flush();
    expect(t.play).not.toHaveBeenCalled();
  });

  it("leaves the poster and the browser's own play button when the browser will not let it start", async () => {
    const t = setUp({ playRefused: true });
    await flush();
    expect(t.state.paused).toBe(true);
    expect(t.sound.hidden).toBe(true);
  });

  it("does nothing, and says nothing, when the page has no film", () => {
    const doc = new DOMParser().parseFromString("<p>nothing</p>", "text/html");
    expect(initElfFilm(doc, {})).toBeNull();
  });
});

describe("the sound button", () => {
  it("shows while the film plays without sound", async () => {
    const t = setUp();
    await flush();
    expect(t.sound.hidden).toBe(false);
  });

  it("turns the sound on and goes away", async () => {
    const t = setUp();
    await flush();
    t.sound.click();
    expect(t.video.muted).toBe(false);
    expect(t.sound.hidden).toBe(true);
  });

  it("is not needed once the sound is on by the controls", async () => {
    const t = setUp();
    await flush();
    t.video.muted = false;
    expect(t.sound.hidden).toBe(true);
  });

  it("goes away when the film ends, and comes back if it is played again without sound", async () => {
    const t = setUp();
    await flush();
    ended(t);
    expect(t.sound.hidden).toBe(true);
    t.state.paused = false;
    t.state.ended = false;
    t.video.dispatchEvent(new Event("play"));
    expect(t.sound.hidden).toBe(false);
  });

  it("is never shown to someone who asked for less motion until they press play", async () => {
    const t = setUp({ reducedMotion: true });
    await flush();
    expect(t.sound.hidden).toBe(true);
    t.state.paused = false;
    t.video.dispatchEvent(new Event("play"));
    expect(t.sound.hidden).toBe(false);
  });
});

describe("less motion and saving data", () => {
  it.each([
    ["asked for less motion", { reducedMotion: true }],
    ["is saving data", { saveData: true }],
  ])("shows the poster and a play button to anyone who %s", async (_name, opts) => {
    const t = setUp(opts);
    await flush();
    expect(t.play).not.toHaveBeenCalled();
    expect(t.video.hasAttribute("autoplay")).toBe(false);
    expect(t.video.getAttribute("preload")).toBe("none");
    expect(t.video.hasAttribute("controls")).toBe(true);
    expect(t.video.getAttribute("poster")).toBe("/assets/video/elf-detective-school-poster.jpg");
  });

  it("stops a film the browser had already started", async () => {
    const t = setUp({ reducedMotion: true, started: true });
    await flush();
    expect(t.pause).toHaveBeenCalled();
    expect(t.state.paused).toBe(true);
  });

  it("does not trip over a browser with no connection information", async () => {
    const t = setUp({ noConnection: true });
    await flush();
    expect(t.play).toHaveBeenCalled();
  });

  it("lets the person play it themselves, with the controls", async () => {
    const t = setUp({ saveData: true });
    await flush();
    t.scrollTo(0);
    t.scrollTo(1);
    expect(t.play).not.toHaveBeenCalled();
  });
});

describe("scrolled out of view", () => {
  it("pauses when it has gone fully out of view, and carries on when it comes back", async () => {
    const t = setUp();
    await flush();
    t.scrollTo(1);
    t.scrollTo(0.3);
    expect(t.pause).not.toHaveBeenCalled();
    t.scrollTo(0);
    expect(t.pause).toHaveBeenCalledTimes(1);
    t.play.mockClear();
    t.scrollTo(0.2);
    expect(t.play).toHaveBeenCalledTimes(1);
    expect(t.state.paused).toBe(false);
  });

  it("does not start it again once it has ended", async () => {
    const t = setUp();
    await flush();
    t.scrollTo(1);
    ended(t);
    t.play.mockClear();
    t.scrollTo(0);
    t.scrollTo(1);
    expect(t.play).not.toHaveBeenCalled();
    expect(t.pause).not.toHaveBeenCalled();
  });

  it("does not start it again if it ended while it was out of view", async () => {
    const t = setUp();
    await flush();
    t.scrollTo(1);
    t.scrollTo(0);
    ended(t);
    t.play.mockClear();
    t.scrollTo(1);
    expect(t.play).not.toHaveBeenCalled();
  });

  it("does not start it again if the person paused it", async () => {
    const t = setUp();
    await flush();
    t.scrollTo(1);
    t.pause(); // the person, with the controls
    t.play.mockClear();
    t.scrollTo(0);
    t.scrollTo(1);
    expect(t.play).not.toHaveBeenCalled();
  });

  it("carries on after the person plays it again themselves", async () => {
    const t = setUp();
    await flush();
    t.scrollTo(1);
    t.pause();
    t.video.dispatchEvent(new Event("play"));
    t.state.paused = false;
    t.pause.mockClear();
    t.scrollTo(0);
    expect(t.pause).toHaveBeenCalledTimes(1);
  });

  it("holds a film that starts while it is out of view until it is seen", async () => {
    const t = setUp({ started: true });
    await flush();
    t.scrollTo(0);
    expect(t.state.paused).toBe(true);
    t.scrollTo(1);
    expect(t.state.paused).toBe(false);
  });

  it("works without an observer: it just plays", async () => {
    const t = setUp({ noObserver: true });
    await flush();
    expect(t.play).toHaveBeenCalled();
  });
});
