// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderEntryPage } from "../../src/elf/pages/entry";
import type { EntryView } from "../../src/elf/pages/types";
import { entryView } from "./elf-fixtures";
import { tinyJpeg } from "./fixtures/tiny-jpeg";

// NBCC Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2, Task 3): the script on the page where
// a family sends in a graduate's picture. It makes the picture smaller in the browser, sends it, and shows the
// server's answer. It runs here against the real page with a pretend server. Every family is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initEntry } = require(resolve(ROOT, "assets/js/elf-entry.js"));

interface Call {
  url: string;
  json: Record<string, unknown> | null;
  type: string | null;
  method: string | null;
  credentials: string | null;
}
type Answer = { status: number; body: unknown } | "offline";

const THANKS = "Thank you! Detective Ruby Tinselfoot's picture is in. You can change it until 5pm on Christmas Eve.";
const MOBILE_WORDS = "Please type a UK mobile number, like 07700 900 123.";

let calls: Call[] = [];
let answer: Answer = { status: 201, body: { ok: true, message: THANKS } };
/** Answers taken in turn, one a request, before `answer` is used again. */
let answers: Answer[] = [];
/** While set, every request waits for it to be called before it answers. */
let gate: Promise<void> | null = null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const status = () => $(".elf-entry .elf-form-status");
const button = () => $<HTMLButtonElement>('form.elf-entry button[type="submit"]');
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function load(view: EntryView = entryView(), opts: Record<string, unknown> = {}): void {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderEntryPage(view), "text/html").documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, json: typeof body === "string" ? JSON.parse(body) : null, type: headers["Content-Type"] ?? null, method: init?.method ?? null, credentials: init?.credentials ?? null });
    if (gate) await gate;
    const a = answers.length > 0 ? answers.shift()! : answer;
    if (a === "offline") throw new Error("offline");
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) };
  });
  initEntry(document, window, opts);
}

