// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { claimRefusalWords, claimWinHtml, renderPosterPage, stampRefusalWords, stampWinHtml } from "../../src/elf/pages/poster";
import type { PosterOutcome, PosterView } from "../../src/elf/pages/types";
import { claimWin, posterView, stampWin } from "./elf-fixtures";

// NBCC Elf Detective School: the script on the page a poster's QR code opens. It sends a claim or a
// check in without leaving the page and shows the answer the server draws. It runs here against the
// real page with a pretend server and a pretend phone. Every shop and family is invented (see
// elf-fixtures.ts).

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
  form: FormData | null;
  type: string | null;
}
type Answer = { status: number; body: unknown } | "offline";

let poster: Poster | null = null;
let clock = 0;
let calls: Call[] = [];
let answer: Answer = { status: 200, body: { ok: true, html: "" } };
/** The pretend phone: how it answers when asked where it is. */
let phone: { lat: number; lng: number } | "refused" = { lat: 55.5432, lng: -4.6621 };
let asked: unknown[] = [];

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const OPEN = { open: true, claimable: false };

const geolocation = {
  getCurrentPosition(ok: (pos: unknown) => void, fail: (err: unknown) => void, options: unknown) {
    asked.push(options);
    if (phone === "refused") fail({ code: 1 });
    else ok({ coords: { latitude: phone.lat, longitude: phone.lng, accuracy: 12 } });
  },
};

function load(view: PosterView = posterView(), opts: Record<string, unknown> = {}, outcome?: PosterOutcome): Poster {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderPosterPage(view, outcome), "text/html").documentElement.innerHTML;
  calls = [];
  asked = [];
  clock = 5_000_000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      json: typeof body === "string" ? JSON.parse(body) : null,
      form: body instanceof FormData ? body : null,
      type: headers["Content-Type"] ?? null,
    });
    if (answer === "offline") return Promise.reject(new Error("offline"));
    const a = answer;
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  poster = initPoster(document, window, { now: () => clock, geolocation, ...opts }) as Poster;
  return poster;
}

function tick(form: string, ...ids: string[]): void {
  for (const box of $$<HTMLInputElement>(`${form} input[name="detective"]`)) box.checked = ids.includes(box.value);
}

async function claim(word: string): Promise<Event> {
  $<HTMLInputElement>('form.elf-claim input[name="word"]').value = word;
  const event = new Event("submit", { bubbles: true, cancelable: true });
  $("form.elf-claim").dispatchEvent(event);
  await flush();
  return event;
}

afterEach(() => {
  poster?.stop();
  poster = null;
  answer = { status: 200, body: { ok: true, html: "" } };
  phone = { lat: 55.5432, lng: -4.6621 };
});

