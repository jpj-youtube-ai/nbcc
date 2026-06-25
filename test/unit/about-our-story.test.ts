// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-021 (REQ-015): about.html's "our story" section — founding quote +
// Tygan/2015 attribution, the origin narrative, a captioned headshot placeholder,
// and a content-verification flag comment. Parsed with jsdom; mirrors
// about-intro.test.ts. The intro/rule/page-sections/closing-cta stay intact.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "about.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("about our story (REQ-015)", () => {
  const story = doc.querySelector("section.our-story");

  it("renders the story section, named by its heading", () => {
    expect(story).not.toBeNull();
    expect(story?.getAttribute("aria-labelledby")).toBe(story?.querySelector("h2")?.id);
  });

  it("shows the founding quote and the Tygan / 2015 attribution", () => {
    expect(norm(story?.querySelector(".quote")?.textContent)).toContain(
      "Do all children get a Christmas Eve box like I do?",
    );
    const by = norm(story?.querySelector(".by")?.textContent);
    expect(by).toContain("Tygan");
    expect(by).toContain("2015");
  });

  it("tells the origin narrative across multiple paragraphs", () => {
    const paras = [...(story?.querySelectorAll(".story-prose p:not(.quote):not(.by)") ?? [])];
    expect(paras.length).toBeGreaterThanOrEqual(2);
    const prose = norm(story?.querySelector(".story-prose")?.textContent);
    expect(prose).toContain("became the Night Before Christmas Campaign");
    expect(prose).toContain("first year they delivered 90 boxes");
  });

  it("has a captioned headshot placeholder with a decorative icon, no <img>", () => {
    const fig = story?.querySelector("figure.photo-slot");
    expect(fig).not.toBeNull();
    expect(norm(fig?.querySelector("figcaption")?.textContent).length).toBeGreaterThan(0);
    expect(fig?.querySelector("img")).toBeNull();
    expect(fig?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("flags the carried copy for content verification", () => {
    expect(html).toMatch(/content verification/i);
  });

  it("leaves the intro, its rule, page-sections and the closing CTA intact", () => {
    expect(doc.querySelector("main .about-intro")).not.toBeNull();
    expect(doc.querySelector("main .about-intro .rule")).not.toBeNull();
    expect(doc.querySelector('main .page-sections[data-region="sections"]')).not.toBeNull();
    expect(doc.querySelector("main .closing-cta")).not.toBeNull();
  });
});
