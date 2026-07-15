import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

// TASK-211: the static supporter badge asset. The SAME emblem for every supporter, delivered as a
// standalone SVG a business can drop onto their website. These tests assert the committed file exists,
// is well-formed SVG (parses cleanly, real <svg> root), reproduces the approved Option B copy, and
// carries no dashes in any human-readable text (task constraint — the minus signs in the logo path
// coordinates are numbers, not copy). Regenerate the asset with: node scripts/build-supporter-badge.mjs

const BADGE_PATH = resolve(__dirname, "../../assets/img/nbcc-supporter-badge.svg");
const svg = readFileSync(BADGE_PATH, "utf8");

describe("assets/img/nbcc-supporter-badge.svg (TASK-211)", () => {
  it("exists and parses as a well-formed SVG", () => {
    expect(svg.length).toBeGreaterThan(0);
    const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
    // Malformed XML yields a <parsererror> element rather than an <svg> root.
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.tagName.toLowerCase()).toBe("svg");
    expect(doc.documentElement.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
  });

  it("reproduces the approved Option B copy and inlines the logo mark", () => {
    const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
    const text = [...doc.querySelectorAll("text")].map((n) => n.textContent).join(" | ");
    expect(text).toContain("We proudly support");
    expect(text).toContain("Night Before Christmas");
    expect(text).toContain("Campaign");
    // The NBCC logo mark is nested inline (its <defs>/<use> vector paths), not an external <image>.
    expect(doc.querySelectorAll("use").length).toBeGreaterThan(0);
    expect(doc.querySelector("image")).toBeNull();
  });

  it("has no dashes in any human-readable text", () => {
    const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
    const copy = [...doc.querySelectorAll("text, title, desc")]
      .map((n) => n.textContent ?? "")
      .join(" ");
    expect(copy).not.toMatch(/[-‐‑‒–—]/);
  });
});