async function pick(file: File): Promise<void> {
  const input = $<HTMLInputElement>('form.elf-entry input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}

async function send(): Promise<Event> {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  $("form.elf-entry").dispatchEvent(event);
  await settle();
  return event;
}

async function jpegFile(): Promise<File> {
  return new File([new Uint8Array(await tinyJpeg())], "drawing.jpg", { type: "image/jpeg" });
}

afterEach(() => {
  answer = { status: 201, body: { ok: true, message: THANKS } };
  answers = [];
  gate = null;
});

describe("sending in a picture", () => {
  it("posts the picked picture as base64 with its mime to the form's address, without leaving the page", async () => {
    load();
    await pick(await jpegFile());
    const event = await send();
    expect(event.defaultPrevented).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/elf/entry/11");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].type).toBe("application/json");
    expect(calls[0].credentials).toBe("same-origin");
    expect(calls[0].json).toEqual({ mime: "image/jpeg", dataBase64: (await tinyJpeg()).toString("base64") });
  });

  it("sends the mobile number too when the page asks for one", async () => {
    load(entryView({ askMobile: true }));
    $<HTMLInputElement>('form.elf-entry input[name="mobile"]').value = "07700 900 123";
    await pick(await jpegFile());
    await send();
    expect(calls[0].json).toEqual({ mime: "image/jpeg", dataBase64: (await tinyJpeg()).toString("base64"), mobile: "07700 900 123" });
  });

  it("shows the thank you from a new entry in the status line", async () => {
    load();
    await pick(await jpegFile());
    await send();
    expect(words(status())).toBe(THANKS);
    expect(status().classList.contains("is-error")).toBe(false);
    expect(button().disabled).toBe(false);
  });

  it("shows the thank you for a picture sent in place of the one before", async () => {
    answer = { status: 200, body: { ok: true, message: THANKS } };
    load(entryView({ sent: { at: new Date("2026-12-24T10:45:00.000Z"), pictureUrl: "/elf/hq/entry/11/picture.jpg" } }));
    await pick(await jpegFile());
    await send();
    expect(words(status())).toBe(THANKS);
    expect(status().classList.contains("is-error")).toBe(false);
  });

  it("shows a refusal's error, marked as an error", async () => {
    answer = { status: 400, body: { error: MOBILE_WORDS, fields: { mobile: MOBILE_WORDS } } };
    load(entryView({ askMobile: true }));
    await pick(await jpegFile());
    await send();
    expect(words(status())).toBe(MOBILE_WORDS);
    expect(status().classList.contains("is-error")).toBe(true);
    expect(button().disabled).toBe(false);
  });

  it("takes the error mark off again once a picture goes in", async () => {
    answer = { status: 409, body: { error: "Something to fix." } };
    load();
    await pick(await jpegFile());
    await send();
    expect(status().classList.contains("is-error")).toBe(true);
    answer = { status: 201, body: { ok: true, message: THANKS } };
    await send();
    expect(words(status())).toBe(THANKS);
    expect(status().classList.contains("is-error")).toBe(false);
  });

  it("shows the sentence for the picture when the server names one", async () => {
    answer = { status: 413, body: { error: "Your picture needs another look", fields: { photo: "That picture is too big. Try a smaller one." } } };
    load();
    await pick(await jpegFile());
    await send();
    expect(words(status())).toBe("That picture is too big. Try a smaller one.");
    expect(status().classList.contains("is-error")).toBe(true);
  });

  it("keeps its button disabled while sending, and sends nothing more until the answer is back", async () => {
    let open: () => void = () => undefined;
    gate = new Promise((r) => (open = r));
    load();
    await pick(await jpegFile());
    await send();
    expect(button().disabled).toBe(true);
    await send();
    expect(calls.length).toBe(1);
    open();
    await settle();
    expect(button().disabled).toBe(false);
    expect(words(status())).toBe(THANKS);
  });

  it("asks for a picture before it sends anything", async () => {
    load();
    await send();
    expect(calls).toEqual([]);
    expect(words(status())).toBe("Choose a picture first.");
    expect(status().classList.contains("is-error")).toBe(true);
  });

  it("says it could not reach NBCC when there is no signal, and lets the family try again", async () => {
    answer = "offline";
    load();
    await pick(await jpegFile());
    await send();
    expect(words(status())).toBe("We could not reach NBCC. Check your signal and try again.");
    expect(status().classList.contains("is-error")).toBe(true);
    expect(button().disabled).toBe(false);
  });

  it("does nothing on a page with no form, once the entries have closed", async () => {
    expect(() => load(entryView({ open: false }))).not.toThrow();
    expect(calls).toEqual([]);
  });
});

// The final review's issue 1: a rush before the close fills the one picture maker, which answers 503 at once while too
// many pictures are waiting. The page keeps saying it is sending and sends the same picture again by itself, up to four
// more times, each 2 to 3 seconds after the busy answer, and only then shows the busy words: so a family that presses
// once just before the close still gets its picture in. The clock is faked here, so each wait is stepped through.
describe("while the picture maker is busy", () => {
  const BUSY_WORDS = "Lots of photos arriving just now. Please try again in a minute.";
  const BUSY: Answer = { status: 503, body: { error: BUSY_WORDS } };
  const IN: Answer = { status: 201, body: { ok: true, message: THANKS } };
  // The picture is made smaller by the browser, so nothing here waits on a file being read.
  const opts = {
    read: () => Promise.resolve({ src: "blob:x", width: 400, height: 300, img: {} }),
    make: () => Promise.resolve({ mime: "image/jpeg", base64: "c21hbGw=" }),
  };
  /** Runs every promise waiting to run; nothing here waits on the faked clock. */
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  const submit = () => $("form.elf-entry").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  /** Every sentence the status line has said, in turn. */
  let said: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The page, a picture picked and sent, and its first answer back. */
  async function sendOnce(): Promise<void> {
    load(entryView(), opts);
    said = [];
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) said.push(n.textContent ?? "");
    }).observe(status(), { childList: true });
    const input = $<HTMLInputElement>('form.elf-entry input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], "drawing.jpg", { type: "image/jpeg" })] });
    submit();
    await flush();
  }

  it("sends the same picture again 2 to 3 seconds after a busy answer, still sending, then shows the thank you and never the busy words", async () => {
    answers = [BUSY, IN];
    await sendOnce();
    expect(calls).toHaveLength(1);
    expect(words(status())).toBe("Sending your picture");
    expect(button().disabled).toBe(true);
    // A press while it waits sends nothing more.
    submit();
    await vi.advanceTimersByTimeAsync(1999);
    await flush();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1001);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(words(status())).toBe(THANKS);
    expect(status().classList.contains("is-error")).toBe(false);
    expect(button().disabled).toBe(false);
    expect(said).not.toContain(BUSY_WORDS);
    expect(said).toEqual(["Sending your picture", THANKS]);
  });

  it("shows the busy words only after a fifth busy answer, and then sends no more", async () => {
    answers = [BUSY, BUSY, BUSY, BUSY, BUSY];
    await sendOnce();
    for (let n = 2; n <= 4; n++) {
      await vi.advanceTimersByTimeAsync(3000);
      await flush();
      expect(calls, `send ${n}`).toHaveLength(n);
      expect(words(status()), `send ${n}`).toBe("Sending your picture");
      expect(button().disabled, `send ${n}`).toBe(true);
    }
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(calls).toHaveLength(5);
    expect(words(status())).toBe(BUSY_WORDS);
    expect(status().classList.contains("is-error")).toBe(true);
    expect(button().disabled).toBe(false);
    for (const c of calls) expect(c).toEqual(calls[0]);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(calls).toHaveLength(5);
  });

  it("shows any other answer as soon as it comes, and sends no more", async () => {
    answers = [BUSY, { status: 409, body: { error: "Grand prize entries closed at 5pm on Christmas Eve." } }];
    await sendOnce();
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(calls).toHaveLength(2);
    expect(words(status())).toBe("Grand prize entries closed at 5pm on Christmas Eve.");
    expect(status().classList.contains("is-error")).toBe(true);
    expect(button().disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(calls).toHaveLength(2);
  });

  it("says it could not reach NBCC when the signal goes after a busy answer, and sends no more", async () => {
    answers = [BUSY, "offline"];
    await sendOnce();
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(calls).toHaveLength(2);
    expect(words(status())).toBe("We could not reach NBCC. Check your signal and try again.");
    expect(button().disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(calls).toHaveLength(2);
  });
});

// Fix round 1 (the review's Minor 2): once a picture is in, the page shows it as the server draws it then, with no
// reload: the picture from its own address, fetched fresh, and the button that sends a new one. The thank you stays.
describe("once a picture is in", () => {
  const SENT = { at: new Date("2026-12-24T10:45:00.000Z"), pictureUrl: "/elf/hq/entry/11/picture.jpg" };
  const pictures = () => [...document.querySelectorAll<HTMLImageElement>("img.elf-entry__pic")];

  it("shows the new picture after a first send, from its own address fetched fresh, and offers a new one", async () => {
    load(entryView(), { now: () => 1111 });
    expect(pictures()).toEqual([]);
    await pick(await jpegFile());
    await send();
    const [img] = pictures();
    expect(pictures().length).toBe(1);
    expect(img.getAttribute("src")).toBe("/elf/hq/entry/11/picture.jpg?v=1111");
    expect(img.getAttribute("alt")).toBe("Detective Ruby Tinselfoot's picture");
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["800", "600"]);
    // Where the page draws a picture that is in: first in the note, under its tape.
    expect(img.parentElement!.classList.contains("elf-entry-note")).toBe(true);
    expect(img.previousElementSibling!.classList.contains("elf-tape")).toBe(true);
    expect(words(button())).toBe("Send a new picture");
    expect(words(status())).toBe(THANKS);
  });

  it("shows a picture sent in place of the one before, fetched fresh each time, and never a second picture", async () => {
    let t = 2000;
    answer = { status: 200, body: { ok: true, message: THANKS } };
    load(entryView({ sent: SENT }), { now: () => t });
    expect(pictures().map((p) => p.getAttribute("src"))).toEqual(["/elf/hq/entry/11/picture.jpg"]);
    await pick(await jpegFile());
    await send();
    expect(pictures().map((p) => p.getAttribute("src"))).toEqual(["/elf/hq/entry/11/picture.jpg?v=2000"]);
    t = 3000;
    await send();
    expect(pictures().map((p) => p.getAttribute("src"))).toEqual(["/elf/hq/entry/11/picture.jpg?v=3000"]);
    expect(words(button())).toBe("Send a new picture");
    expect(words(status())).toBe(THANKS);
  });

  it("leaves the page as it was when the picture is refused", async () => {
    answer = { status: 400, body: { error: MOBILE_WORDS, fields: { mobile: MOBILE_WORDS } } };
    load(entryView({ askMobile: true }));
    await pick(await jpegFile());
    await send();
    expect(pictures()).toEqual([]);
    expect(words(button())).toBe("Send it to the head elves");
  });

  it("offers a new picture in the page's own words for a picture that is in", async () => {
    const drawn = new DOMParser().parseFromString(renderEntryPage(entryView({ sent: SENT })), "text/html");
    load();
    await pick(await jpegFile());
    await send();
    expect(words(button())).toBe(words(drawn.querySelector('form.elf-entry button[type="submit"]')));
  });

  it("shows no picture from an address that is not on this site, whatever the form says", async () => {
    load();
    $("form.elf-entry").setAttribute("data-picture", "//elsewhere.example/p.jpg");
    await pick(await jpegFile());
    await send();
    expect(pictures()).toEqual([]);
    expect(words(status())).toBe(THANKS);
  });

  it("reads an address on this site by the page's own rule, character for character", () => {
    const shell = readFileSync(resolve(ROOT, "src/elf/pages/shell.ts"), "utf8");
    const script = readFileSync(resolve(ROOT, "assets/js/elf-entry.js"), "utf8");
    const rule = /typeof value === "string" && (\/\^.+?\$\/)\.test\(value\)/.exec(shell)?.[1];
    expect(rule).toBe("/^\\/(?!\\/)[A-Za-z0-9/_.~%?=&-]*$/");
    expect(script).toContain(`var SITE_PATH = ${rule};`);
  });
});

