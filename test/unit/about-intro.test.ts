// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-020 (REQ-014): about.html's intro — eyebrow "About us", the brand H1 with
// the .rule under it, and a lede placing NBCC in Annbank/Ayrshire with the Girvan
// to Largs reach. Parsed with jsdom; mirrors home-hero.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "about.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("about intro (REQ-014)", () => {
  const intro = doc.querySelector("section.about-intro");

  it("renders the intro section", () => {
    expect(intro).not.toBeNull();
  });

  it("has the eyebrow 'About us'", () => {
    expect(norm(intro?.querySelector(".eyebrow")?.textContent)).toBe("About us");
  });

  it("has the exact H1", () => {
    expect(norm(intro?.querySelector("h1")?.textContent)).toBe(
      "Powered by kindness, driven by community",
    );
  });

  it("places the .rule divider immediately after the heading (REQ-007)", () => {
    const h1 = intro?.querySelector("h1");
    expect(h1?.nextElementSibling?.classList.contains("rule")).toBe(true);
  });

  it("has a lede placing NBCC in Annbank/Ayrshire with the Girvan to Largs reach", () => {
    const lede = norm(intro?.querySelector(".lede")?.textContent);
    expect(lede).toContain("Annbank");
    expect(lede).toContain("Ayrshire");
    expect(lede).toContain("Girvan to Largs");
  });

  it("drops the placeholder copy but keeps page-sections and the closing CTA", () => {
    expect(norm(doc.querySelector("main")?.textContent)).not.toContain("placeholder About page");
    expect(doc.querySelector('main .page-sections[data-region="sections"]')).not.toBeNull();
    expect(doc.querySelector("main .closing-cta")).not.toBeNull();
  });
});
