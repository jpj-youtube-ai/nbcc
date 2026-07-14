// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-023 (REQ-035); 4-band rework TASK-223: supporters.html's tiered supporters list. Four tier
// groups (Bronze, Silver, Gold, Platinum, in that order) sit in the page-sections slot below the
// intro; entries are alphabetical within each tier, and each entry is marked as a person or an
// organisation (data-type + a visible kind label + a decorative aria-hidden icon, no <img>). At
// runtime GET /supporters replaces this block with the real opted-in monthly supporters; these static
// entries are the fallback, and this test guards their structure. Parsed with jsdom, mirroring
// home-pillars.test.ts / footer.test.ts. DB-free.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "supporters.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const TIERS = ["Bronze", "Silver", "Gold", "Platinum"];

describe("supporters tiers (REQ-035)", () => {
  const tiers = [...doc.querySelectorAll("main .supporter-tier")];
  const tierName = (t: Element) => norm(t.querySelector(".supporter-tier-name")?.textContent);
  const namesIn = (t: Element) =>
    [...t.querySelectorAll(".supporter .supporter-name")].map((n) => norm(n.textContent));

  it("renders exactly four tier groups", () => {
    expect(tiers).toHaveLength(4);
  });

  it("labels the tiers Bronze, Silver, Gold, Platinum in that order", () => {
    expect(tiers.map(tierName)).toEqual(TIERS);
  });

  it("lists each tier's supporters in alphabetical order", () => {
    for (const tier of tiers) {
      const names = namesIn(tier);
      expect(names.length, `tier ${tierName(tier)} has no supporters`).toBeGreaterThan(0);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names, `tier ${tierName(tier)} is not alphabetical`).toEqual(sorted);
    }
  });

  it("marks every supporter as a person or an organisation", () => {
    const supporters = [...doc.querySelectorAll("main .supporter")];
    expect(supporters.length).toBeGreaterThan(0);
    for (const s of supporters) {
      expect(["person", "organisation"], `bad data-type on "${norm(s.textContent)}"`).toContain(
        s.getAttribute("data-type"),
      );
    }
  });

  it("renders at least one person and one organisation entry", () => {
    expect(doc.querySelectorAll('main .supporter[data-type="person"]').length).toBeGreaterThan(0);
    expect(
      doc.querySelectorAll('main .supporter[data-type="organisation"]').length,
    ).toBeGreaterThan(0);
  });

  it("uses decorative aria-hidden inline-SVG icons and no <img> in the list", () => {
    expect(doc.querySelectorAll("main .supporter-tier img")).toHaveLength(0);
    const supporters = [...doc.querySelectorAll("main .supporter")];
    const icons = [...doc.querySelectorAll("main .supporter .supporter-icon")];
    expect(icons).toHaveLength(supporters.length);
    for (const icon of icons) {
      expect(icon.tagName.toLowerCase()).toBe("svg");
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("keeps the intro (eyebrow + h1 + rule + lede) above the tiers", () => {
    const intro = doc.querySelector("main .supporters-intro");
    expect(intro).not.toBeNull();
    expect(norm(intro?.querySelector(".eyebrow")?.textContent)).toBe("Supporters");
    expect(norm(intro?.querySelector("h1")?.textContent).length).toBeGreaterThan(0);
    expect(intro?.querySelector(".rule")).not.toBeNull();
    expect(norm(intro?.querySelector(".lede")?.textContent).length).toBeGreaterThan(0);
  });
});
