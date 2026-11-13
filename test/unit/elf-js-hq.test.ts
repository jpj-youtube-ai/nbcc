// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderHqPage } from "../../src/elf/pages/hq";
import type { HqView } from "../../src/elf/pages/types";
import { at, hqView } from "./elf-fixtures";

// NBCC Elf Detective School: the script on Detective HQ. It saves the daily guess without leaving
// the page, and ticks the countdown. It runs here against the real page with a pretend server. Every
// family and business is invented (see elf-fixtures.ts).

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initHq } = require(resolve(ROOT, "assets/js/elf-hq.js"));

interface Hq {
  tick(): void;
  stop(): void;
}

let hq: Hq | null = null;
let clock = 0;
let reloads = 0;
let calls: { url: string; body: Record<string, unknown> }[] = [];
let answer: { status: number; body: unknown } | "offline" = { status: 200, body: { ok: true } };
/** Where the page was sent (opts.go). */
let went: string[] = [];

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function load(view: HqView = hqView(), extra: Record<string, unknown> = {}): Hq {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderHqPage(view), "text/html").documentElement.innerHTML;
  calls = [];
  clock = 5_000_000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (answer === "offline") return Promise.reject(new Error("offline"));
    const a = answer;
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  reloads = 0;
  went = [];
  hq = initHq(document, window, { now: () => clock, reload: () => (reloads += 1), go: (url: string) => went.push(url), ...extra }) as Hq;
  return hq;
}

async function choose(guess: string): Promise<void> {
  $<HTMLInputElement>('input[name="text"]').value = guess;
  $("form.elf-guess").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
}

describe("things that only go wrong on a real phone", () => {
  it("ticks by itself, a second at a time", () => {
    vi.useFakeTimers();
    load(hqView({ today: { ...hqView().today!, state: "shut", nextClueAt: at("2026-12-07T19:00:00.000Z"), clues: [], canGuess: false } }));
    const before = words($(".elf-cd"));
    clock += 3000;
    vi.advanceTimersByTime(1000);
    expect(words($(".elf-cd"))).not.toBe(before);
    vi.useRealTimers();
  });

  it("does not fetch the page again and again when the clue time had passed before the page was drawn", () => {
    const h = load(hqView({ today: { ...hqView().today!, state: "shut", nextClueAt: at("2026-12-07T17:00:00.000Z"), clues: [], canGuess: false } }));
    h.tick();
    h.tick();
    expect(reloads).toBe(0);
  });

  it("treats an answer that is not JSON as not saved", async () => {
    load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("not json")) }));
    await choose("The Bookshop");
    expect(words($(".elf-guess__status"))).toBe("We could not save your guess. Check your signal and try again.");
  });
});

afterEach(() => {
  hq?.stop();
  hq = null;
  answer = { status: 200, body: { ok: true } };
});

