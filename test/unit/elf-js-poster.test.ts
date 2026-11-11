// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { claimWinHtml, renderPosterPage, visitWinHtml, wordRefusalWords } from "../../src/elf/pages/poster";
import type { PosterOutcome, PosterView } from "../../src/elf/pages/types";
import { claimWin, posterView, visitWin } from "./elf-fixtures";
import { tinyJpeg } from "./fixtures/tiny-jpeg";

// NBCC Elf Detective School: the script on the page a poster's QR code opens. It sends the word on
// the elf's tag without leaving the page and shows the answer the server draws. It runs here against
// the real page with a pretend server. Every shop and family is invented (see elf-fixtures.ts).
//
// The page has one form, the word, and after a visit a photo sheet; a visit is proved by the word
// alone (decision 3). The tests of checking in by the phone's location went with that decision.

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
  method: string | null;
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
    calls.push({ url, json: typeof body === "string" ? JSON.parse(body) : null, type: headers["Content-Type"] ?? null, method: init?.method ?? null });
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
    expect(words($("form.elf-word .elf-form-status"))).toBe("Tick who is here.");
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

// ---- the photo sheet ------------------------------------------------------------------------------

const SHEET = ".elf-photo-sheet__form";
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

async function visited(opts: Record<string, unknown> = {}): Promise<void> {
  answer = { status: 200, body: { ok: true, html: visitWinHtml(visitWin()) } };
  load(posterView(OPEN), opts);
  tick("d1", "d2");
  await typeWord("SNOWBALL 472");
  calls = [];
}

function tickConsent(on: boolean): void {
  const box = $<HTMLInputElement>(`${SHEET} input[name="consent"]`);
  box.checked = on;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

async function pick(file: File): Promise<void> {
  const input = $<HTMLInputElement>(`${SHEET} input[type="file"]`);
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
}

async function submitSheet(): Promise<void> {
  $(SHEET).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

async function jpegFile(): Promise<File> {
  return new File([new Uint8Array(await tinyJpeg())], "me.jpg", { type: "image/jpeg" });
}

describe("the photo sheet after a visit", () => {
  it("keeps Send it to the head elves off until the tick is ticked", async () => {
    await visited();
    const send = $<HTMLButtonElement>(`${SHEET} button[type="submit"]`);
    expect(send.disabled).toBe(true);
    tickConsent(true);
    expect(send.disabled).toBe(false);
    tickConsent(false);
    expect(send.disabled).toBe(true);
  });

  it("shows the chosen photo in the polaroid before it is sent", async () => {
    await visited();
    const preview = $(`${SHEET} .elf-photo-sheet__preview`);
    expect(preview.hidden).toBe(true);
    await pick(await jpegFile());
    expect(preview.hidden).toBe(false);
    expect(words(preview)).toBe("Your photo");
  });

  it("sends the photo as base64 with the tick, and says a head elf will look", async () => {
    await visited();
    tickConsent(true);
    await pick(await jpegFile());
    answer = { status: 202, body: { status: "waiting", token: "abc123" } };
    await submitSheet();
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/elf/p/toy-shop-k4f9/photo");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].json).toEqual({ mime: "image/jpeg", dataBase64: Buffer.from(await tinyJpeg()).toString("base64"), consent: true });
    expect(words($("#elf-result"))).toContain("A head elf will look at your photo soon");
    expect(document.querySelector(SHEET)).toBeNull();
  });

  it("sends the picture the browser made smaller when it can make one", async () => {
    const made: unknown[] = [];
    await visited({
      read: () => Promise.resolve({ src: "blob:x", width: 4000, height: 3000, img: {} }),
      make: (pic: unknown) => {
        made.push(pic);
        return Promise.resolve({ mime: "image/jpeg", base64: "c21hbGw=" });
      },
    });
    tickConsent(true);
    await pick(new File([new Uint8Array([1, 2, 3])], "big.jpg", { type: "image/jpeg" }));
    answer = { status: 202, body: { status: "waiting", token: "abc123" } };
    await submitSheet();
    expect(made.length).toBe(1);
    expect(calls[0].json).toEqual({ mime: "image/jpeg", dataBase64: "c21hbGw=", consent: true });
  });

  it("shows the server's own error when the photo is refused", async () => {
    await visited();
    tickConsent(true);
    await pick(await jpegFile());
    answer = { status: 429, body: { error: "You have sent 5 photos today. Please try again tomorrow." } };
    await submitSheet();
    const status = $(`${SHEET} .elf-form-status`);
    expect(words(status)).toBe("You have sent 5 photos today. Please try again tomorrow.");
    expect(status.classList.contains("is-error")).toBe(true);
    expect($<HTMLButtonElement>(`${SHEET} button[type="submit"]`).disabled).toBe(false);
  });

  it("asks for a photo before it sends anything", async () => {
    await visited();
    tickConsent(true);
    await submitSheet();
    expect(calls).toEqual([]);
    expect(words($(`${SHEET} .elf-form-status`))).toBe("Choose a photo first.");
  });

  it("hides the sheet on Not this time", async () => {
    await visited();
    const sheet = $(".elf-photo-sheet");
    click($(".elf-photo-sheet__skip"));
    expect(sheet.hidden).toBe(true);
  });
});

describe("Take it down", () => {
  it("sends a DELETE for the poster's photo and says it has come down", async () => {
    load(posterView({ ...OPEN, yourPhoto: { status: "approved", token: "abc123" } }));
    answer = { status: 200, body: { ok: true } };
    click($(".elf-your-photo__down"));
    await flush();
    expect(calls).toEqual([{ url: "/api/elf/p/toy-shop-k4f9/photo", json: null, type: null, method: "DELETE" }]);
    expect(words($(".elf-your-photo"))).toContain("Your photo has been taken down.");
    expect(document.querySelector(".elf-your-photo__down")).toBeNull();
  });

  it("shows the server's error and keeps the button when it fails", async () => {
    load(posterView({ ...OPEN, yourPhoto: { status: "waiting", token: "abc123" } }));
    answer = { status: 500, body: { error: "Something broke." } };
    click($(".elf-your-photo__down"));
    await flush();
    expect(words($(".elf-your-photo"))).toContain("Something broke.");
    expect($(".elf-your-photo__down")).not.toBeNull();
  });

  it("sends the photo's Take it down from the waiting words too", async () => {
    await visited();
    tickConsent(true);
    await pick(await jpegFile());
    answer = { status: 202, body: { status: "waiting", token: "abc123" } };
    await submitSheet();
    calls = [];
    answer = { status: 200, body: { ok: true } };
    click($("#elf-result .elf-photo-down"));
    await flush();
    expect(calls[0].method).toBe("DELETE");
    expect(words($("#elf-result"))).toContain("Your photo has been taken down.");
  });
});
