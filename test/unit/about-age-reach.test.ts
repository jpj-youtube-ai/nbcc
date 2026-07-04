// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-025 (REQ-017): about.html's 2025 "age-reach" figures — a maroon band
// presenting eight age-band counts as a semantic <dl> that total exactly 7,657.
// Cream-on-maroon tints only (no tan/holly body text), numbers in Playfair, no
// <img>. Parsed with jsdom; mirrors about-team.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "about.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// The eight bands, in order, exactly as REQ-017 specifies — ranges written with
// "to"/"18+"/words per the no-dash copy rule (REQ-031).
const BANDS: Array<[string, number]> = [
  ["0 to 12 months", 182],
  ["1 to 3 years", 762],
  ["4 to 7 years", 1663],
  ["8 to 11 years", 1990],
  ["12 to 15 years", 1719],
  ["16 to 17 years", 587],
  ["18+", 528],
  ["Unknown", 226],
];

describe("about age-reach figures (REQ-017)", () => {
  const section = doc.querySelector("section.age-reach");
  const group = section?.querySelector(".chart") ?? null;
  const entries = [...(group?.querySelectorAll(".crow") ?? [])];

  it("renders the age-reach section, named by its heading", () => {
    expect(section).not.toBeNull();
    expect(section?.getAttribute("aria-labelledby")).toBe(section?.querySelector("h2")?.id);
  });

  it("groups the figures in a single chart of label and number rows", () => {
    expect(group).not.toBeNull();
    expect(entries.length).toBeGreaterThan(0);
  });

  it("renders exactly eight age-band entries", () => {
    expect(entries).toHaveLength(8);
  });

  it("each entry pairs a label with a number, no <img>", () => {
    for (const e of entries) {
      expect(e.querySelector(".name")).not.toBeNull();
      expect(e.querySelector(".val")).not.toBeNull();
      expect(norm(e.querySelector(".name")?.textContent).length).toBeGreaterThan(0);
      expect(e.querySelector("img")).toBeNull();
    }
  });

  it("renders the eight REQ-017 labels and counts in order", () => {
    const labels = entries.map((e) => norm(e.querySelector(".name")?.textContent));
    const nums = entries.map((e) => norm(e.querySelector(".val")?.textContent));
    expect(labels).toEqual(BANDS.map(([label]) => label));
    expect(nums).toEqual(BANDS.map(([, n]) => n.toLocaleString("en-US")));
  });

  it("the eight numbers parse and sum to exactly 7,657", () => {
    const total = entries
      .map((e) => Number(norm(e.querySelector(".val")?.textContent).replace(/,/g, "")))
      .reduce((sum, n) => sum + n, 0);
    expect(total).toBe(7657);
  });

  it("writes the visible copy without dashes (REQ-031)", () => {
    expect(norm(section?.textContent)).not.toMatch(/[–—-]/);
  });

  it("declares a maroon band with cream text (REQ-017/REQ-005)", () => {
    expect(css).toMatch(/\.band\s*\{[^}]*background:\s*var\(--maroon\)/);
    expect(css).toMatch(/\.band\s*\{[^}]*color:\s*var\(--cream\)/);
  });

  it("leaves the intro, story, team, page-sections and closing CTA intact", () => {
    expect(doc.querySelector("main .about-intro")).not.toBeNull();
    expect(doc.querySelector("main .our-story")).not.toBeNull();
    expect(doc.querySelector("main .meet-team")).not.toBeNull();
    expect(doc.querySelector('main .page-sections[data-region="sections"]')).not.toBeNull();
    expect(doc.querySelector("main .closing-cta")).not.toBeNull();
  });
});