describe("claiming an elf", () => {
  it("sends who found it and the word, without leaving the page", async () => {
    answer = { status: 200, body: { ok: true, html: claimWinHtml(claimWin()) } };
    load();
    tick("form.elf-claim", "d1");
    const event = await claim("snowball 472");
    expect(event.defaultPrevented).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/elf/claim");
    expect(calls[0].type).toBe("application/json");
    expect(calls[0].json).toEqual({ code: "toy-shop-k4f9", detectiveIds: ["d1"], word: "snowball 472" });
  });

  it("shows the gold card the server draws, in place of the form", async () => {
    answer = { status: 200, body: { ok: true, html: claimWinHtml(claimWin()) } };
    load();
    tick("form.elf-claim", "d1");
    await claim("SNOWBALL 472");
    expect(words($("#elf-result h2"))).toBe("You're first!");
    expect($(".elf-claim-card").hidden).toBe(true);
    expect($(".elf-poster__later").hidden).toBe(true);
    expect(document.activeElement).toBe($("#elf-result"));
  });

  it("starts the clock on the card and keeps it to the server's time", async () => {
    answer = { status: 200, body: { ok: true, html: claimWinHtml(claimWin()) } };
    const p = load();
    tick("form.elf-claim", "d1");
    await claim("SNOWBALL 472");
    expect($(".elf-win__now").hidden).toBe(false);
    expect(words($(".elf-clock"))).toBe("5:47:13pm");
    clock += 2000;
    p.tick();
    expect(words($(".elf-clock"))).toBe("5:47:15pm");
    clock += 13 * 60_000;
    p.tick();
    expect(words($(".elf-clock"))).toBe("6:00:15pm");
  });

  it("says why in the server's own words when the claim is refused, and keeps the form", async () => {
    const message = claimRefusalWords("wrong-word", 4);
    answer = { status: 409, body: { ok: false, reason: "wrong-word", message, triesLeft: 4 } };
    load();
    tick("form.elf-claim", "d1", "d2");
    await claim("SNOWBALL 999");
    const status = $("form.elf-claim .elf-form-status");
    expect(words(status)).toBe(message);
    expect(status.classList.contains("is-error")).toBe(true);
    expect($(".elf-claim-card").hidden).toBe(false);
    expect($<HTMLButtonElement>("form.elf-claim button").disabled).toBe(false);
    expect(words($("#elf-result"))).toBe("");
  });

  it("asks for a tick and a word before it sends anything", async () => {
    load();
    await claim("SNOWBALL 472");
    expect(words($("form.elf-claim .elf-form-status"))).toBe("Tick who found the elf.");
    tick("form.elf-claim", "d2");
    await claim("   ");
    expect(words($("form.elf-claim .elf-form-status"))).toBe("Type the secret word on the elf's tag.");
    expect(calls).toEqual([]);
  });

  it("says plainly when there is no signal, or when the answer makes no sense", async () => {
    answer = "offline";
    load();
    tick("form.elf-claim", "d1");
    await claim("SNOWBALL 472");
    expect(words($("form.elf-claim .elf-form-status"))).toBe("We could not reach NBCC. Check your signal and try again.");
    answer = { status: 500, body: "<html>" };
    await claim("SNOWBALL 472");
    expect(words($("form.elf-claim .elf-form-status"))).toBe("Something went wrong. Refresh the page and try again.");
    answer = { status: 200, body: { ok: true } };
    await claim("SNOWBALL 472");
    expect(words($("form.elf-claim .elf-form-status"))).toBe("Something went wrong. Refresh the page and try again.");
  });

  it("puts a refusal on the page as words, never as markup", async () => {
    answer = { status: 409, body: { ok: false, message: "<img src=x onerror=alert(1)>" } };
    load();
    tick("form.elf-claim", "d1");
    await claim("SNOWBALL 472");
    expect($("form.elf-claim .elf-form-status").querySelector("img")).toBeNull();
    expect(words($("form.elf-claim .elf-form-status"))).toBe("<img src=x onerror=alert(1)>");
  });

  it("sends once however many times the button is pressed while it waits", async () => {
    answer = { status: 200, body: { ok: true, html: claimWinHtml(claimWin()) } };
    load();
    tick("form.elf-claim", "d1");
    $<HTMLInputElement>('form.elf-claim input[name="word"]').value = "SNOWBALL 472";
    $("form.elf-claim").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect($<HTMLButtonElement>("form.elf-claim button").disabled).toBe(true);
    $("form.elf-claim").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(calls.length).toBe(1);
  });
});

