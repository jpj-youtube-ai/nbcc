// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-026 (REQ-018): about.html's 2025 "top-10 communities" band — a ranked
// horizontal-bar list of the ten communities NBCC reached most, rendered as a
// semantic ordered list. Each bar's width is proportional to Ayr at 100% (Ayr
// full width), set via the --w custom property; bars are pure CSS (no <img>) so
// the perf budget holds. Token-only colours, numbers in Playfair. Parsed with
// jsdom; mirrors about-age-reach.test.ts. A geographic map is out of scope.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "about.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// Ayr is the reference: its bar is full width (100%). Every other bar's width is
// that community's count as a percentage of Ayr's count.
const AYR_COUNT = 2096;

// The ten communities, in rank order, exactly as REQ-018 specifies: name, the
// 2025 count, and that community's share-of-total percentage.
const COMMUNITIES: Array<[string, number, string]> = [
  ["Ayr", 2096, "27.4%"],
  ["Kilwinning", 692, "9.0%"],
  ["Stevenston", 547, "7.1%"],
  ["Kilmarnock", 532, "6.9%"],
  ["Auchinleck", 510, "6.7%"],
  ["Maybole", 370, "4.8%"],
  ["Dalmellington", 332, "4.3%"],
  ["Ardrossan", 301, "3.9%"],
  ["Irvine", 280, "3.7%"],
  ["Girvan", 205, "2.7%"],
];

// Pull the numeric --w percentage off a row's fill element's inline style.
const barWidth = (entry: Element): number => {
  const style = entry.querySelector(".fill")?.getAttribute("style") ?? "";
  const m = /width:\s*([\d.]+)%/.exec(style);
  return m ? Number(m[1]) : NaN;
};

describe("about top-10 communities (REQ-018)", () => {
  const section = doc.querySelector("section.top-communities");
  const list = section?.querySelector(".chart") ?? null;
  const entries = [...(list?.querySelectorAll(".crow") ?? [])];

  it("renders the top-communities section, named by its heading", () => {
    expect(section).not.toBeNull();
    expect(section?.getAttribute("aria-labelledby")).toBe(section?.querySelector("h2")?.id);
  });

  it("ranks the communities in a single chart of ranked rows", () => {
    expect(list).not.toBeNull();
    expect(entries.length).toBeGreaterThan(0);
  });

  it("renders exactly ten community entries", () => {
    expect(entries).toHaveLength(10);
  });

  it("each entry pairs a name with a CSS bar and a count, no <img>", () => {
    for (const e of entries) {
      expect(e.querySelector(".name")).not.toBeNull();
      expect(e.querySelector(".bar .fill")).not.toBeNull();
      expect(e.querySelector(".val")).not.toBeNull();
      expect(norm(e.querySelector(".name")?.textContent).length).toBeGreaterThan(0);
      expect(e.querySelector("img")).toBeNull();
    }
  });

  it("renders the ten REQ-018 names and counts in rank order", () => {
    const names = entries.map((e) => norm(e.querySelector(".name")?.textContent));
    const vals = entries.map((e) => norm(e.querySelector(".val")?.textContent));
    expect(names).toEqual(COMMUNITIES.map(([name]) => name));
    COMMUNITIES.forEach(([, n], i) => {
      expect(vals[i]).toContain(n.toLocaleString("en-US"));
    });
  });

  it("shows each community's share-of-total percentage", () => {
    const vals = entries.map((e) => norm(e.querySelector(".val")?.textContent));
    for (const [i, [, , pct]] of COMMUNITIES.entries()) {
      expect(vals[i]).toContain(pct);
    }
  });

  it("sizes each bar proportional to Ayr at full width (100%)", () => {
    const widths = entries.map(barWidth);
    // Ayr leads at exactly full width.
    expect(widths[0]).toBe(100);
    // Every bar is that count as a percentage of Ayr's count.
    COMMUNITIES.forEach(([, count], i) => {
      expect(Math.abs(widths[i] - (count / AYR_COUNT) * 100)).toBeLessThan(0.1);
    });
    // Ranked: widths never increase as rank descends.
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]);
    }
  });

  it("writes the visible copy without dashes (REQ-031)", () => {
    expect(norm(section?.textContent)).not.toMatch(/[–—-]/);
  });

  it("declares Playfair rank numbers and brand-token bars (REQ-018/REQ-005)", () => {
    expect(css).toMatch(/\.crow\s+\.pos\s*\{[^}]*font-family:\s*var\(--font-head\)/);
    expect(css).toMatch(/\.crow\s+\.fill\s*\{[^}]*var\(--crimson\)/);
  });

  it("leaves the intro, story, team, age-reach, page-sections and closing CTA intact", () => {
    expect(doc.querySelector("main .about-intro")).not.toBeNull();
    expect(doc.querySelector("main .our-story")).not.toBeNull();
    expect(doc.querySelector("main .meet-team")).not.toBeNull();
    expect(doc.querySelector("main .age-reach")).not.toBeNull();
    expect(doc.querySelector('main .page-sections[data-region="sections"]')).not.toBeNull();
    expect(doc.querySelector("main .closing-cta")).not.toBeNull();
  });
});
