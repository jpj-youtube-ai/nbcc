// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderCalendarPage } from "../../src/elf/pages/calendar";
import { renderJoinPage } from "../../src/elf/pages/join";
import { FESTIVE_SURNAMES } from "../../src/elf/names";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { calendarViewFor } from "../../src/elf/views";

// NBCC Elf Detective School: the look of nbcc.scot/bag and /fill, brought to the school's screens
// (wave 1 plan, Task 11): gold sparkles, the red present with the school's elf peeking out, gift
// tags, taped paper. All motion plays only for someone who has not asked for less.

const SETTINGS = { ...ELF_DEFAULTS, schoolOn: true };
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");

/** The stylesheet with every "prefers-reduced-motion: no-preference" block taken out. */
function outsideMotionBlocks(source: string): string {
  let out = "";
  let i = 0;
  const marker = /@media[^{]*prefers-reduced-motion:\s*no-preference[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(source))) {
    out += source.slice(i, m.index);
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < source.length && depth > 0) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") depth--;
      j++;
    }
    i = j;
    marker.lastIndex = j;
  }
  return out + source.slice(i);
}

describe("the calendar's top", () => {
  it("has gold sparkles round the school's name, hidden from screen readers", () => {
    const doc = parse(renderCalendarPage(calendarViewFor({ settings: SETTINGS, now: new Date("2026-11-13T09:00:00.000Z") })));
    const sparkles = doc.querySelectorAll(".elf-top .elf-twk");
    expect(sparkles.length).toBeGreaterThanOrEqual(4);
    for (const s of sparkles) expect(s.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the enrol page's top", () => {
  it("shows the red present with the school's elf peeking out, a Top secret tag and the 24 prizes seal", () => {
    const doc = parse(renderJoinPage({ settings: SETTINGS, captchaSiteKey: null, surnames: FESTIVE_SURNAMES }));
    const gift = doc.querySelector(".page-top .elf-gift")!;
    expect(gift).not.toBeNull();
    const art = gift.querySelector("svg")!;
    expect(art.getAttribute("role")).toBe("img");
    expect(art.getAttribute("aria-label")).toMatch(/elf peeking out of a red present/i);
    expect(gift.querySelector("image")!.getAttribute("href")).toBe("/assets/img/elf-detective-school.webp");
    expect(gift.textContent).toContain("Top secret!");
    expect(gift.textContent).toContain("24");
  });
});

describe("the stylesheet", () => {
  it("plays every animation only for someone who has not asked for less motion", () => {
    expect(outsideMotionBlocks(css)).not.toMatch(/\banimation(-name)?\s*:/);
  });

  it("has the new look's moving parts, inside those blocks", () => {
    for (const name of ["elf-twinkle", "elf-drop", "elf-peek", "elf-swing-in", "elf-shimmer"]) expect(css).toContain(`@keyframes ${name}`);
  });

  it("gives the enrol form the taped, ruled paper of /fill", () => {
    expect(css).toMatch(/\.elf-join-form\s*\{[^}]*background/);
    expect(css).toMatch(/\.elf-join-tape\s*\{/);
  });
});
