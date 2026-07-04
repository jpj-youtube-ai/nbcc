// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-016 (REQ-010): index.html's Home hero — eyebrow, emphasised H1, two CTAs,
// the logo illustration and the floating proof card. Parsed with jsdom; mirrors
// footer.test.ts / seo-metadata.test.ts. DB-free.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("home hero (REQ-010)", () => {
  it("shows the eyebrow naming the volunteer-run Scottish charity", () => {
    const eyebrow = doc.querySelector("main .eyebrow");
    expect(norm(eyebrow?.textContent)).toContain("Volunteer run Scottish charity");
  });

  it("has an emotive H1 with a dedicated emphasised element", () => {
    const h1 = doc.querySelector("main h1");
    // Redesign headline: "You know us at Christmas. We're here all year."
    expect(norm(h1?.textContent)).toContain("all year");
    const emph = h1?.querySelector("em.hero-emph, .hero-emph, em, .allyear");
    expect(norm(emph?.textContent).length).toBeGreaterThan(0);
  });

  it("has the Donate now primary CTA linking to /donate", () => {
    const primary = doc.querySelector("a.btn.btn-primary");
    expect(primary?.getAttribute("href")).toBe("/donate");
    expect(norm(primary?.textContent)).toContain("Donate now");
  });

  it("has a secondary ghost CTA to the about page", () => {
    const ghost = doc.querySelector("a.btn.btn-ghost");
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute("href")).toBe("/about-us");
    expect(norm(ghost?.textContent).length).toBeGreaterThan(0);
  });

  it("uses the logo lockup as the hero illustration with alt + dimensions", () => {
    const img = doc.querySelector(".hero-art img");
    expect(img?.getAttribute("src")).toMatch(/nbcc-logo\.png/);
    expect((img?.getAttribute("alt") ?? "").trim().length).toBeGreaterThan(0);
    expect(img?.getAttribute("width")).toBeTruthy();
    expect(img?.getAttribute("height")).toBeTruthy();
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("has the floating proof card on the shared .card surface with the 2025 figure", () => {
    const proof = doc.querySelector(".proof");
    expect(proof?.classList.contains("card")).toBe(true);
    expect(norm(proof?.textContent)).toBe("7,657 Red Bags Full of Joy delivered in 2025");
  });

  it("keeps the page-sections region for later content", () => {
    expect(doc.querySelector('main .page-sections[data-region="footer"]')).toBeNull();
    expect(doc.querySelector('main .page-sections[data-region="sections"]')).not.toBeNull();
  });
});
