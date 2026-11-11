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

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function load(view: HqView = hqView()): Hq {
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
  hq = initHq(document, window, { now: () => clock, reload: () => (reloads += 1) }) as Hq;
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
    expect(calls).toEqual([{ url: "/api/elf/guess", body: { door: 7, guess: "The Bookshop" } }]);
  });

  it("says the guess is locked in, names the place, and offers to change it", async () => {
    load();
    await choose("The Bookshop");
    expect(words($(".elf-guess__status"))).toBe("Guess locked in: The Bookshop. You can change it until the elf is found.");
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

  it("says when the door has just opened and guessing is over", async () => {
    answer = { status: 409, body: { ok: false, reason: "not-hunting" } };
    load();
    await choose("The Bookshop");
    expect(words($(".elf-guess__status"))).toBe("Too late: this door has just opened. Have a look at the calendar.");
    expect($(".elf-guess__status").classList.contains("is-error")).toBe(true);
  });

  it("says when the place has just been taken off the list", async () => {
    answer = { status: 409, body: { ok: false, reason: "place-already-open" } };
    load();
    await choose("The Bookshop");
    expect(words($(".elf-guess__status"))).toBe("That place is no longer on the list. Pick another.");
  });

  it("says so plainly when the guess could not be saved, and lets the family try again", async () => {
    answer = "offline";
    load();
    await choose("The Bookshop");
    expect(words($(".elf-guess__status"))).toBe("We could not save your guess. Check your signal and try again.");
    expect($<HTMLButtonElement>("form.elf-guess button").disabled).toBe(false);
    answer = { status: 200, body: { ok: true } };
    await choose("The Toy Shop");
    expect(words($(".elf-guess__status"))).toContain("Guess locked in: The Toy Shop.");
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
    const base = hqView();
    const page = load(hqView({ today: { ...base.today!, state: "shut", nextClueAt: at("2026-12-07T19:00:00.000Z"), clues: [] } }));
    clock += 2 * 3600 * 1000;
    page.tick();
    page.tick();
    expect(reloads).toBe(1);
  });

  it("does nothing on a page with no countdown and no guess to make", () => {
    const page = load(hqView({ today: null, nextClueAt: null }));
    expect(() => page.tick()).not.toThrow();
    expect(calls).toEqual([]);
  });
});
