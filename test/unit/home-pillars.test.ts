// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-017 (REQ-011): index.html's four-pillars tinted band — exactly four
// pillar cards with the exact leaflet titles + one-line copy, decorative
// aria-hidden inline-SVG icons, no <img>. Parsed with jsdom; mirrors
// home-hero.test.ts. DB-free.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const PILLARS: Array<[string, string]> = [
  ["Volunteer run", "Powered by kindness, driven by community"],
  [
    "South West Scotland",
    "Supporting children, young people and vulnerable adults from Girvan to Largs",
  ],
  ["Red Bags Full of Joy", "Thoughtful gifts. Dignity. Comfort. Moments of joy."],
  [
    "7,657 delivered in 2025",
    "Real impact. Real children, young people and vulnerable adults. Real difference.",
  ],
];

describe("home pillars (REQ-011)", () => {
  const pillars = [...doc.querySelectorAll(".pillars .pillar")];

  it("renders exactly four pillars", () => {
    expect(pillars).toHaveLength(4);
  });

  it("has the exact pillar titles", () => {
    const titles = pillars.map((p) => norm(p.querySelector(".pillar-title")?.textContent));
    expect(titles).toEqual(PILLARS.map(([t]) => t));
  });

  it("has the exact one-line copy", () => {
    const lines = pillars.map((p) => norm(p.querySelector(".pillar-line")?.textContent));
    expect(lines).toEqual(PILLARS.map(([, l]) => l));
  });

  it("uses decorative aria-hidden inline-SVG icons, no <img>", () => {
    expect(doc.querySelectorAll(".pillars img")).toHaveLength(0);
    const icons = [...doc.querySelectorAll(".pillar .pillar-icon")];
    expect(icons).toHaveLength(4);
    for (const icon of icons) {
      expect(icon.tagName.toLowerCase()).toBe("svg");
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