describe("locking in a guess", () => {
  it("sends the door and the place, and stays on the page", async () => {
    load();
    const event = new Event("submit", { bubbles: true, cancelable: true });
    $<HTMLInputElement>('input[name="text"]').value = "The Bookshop";
    $("form.elf-guess").dispatchEvent(event);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(calls).toEqual([{ url: "/api/elf/guess", body: { door: 7, text: "The Bookshop" } }]);
  });

  it("says the guess is locked in, names the place, and offers to change it", async () => {
    load();
    await choose("The Bookshop");
    expect(words($(".elf-guess__status"))).toBe("Your guess: The Bookshop. You can change it until the hiding place is shown.");
    expect(words($("form.elf-guess button"))).toBe("Change my guess");
    expect($(".elf-guess__status").classList.contains("is-error")).toBe(false);
  });

  it("asks for a place when none is typed, and sends nothing", async () => {
    load();
    $("form.elf-guess").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(calls).toEqual([]);
    expect(words($(".elf-guess__status"))).toBe("Type a place first.");
  });

  it("says when there is nothing to guess at the door, in the server's words, and stays on the page", async () => {
    answer = { status: 400, body: { reason: "not-hunting", message: "There is nothing to guess at this door just now." } };
    load();
    await choose("The Bookshop");
    expect(words($(".elf-guess__status"))).toBe("There is nothing to guess at this door just now.");
    expect($(".elf-guess__status").classList.contains("is-error")).toBe(true);
    expect(went).toEqual([]);
  });

  // Plan 2c-1, Task 7: once the place is shown, a guess is never saved as the go. A family with its guess is
  // sent back to Detective HQ to see how it did; one that may have a go is sent to have it.
  it("goes where the server sends it once the place is shown: to the go page, or back to Detective HQ", async () => {
    answer = { status: 409, body: { reason: "have-a-go", message: "The hiding place is shown now, so this is your one go at this door.", goUrl: "/elf/hq/door/7" } };
    load();
    await choose("The Bookshop");
    expect(went).toEqual(["/elf/hq/door/7"]);
    expect($(".elf-guess__status").classList.contains("is-error")).toBe(false);
    answer = { status: 409, body: { reason: "locked-in", message: "Your guess is locked in, and the hiding place is shown now.", goUrl: "/elf/hq" } };
    await choose("The Bookshop");
    expect(went).toEqual(["/elf/hq/door/7", "/elf/hq"]);
  });

  it("goes nowhere but this site: any other address is only said as words", async () => {
    load();
    for (const goUrl of ["//elsewhere.example/hq", "https://elsewhere.example/hq", "/\\elsewhere.example", "javascript:alert(1)", "elf/hq", 7]) {
      answer = { status: 409, body: { reason: "have-a-go", message: "The hiding place is shown now, so this is your one go at this door.", goUrl } };
      await choose("The Bookshop");
      expect(went, String(goUrl)).toEqual([]);
      expect(words($(".elf-guess__status")), String(goUrl)).toBe("The hiding place is shown now, so this is your one go at this door.");
      expect($(".elf-guess__status").classList.contains("is-error")).toBe(true);
    }
  });

  // Ruling F15: the page's own way to go is a function wrapper, as reload is. A bare win.location.assign, called
  // on its own, throws "Illegal invocation" in a real browser.
  it("goes through the window's own location when no way to go is given, called on that location", async () => {
    document.documentElement.innerHTML = new DOMParser().parseFromString(renderHqPage(hqView()), "text/html").documentElement.innerHTML;
    const assigned: { self: unknown; url: string }[] = [];
    const location = {
      assign(this: unknown, url: string) {
        assigned.push({ self: this, url });
      },
    };
    const fetch = vi.fn(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ reason: "have-a-go", message: "Go on.", goUrl: "/elf/hq/door/7" }) }));
    const win = { fetch, location, setInterval: () => 1, clearInterval: () => undefined, setTimeout: () => 1, clearTimeout: () => undefined };
    hq = initHq(document, win, { now: () => clock }) as Hq;
    await choose("The Bookshop");
    expect(assigned).toEqual([{ self: location, url: "/elf/hq/door/7" }]);
  });

  it("names the door when the place typed was already found", async () => {
    answer = { status: 400, body: { reason: "place-already-open", door: 3, message: "That elf was already found behind door 3. Try again!" } };
    load();
    await choose("The Bookshop");
    expect(words($(".elf-guess__status"))).toContain("already found behind door 3");
    expect($(".elf-guess__status").classList.contains("is-error")).toBe(true);
  });

  it("says so plainly when the guess could not be saved, and lets the family try again", async () => {
    answer = "offline";
    load();
    await choose("The Bookshop");
    expect(words($(".elf-guess__status"))).toBe("We could not save your guess. Check your signal and try again.");
    expect($<HTMLButtonElement>("form.elf-guess button").disabled).toBe(false);
    answer = { status: 200, body: { ok: true, text: "The Toy Shop" } };
    await choose("The Toy Shop");
    expect(words($(".elf-guess__status"))).toContain("Your guess: The Toy Shop.");
  });

  it("does not send twice while the first is still on its way", async () => {
    load();
    $<HTMLInputElement>('input[name="text"]').value = "The Bookshop";
    const form = $("form.elf-guess");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(calls.length).toBe(1);
  });
});

describe("the countdown to the clue", () => {
  it("ticks down by the server's clock, and stops at nought", () => {
    const base = hqView();
    const view = hqView({ today: { ...base.today!, state: "shut", nextClueAt: at("2026-12-07T19:00:00.000Z"), clues: [] } });
    const page = load(view);
    expect($(".elf-cd").textContent).toBe("1:20:00");
    clock += 1000;
    page.tick();
    expect($(".elf-cd").textContent).toBe("1:19:59");
    expect(reloads).toBe(0);
    clock += 2 * 3600 * 1000;
    page.tick();
    expect($(".elf-cd").textContent).toBe("0:00");
  });

  it("fetches the page again when the clue comes out, once, because the clue is never in the page before then", () => {
    vi.useFakeTimers();
    try {
      const base = hqView();
      const page = load(hqView({ today: { ...base.today!, state: "shut", nextClueAt: at("2026-12-07T19:00:00.000Z"), clues: [] } }));
      clock += 2 * 3600 * 1000;
      page.tick();
      page.tick();
      vi.advanceTimersByTime(60_000);
      expect(reloads).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Final review, Important 5: every family's HQ would fetch itself again in the same second as a clue
  // comes out. Each page waits a while first, a different while for each: from one second to six.
  it("waits a second and a random few more before fetching the page again, a different while for each page", () => {
    vi.useFakeTimers();
    try {
      const base = hqView();
      const view = hqView({ today: { ...base.today!, state: "shut", nextClueAt: at("2026-12-07T19:00:00.000Z"), clues: [] } });
      for (const [random, wait] of [[0.5, 3500], [0, 1000], [0.9999, 5999]] as const) {
        const page = load(view, { random: () => random });
        clock += 2 * 3600 * 1000;
        page.tick();
        vi.advanceTimersByTime(wait - 1);
        expect(reloads, `random ${random}`).toBe(0);
        vi.advanceTimersByTime(1);
        expect(reloads, `random ${random}`).toBe(1);
        page.stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches nothing once stopped, even with a fetch waiting", () => {
    vi.useFakeTimers();
    try {
      const base = hqView();
      const page = load(hqView({ today: { ...base.today!, state: "shut", nextClueAt: at("2026-12-07T19:00:00.000Z"), clues: [] } }), { random: () => 0.5 });
      clock += 2 * 3600 * 1000;
      page.tick();
      page.stop();
      vi.advanceTimersByTime(60_000);
      expect(reloads).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing on a page with no countdown and no guess to make", () => {
    const page = load(hqView({ today: null, nextClueAt: null }));
    expect(() => page.tick()).not.toThrow();
    expect(calls).toEqual([]);
  });
});