describe("making the picture smaller in the browser", () => {
  const BIG = () => new File([new Uint8Array([1, 2, 3])], "big.jpg", { type: "image/jpeg" });
  const read = () => Promise.resolve({ src: "blob:x", width: 4000, height: 3000, img: {} });

  it("sends the picture the browser made smaller when it can make one", async () => {
    const made: unknown[] = [];
    load(entryView(), {
      read,
      make: (pic: unknown) => {
        made.push(pic);
        return Promise.resolve({ mime: "image/jpeg", base64: "c21hbGw=" });
      },
    });
    await pick(BIG());
    await send();
    expect(made.length).toBe(1);
    expect(calls[0].json).toEqual({ mime: "image/jpeg", dataBase64: "c21hbGw=" });
  });

  it("tries a lower quality once when the redrawn picture is over 2 MB", async () => {
    const qualities: unknown[] = [];
    const big = "A".repeat(3 * 1024 * 1024);
    load(entryView(), {
      read,
      make: (_pic: unknown, quality?: number) => {
        qualities.push(quality);
        return Promise.resolve({ mime: "image/jpeg", base64: quality ? "c21hbGw=" : big });
      },
    });
    await pick(BIG());
    await send();
    expect(qualities).toEqual([undefined, 0.7]);
    expect(calls[0].json).toEqual({ mime: "image/jpeg", dataBase64: "c21hbGw=" });
  });

  it("says the picture is too big when even the lower quality is over 2 MB, and sends nothing", async () => {
    const big = "A".repeat(3 * 1024 * 1024);
    load(entryView(), { read, make: () => Promise.resolve({ mime: "image/jpeg", base64: big }) });
    await pick(BIG());
    await send();
    expect(calls).toEqual([]);
    expect(words(status())).toBe("That picture is too big. Try a smaller one.");
    expect(status().classList.contains("is-error")).toBe(true);
    expect(button().disabled).toBe(false);
  });

  it("gives the button back, saying something went wrong, when reading the picture fails outright", async () => {
    load(entryView(), { read: () => Promise.reject(new Error("the phone ran out of memory")) });
    await pick(BIG());
    await send();
    expect(calls).toEqual([]);
    expect(words(status())).toBe("Something went wrong. Refresh the page and try again.");
    expect(status().classList.contains("is-error")).toBe(true);
    expect(button().disabled).toBe(false);
  });

  it("refuses a file that is not a picture it can use when the browser cannot draw it, and sends nothing", async () => {
    load();
    await pick(new File([new Uint8Array([60, 115, 118, 103])], "drawing.svg", { type: "image/svg+xml" }));
    await send();
    expect(calls).toEqual([]);
    expect(words(status())).toBe("That picture is not one we can use. Try a JPG, PNG or WebP photo.");
  });

  // Ruling F14: the four picture helpers are copied from the photo sheet's script, as it copied them from the
  // fundraisers' (assets/js/elf-poster.js), with a line saying so, and they keep its limits exactly.
  it("copies its picture helpers from the photo sheet's script word for word, with its limits", () => {
    const entry = readFileSync(resolve(ROOT, "assets/js/elf-entry.js"), "utf8").replace(/\r\n/g, "\n");
    const poster = readFileSync(resolve(ROOT, "assets/js/elf-poster.js"), "utf8").replace(/\r\n/g, "\n");
    expect(entry).toContain("Copied from assets/js/elf-poster.js (browserRead, browserMake, base64Bytes and rawBase64), keeping its limits.");
    const fn = (source: string, name: string) => {
      const start = source.indexOf(`  function ${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf("\n  }\n", start) + 4);
    };
    for (const name of ["browserRead", "browserMake", "base64Bytes", "rawBase64"]) expect(fn(entry, name), name).toBe(fn(poster, name));
    for (const limit of ["var MAX_BYTES = 2 * 1024 * 1024;", "var MAX_PX = 1600;", "var QUALITY = 0.86;", "var LOWER_QUALITY = 0.7;", 'var TYPES = ["image/jpeg", "image/png", "image/webp"];']) {
      expect(poster, limit).toContain(limit);
      expect(entry, limit).toContain(limit);
    }
  });
});
