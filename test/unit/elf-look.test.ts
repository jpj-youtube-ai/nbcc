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

// The paper look (Jaimie, 4 November 2026) took over the calendar's top: the drifting paper stars
// behind every page replace the gold sparkles, and a torn label sits under the school's name.
describe("the calendar's top", () => {
  it("is paper: the school's name with a torn label under it, and no gold sparkles", () => {
    const doc = parse(renderCalendarPage(calendarViewFor({ settings: SETTINGS, now: new Date("2026-11-13T09:00:00.000Z") })));
    expect(doc.querySelectorAll(".elf-top .elf-twk").length).toBe(0);
    expect(doc.querySelector(".elf-top h1 + .elf-label")).not.toBeNull();
    expect(doc.querySelectorAll(".elf-sky i").length).toBeGreaterThanOrEqual(10);
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

describe("the elf in the present (Jaimie, 3 November: the line under the elf showed above the box)", () => {
  const doc = parse(renderJoinPage({ settings: SETTINGS, captchaSiteKey: null, surnames: FESTIVE_SURNAMES }));

  it("keeps the elf inside a box edge that does not move with it, so it never rises clear of the box", () => {
    const peek = doc.querySelector(".elf-gift__peek")!;
    const edge = peek.parentElement!;
    expect(edge.tagName.toLowerCase()).toBe("g");
    expect(edge.getAttribute("clip-path")).toBe("url(#elfGiftEdge)");
    expect(doc.querySelector("#elfGiftEdge rect")!.getAttribute("height")).toBe("180");
    expect(doc.querySelector("#elfGiftEdge rect")!.getAttribute("y")).toBe("-60");
  });

  it("cuts the logo above the line under the elf's hands", () => {
    // The logo's line sits at 59 to 60% of its height: 10 + 0.59 x 180 = 116.2 in the drawing.
    const cut = doc.querySelector("#elfGiftClip rect")!;
    expect(Number(cut.getAttribute("y")) + Number(cut.getAttribute("height"))).toBeLessThanOrEqual(115);
  });

  it("only lets the elf rise a little, so its cut edge stays down inside the box", () => {
    const rise = /@keyframes elf-peek\s*\{[^}]*translateY\((-?\d+)px\)[^}]*\}\s*30%, 70%\s*\{\s*transform:\s*translateY\((-?\d+)px\)/.exec(css);
    expect(rise).not.toBeNull();
    expect(Number(rise![2])).toBeGreaterThanOrEqual(-7);
  });
});