describe("checking in with the phone's location", () => {
  it("offers the location button only on a phone that can share where it is", () => {
    load(posterView(OPEN));
    expect($(".elf-stamp__location").hidden).toBe(false);
    load(posterView(OPEN), { geolocation: null });
    expect($(".elf-stamp__location").hidden).toBe(true);
  });

  it("asks the phone once, sends where it is, and shows the candy cane card", async () => {
    answer = { status: 200, body: { ok: true, html: stampWinHtml(stampWin()) } };
    load(posterView(OPEN));
    tick("form.elf-stamp", "d1", "d2");
    $(".elf-stamp__location button").click();
    await flush();
    expect(asked.length).toBe(1);
    expect(asked[0]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/elf/stamp");
    expect(calls[0].json).toEqual({ code: "toy-shop-k4f9", detectiveIds: ["d1", "d2"], location: { lat: 55.5432, lng: -4.6621 } });
    expect(words($("#elf-result h2"))).toBe("Candy cane collected!");
    expect($(".elf-stamp-card").hidden).toBe(true);
    expect(document.activeElement).toBe($("#elf-result"));
  });

  it("asks who is here before it asks the phone anything", async () => {
    load(posterView(OPEN));
    $(".elf-stamp__location button").click();
    await flush();
    expect(words($("form.elf-stamp .elf-form-status"))).toBe("Tick who is here.");
    expect(asked).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("points to the photo when the phone will not say where it is, and sends nothing", async () => {
    phone = "refused";
    load(posterView(OPEN));
    tick("form.elf-stamp", "d1");
    $(".elf-stamp__location button").click();
    await flush();
    expect(words($("form.elf-stamp .elf-form-status"))).toBe("We could not find where your phone is. You can take a photo here instead.");
    expect($("form.elf-stamp .elf-form-status").classList.contains("is-error")).toBe(true);
    expect(calls).toEqual([]);
    expect($<HTMLButtonElement>(".elf-stamp__location button").disabled).toBe(false);
  });

  it("gives up on a phone that never answers, and leaves the photo on offer all the while", async () => {
    vi.useFakeTimers();
    const silent = { getCurrentPosition: () => undefined };
    load(posterView(OPEN), { geolocation: silent });
    tick("form.elf-stamp", "d1");
    $(".elf-stamp__location button").click();
    expect($<HTMLButtonElement>('form.elf-stamp button[type="submit"]').disabled).toBe(false);
    expect(words($("form.elf-stamp .elf-form-status"))).toBe("Finding where you are");
    vi.advanceTimersByTime(21000);
    expect(words($("form.elf-stamp .elf-form-status"))).toBe("We could not find where your phone is. You can take a photo here instead.");
    expect($<HTMLButtonElement>(".elf-stamp__location button").disabled).toBe(false);
    // The claim form on the same page is not left frozen either.
    vi.useRealTimers();
    expect(calls).toEqual([]);
  });

  it("shows the server's words when the phone is too far away", async () => {
    answer = { status: 409, body: { ok: false, reason: "too-far", message: stampRefusalWords("too-far") } };
    load(posterView(OPEN));
    tick("form.elf-stamp", "d1");
    $(".elf-stamp__location button").click();
    await flush();
    expect(words($("form.elf-stamp .elf-form-status"))).toBe(stampRefusalWords("too-far"));
    expect($(".elf-stamp-card").hidden).toBe(false);
  });
});

describe("checking in with a photo", () => {
  const choosePhoto = () => {
    const file = new File(["pretend picture"], "elf.jpg", { type: "image/jpeg" });
    Object.defineProperty($<HTMLInputElement>("#elf-photo"), "files", { value: [file], configurable: true });
    return file;
  };

  it("sends the photo with who is here, as a form", async () => {
    answer = { status: 200, body: { ok: true, html: stampWinHtml(stampWin()) } };
    load(posterView(OPEN));
    tick("form.elf-stamp", "d2");
    const file = choosePhoto();
    const event = new Event("submit", { bubbles: true, cancelable: true });
    $("form.elf-stamp").dispatchEvent(event);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/elf/stamp");
    expect(calls[0].type).toBeNull();
    const sent = calls[0].form!;
    expect(sent.get("code")).toBe("toy-shop-k4f9");
    expect(sent.getAll("detective")).toEqual(["d2"]);
    expect((sent.get("photo") as File).name).toBe(file.name);
    expect(words($("#elf-result h2"))).toBe("Candy cane collected!");
  });

  it("asks for a photo before it sends anything", async () => {
    load(posterView(OPEN));
    tick("form.elf-stamp", "d1");
    $("form.elf-stamp").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(words($("form.elf-stamp .elf-form-status"))).toBe("Choose a photo first.");
    expect(calls).toEqual([]);
  });
});

describe("things that only go wrong on a real phone", () => {
  it("keeps the gold card when another detective then checks in: the candy cane goes under it", async () => {
    answer = { status: 200, body: { ok: true, html: claimWinHtml(claimWin()) } };
    load(posterView({ open: true, claimable: true }));
    tick("form.elf-claim", "d1");
    await claim("SNOWBALL 472");
    answer = { status: 200, body: { ok: true, html: stampWinHtml(stampWin()) } };
    tick("form.elf-stamp", "d2");
    $(".elf-stamp__location button").click();
    await flush();
    expect($$("#elf-result h2").map(words)).toEqual(["You're first!", "Candy cane collected!"]);
  });

  it("treats an answer that is not JSON as a problem, not a win", async () => {
    load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("not json")) }));
    tick("form.elf-claim", "d1");
    await claim("SNOWBALL 472");
    expect(words($("form.elf-claim .elf-form-status"))).toBe("Something went wrong. Refresh the page and try again.");
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
