// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { renderCalendarPage } from "../../src/elf/pages/calendar";
import { ELF_FILM_NAME } from "../../src/elf/pages/film";
import { AFTERNOON, calendarView } from "./elf-fixtures";

// NBCC Elf Detective School's promotional film on its front page (TASK-616). Jaimie, 11 November
// 2026: "make it autoplay when they arrive". It plays by itself, muted, once; a clear button turns the
// sound on; people who asked for less motion or to save data see the poster instead (the script, in
// elf-film-js.test.ts). With Elf Detective School switched off, /elf is still a 404 (elf-preview.test.ts).
// Every business and detective here is invented (see elf-fixtures.ts).

const ROOT = resolve(__dirname, "../..");
const FILM = "assets/video/elf-detective-school.mp4";
const POSTER = "assets/video/elf-detective-school-poster.jpg";
const page = (doorsOn: boolean) =>
  new DOMParser().parseFromString(renderCalendarPage(calendarView(AFTERNOON, {}, { doorsOn })), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe.each([
  ["with December's doors on", true],
  ["with December's doors off", false],
])("the film on the front page, %s", (_name, doorsOn) => {
  const doc = page(doorsOn);
  const video = doc.querySelector("video") as HTMLVideoElement;

  it("is one film, in the page's top section, after the opening words and before the calendar", () => {
    expect(doc.querySelectorAll("video")).toHaveLength(1);
    expect(video.closest(".elf-top")).not.toBeNull();
    expect(follows(doc.querySelector(".elf-top .lede")!, video)).toBe(true);
    expect(follows(video, doc.querySelector(".elf-calendar")!)).toBe(true);
  });

  it("is set to play without sound, once, with the controls and the poster, and is started by the script", () => {
    // The script starts it (elf-film.js), so a browser never starts it for someone who asked for
    // less motion or data saving.
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(video.hasAttribute("muted")).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("loop")).toBe(false);
    // Only the start of the file (its index) is asked for until the film plays.
    expect(video.getAttribute("preload")).toBe("metadata");
    expect(video.getAttribute("poster")).toBe("/assets/video/elf-detective-school-poster.jpg");
    expect(video.querySelector("source")?.getAttribute("src")).toBe("/assets/video/elf-detective-school.mp4");
    expect(video.querySelector("source")?.getAttribute("type")).toBe("video/mp4");
  });

  it("holds its space before it loads (its size is on it)", () => {
    expect(video.getAttribute("width")).toBe("1920");
    expect(video.getAttribute("height")).toBe("1080");
  });

  it("has a name a screen reader can say, in plain words with the school's full name", () => {
    expect(ELF_FILM_NAME).toBe("Elf Detective School, a short film");
    expect(video.getAttribute("aria-label")).toBe(ELF_FILM_NAME);
  });

  it("has a sound button, hidden until the script shows it, in the paper look", () => {
    const button = doc.querySelector("[data-elf-film-sound]") as HTMLButtonElement;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.hasAttribute("hidden")).toBe(true);
    expect(button.classList.contains("elf-btn")).toBe(true);
    expect(words(button)).toBe("Turn the sound on");
  });

  it("is a photo taped to the page, on the paper frame", () => {
    const frame = video.closest(".elf-frame")!;
    expect(frame).not.toBeNull();
    expect(frame.querySelector(".elf-tape")).not.toBeNull();
  });

  it("uses no dashes in what it says", () => {
    const film = video.closest(".elf-film")!;
    const said = [words(film), video.getAttribute("aria-label")!].join(" ");
    expect(said).not.toMatch(/[‒-―−]|--| - /);
  });

  it("loads its script", () => {
    expect([...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"))).toContain("/assets/js/elf-film.js");
  });
});

describe("the film's files", () => {
  it("are in the repo: the film, and its poster at 1280 by 720", () => {
    expect(existsSync(resolve(ROOT, FILM))).toBe(true);
    expect(statSync(resolve(ROOT, FILM)).size).toBeGreaterThan(1024 * 1024);
    const jpg = readFileSync(resolve(ROOT, POSTER));
    expect(jpg.subarray(0, 2).toString("hex")).toBe("ffd8");
    // The size is in the frame header (SOF0 or SOF2): marker, length, precision, height, width.
    let pos = 2;
    while (pos < jpg.length && !(jpg[pos] === 0xff && (jpg[pos + 1] === 0xc0 || jpg[pos + 1] === 0xc2))) pos += 2 + jpg.readUInt16BE(pos + 2);
    expect({ height: jpg.readUInt16BE(pos + 5), width: jpg.readUInt16BE(pos + 7) }).toEqual({ height: 720, width: 1280 });
    expect(jpg.length).toBeLessThan(250 * 1024);
  });

  it("start playing before they have all arrived (the film's index is at the front)", () => {
    const file = readFileSync(resolve(ROOT, FILM));
    const order: string[] = [];
    for (let pos = 0; pos + 8 <= file.length; ) {
      let size = file.readUInt32BE(pos);
      order.push(file.toString("latin1", pos + 4, pos + 8));
      if (size === 1) size = Number(file.readBigUInt64BE(pos + 8));
      if (size < 8) break;
      pos += size;
    }
    expect(order.indexOf("moov")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("moov")).toBeLessThan(order.indexOf("mdat"));
  });
});

describe("the paper look", () => {
  const css = readFileSync(resolve(ROOT, "assets/css/elf.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("keeps the film 16 to 9 and never wider than its column, so nothing jumps or scrolls sideways", () => {
    expect(css).toMatch(/\.elf-film__video \{[^}]*aspect-ratio:\s*16 \/ 9/);
    expect(css).toMatch(/\.elf-film__video \{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.elf-film__video \{[^}]*height:\s*auto/);
    expect(css).toMatch(/\.elf-film \{[^}]*min-width:\s*0/);
  });
});
