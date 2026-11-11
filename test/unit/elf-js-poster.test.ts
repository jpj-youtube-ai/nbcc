// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { claimWinHtml, renderPosterPage, visitWinHtml, wordRefusalWords } from "../../src/elf/pages/poster";
import type { PosterOutcome, PosterView } from "../../src/elf/pages/types";
import { claimWin, posterView, visitWin } from "./elf-fixtures";

// NBCC Elf Detective School: the script on the page a poster's QR code opens. It sends the word on
// the elf's tag without leaving the page and shows the answer the server draws. It runs here against
// the real page with a pretend server. Every shop and family is invented (see elf-fixtures.ts).
//
// Task 6 left the page one form, the word, and the script one selector change to find it; Task 9
// rewrites the script (the photo sheet, Take it down) and this file with it. The tests of checking in
// by the phone's location or a photo went with decision 3: a visit is proved by the word alone.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initPoster } = require(resolve(ROOT, "assets/js/elf-poster.js"));

interface Poster {
  tick(): void;
  stop(): void;
}
interface Call {
  url: string;
  json: Record<string, unknown> | null;
  type: string | null;
}
type Answer = { status: number; body: unknown } | "offline";

let poster: Poster | null = null;
let clock = 0;
let calls: Call[] = [];
let answer: Answer = { status: 200, body: { ok: true, html: "" } };

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const OPEN = { open: true, claimable: false };

function load(view: PosterView = posterView(), opts: Record<string, unknown> = {}, outcome?: PosterOutcome): Poster {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderPosterPage(view, outcome), "text/html").documentElement.innerHTML;
  calls = [];
  clock = 5_000_000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, json: typeof body === "string" ? JSON.parse(body) : null, type: headers["Content-Type"] ?? null });
    if (answer === "offline") return Promise.reject(new Error("offline"));
    const a = answer;
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  poster = initPoster(document, window, { now: () => clock, geolocation: null, ...opts }) as Poster;
  return poster;
}

function tick(...ids: string[]): void {
  for (const box of $$<HTMLInputElement>('form.elf-word input[name="detective"]')) box.checked = ids.includes(box.value);
}

async function typeWord(word: string): Promise<Event> {
  $<HTMLInputElement>('form.elf-word input[name="word"]').value = word;
  const event = new Event("submit", { bubbles: true, cancelable: true });
  $("form.elf-word").dispatchEvent(event);
  await flush();
  return event;
}

afterEach(() => {
  poster?.stop();
  poster = null;
  answer = { status: 200, body: { ok: true, html: "" } };
});

describe("typing the word on the elf's tag", () => {
  it("sends who is here and the word, without leaving the page", async () => {
    answer = { status: 200, body: { ok: true, html: claimWinHtml(claimWin()) } };
    load();
    tick("d1");
    const event = await typeWord("snowball 472");
    expect(event.defaultPrevented).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/elf/word");
    expect(calls[0].type).toBe("application/json");
    expect(calls[0].json).toEqual({ code: "toy-shop-k4f9", detectiveIds: ["d1"], word: "snowball 472" });
  });

  it("shows the gold card the server draws, in place of the form", async () => {
    answer = { status: 200, body: { ok: true, html: claimWinHtml(claimWin()) } };
    load();
    tick("d1");
    await typeWord("SNOWBALL 472");
    expect(words($("#elf-result h2"))).toBe("You're first!");
    expect($(".elf-word-card").hidden).toBe(true);
    // Nothing else on the page still asks for the word.
    expect($$(".elf-case").filter((card) => !card.hidden && card.querySelector("form.elf-word")).length).toBe(0);
    expect(document.activeElement).toBe($("#elf-result"));
  });

  it("shows the visit card the server draws for a family that comes after the find", async () => {
    answer = { status: 200, body: { ok: true, html: visitWinHtml(visitWin()) } };
    load(posterView(OPEN));
    tick("d1", "d2");
    await typeWord("SNOWBALL 472");
    expect(words($("#elf-result h2"))).toBe("Door 7 done!");
    expect($("#elf-result .elf-photo-sheet")).not.toBeNull();
    expect($(".elf-word-card").hidden).toBe(true);
  });

  it("starts the clock on the card and keeps it to the server's time", async () => {
    answer = { status: 200, body: { ok: true, html: claimWinHtml(claimWin()) } };
    const p = load();
    tick("d1");
    await typeWord("SNOWBALL 472");
    expect($(".elf-win__now").hidden).toBe(false);
    expect(words($(".elf-clock"))).toBe("5:47:13pm");
    clock += 2000;
    p.tick();
    expect(words($(".elf-clock"))).toBe("5:47:15pm");
    clock += 13 * 60_000;
    p.tick();
    expect(words($(".elf-clock"))).toBe("6:00:15pm");
  });

  it("says why in the server's own words when the word is refused, and keeps the form", async () => {
    const message = wordRefusalWords("wrong-word", 4);
    answer = { status: 400, body: { ok: false, reason: "wrong-word", message, triesLeft: 4 } };
    load();
    tick("d1", "d2");
    await typeWord("SNOWBALL 999");
    const status = $("form.elf-word .elf-form-status");
    expect(words(status)).toBe(message);
    expect(status.classList.contains("is-error")).toBe(true);
    expect($(".elf-word-card").hidden).toBe(false);
    expect($<HTMLButtonElement>("form.elf-word button").disabled).toBe(false);
    expect(words($("#elf-result"))).toBe("");
  });

  it("asks for a tick and a word before it sends anything", async () => {
    load();
    await typeWord("SNOWBALL 472");
    expect(words($("form.elf-word .elf-form-status"))).toBe("Tick who found the elf.");
    tick("d2");
    await typeWord("   ");
    expect(words($("form.elf-word .elf-form-status"))).toBe("Type the secret word on the elf's tag.");
    expect(calls).toEqual([]);
  });

  it("says plainly when there is no signal, or when the answer makes no sense", async () => {
    answer = "offline";
    load();
    tick("d1");
    await typeWord("SNOWBALL 472");
    expect(words($("form.elf-word .elf-form-status"))).toBe("We could not reach NBCC. Check your signal and try again.");
    answer = { status: 500, body: "<html>" };
    await typeWord("SNOWBALL 472");
    expect(words($("form.elf-word .elf-form-status"))).toBe("Something went wrong. Refresh the page and try again.");
    answer = { status: 200, body: { ok: true } };
    await typeWord("SNOWBALL 472");
    expect(words($("form.elf-word .elf-form-status"))).toBe("Something went wrong. Refresh the page and try again.");
  });

  it("puts a refusal on the page as words, never as markup", async () => {
    answer = { status: 409, body: { ok: false, message: "<img src=x onerror=alert(1)>" } };
    load();
    tick("d1");
    await typeWord("SNOWBALL 472");
    expect($("form.elf-word .elf-form-status").querySelector("img")).toBeNull();
    expect(words($("form.elf-word .elf-form-status"))).toBe("<img src=x onerror=alert(1)>");
  });

  it("sends once however many times the button is pressed while it waits", async () => {
    answer = { status: 200, body: { ok: true, html: claimWinHtml(claimWin()) } };
    load();
    tick("d1");
    $<HTMLInputElement>('form.elf-word input[name="word"]').value = "SNOWBALL 472";
    $("form.elf-word").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect($<HTMLButtonElement>("form.elf-word button").disabled).toBe(true);
    $("form.elf-word").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(calls.length).toBe(1);
  });
});

describe("things that only go wrong on a real phone", () => {
  it("treats an answer that is not JSON as a problem, not a win", async () => {
    load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("not json")) }));
    tick("d1");
    await typeWord("SNOWBALL 472");
    expect(words($("form.elf-word .elf-form-status"))).toBe("Something went wrong. Refresh the page and try again.");
  });

  it("ticks the gold card's clock by itself", () => {
    vi.useFakeTimers();
    load(posterView(OPEN), {}, { form: "word", ok: true, outcome: "won", win: claimWin() });
    clock += 5000;
    vi.advanceTimersByTime(1000);
    expect(words($(".elf-clock"))).toBe("5:47:18pm");
    vi.useRealTimers();
  });
});

describe("a page that already holds an answer", () => {
  it("starts the clock on a gold card the server drew into the page", () => {
    load(posterView(OPEN), {}, { form: "word", ok: true, outcome: "won", win: claimWin() });
    expect($(".elf-win__now").hidden).toBe(false);
    expect(words($(".elf-clock"))).toBe("5:47:13pm");
  });

  it("does nothing on a page with no forms", () => {
    expect(() => load(posterView({ signedIn: false, detectives: [] }))).not.toThrow();
    expect(calls).toEqual([]);
  });
});
