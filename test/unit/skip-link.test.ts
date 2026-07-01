// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-043 (REQ-032): the accessibility floor's skip link + landmark set. On every
// page a visually-hidden-until-focus "Skip to content" link is the FIRST focusable
// element in the <body> and targets a focusable <main id="main"> (tabindex="-1", so
// activating the link actually moves focus into main). Each page carries the full
// semantic landmark set (header/nav/main/section/footer) and every content <section>
// is named (aria-labelledby -> heading id, or aria-label). The empty/programmatic
// page-sections wrapper ([data-region]) is intentionally not a landmark and is exempt.
// Parsed with jsdom, mirroring home-hero.test.ts / nav.test.ts. DB-free.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const docOf = (html: string) => new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const CSS = read("assets/css/styles.css");

const PAGES = ["index.html", "about.html", "donate.html", "contact.html"] as const;

// What the browser will move to on the first Tab press: anything tabbable, in DOM
// order. tabindex="-1" is programmatically focusable but NOT in the tab order, so
// <main id="main" tabindex="-1"> is excluded and the skip link must come out first.
const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

describe.each(PAGES)("%s accessibility floor (REQ-032)", (file) => {
  const doc = docOf(read(file));

  it("makes a visible 'Skip to content' link the first tabbable element in the body", () => {
    const first = doc.body.querySelector(TABBABLE);
    expect(first).not.toBeNull();
    expect(first?.tagName).toBe("A");
    expect(first?.classList.contains("skip-link")).toBe(true);
    expect(first?.getAttribute("href")).toBe("#main");
    expect(norm(first?.textContent)).toBe("Skip to content");
  });

  it('targets a focusable <main id="main"> so the skip actually lands focus there', () => {
    const target = doc.getElementById("main");
    expect(target?.tagName).toBe("MAIN");
    expect(target?.classList.contains("site-main")).toBe(true);
    // tabindex="-1" makes <main> a valid focus target for the in-page #main jump.
    expect(target?.getAttribute("tabindex")).toBe("-1");
  });

  it("carries the full semantic landmark set (header, nav, main, section, footer)", () => {
    expect(doc.querySelectorAll("body > header").length).toBe(1);
    expect(doc.querySelector("header nav")).not.toBeNull();
    expect(doc.querySelectorAll("main").length).toBe(1);
    expect(doc.querySelectorAll("main section").length).toBeGreaterThan(0);
    expect(doc.querySelectorAll("body > footer").length).toBe(1);
  });

  it("names every content <section> (the page-sections wrapper is exempt)", () => {
    const sections = [...doc.querySelectorAll("section:not([data-region])")];
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const labelledby = section.getAttribute("aria-labelledby");
      const namedByHeading =
        !!labelledby && labelledby.split(/\s+/).every((id) => doc.getElementById(id));
      const namedByLabel = norm(section.getAttribute("aria-label")).length > 0;
      expect(
        namedByHeading || namedByLabel,
        `unnamed <section class="${section.getAttribute("class")}"> in ${file}`,
      ).toBe(true);
    }
  });
});

describe("skip link styling (REQ-032)", () => {
  const rule = CSS.match(/\.skip-link\s*\{[^}]*\}/)?.[0] ?? "";

  it("defines a .skip-link rule that becomes visible on focus", () => {
    expect(rule).not.toBe("");
    expect(CSS).toMatch(/\.skip-link:focus(-visible)?\b/);
  });

  it("colours the skip link with brand tokens only (no raw hex/rgb)", () => {
    expect(rule).toMatch(/background:\s*var\(--/);
    expect(rule).toMatch(/color:\s*var\(--/);
  });
});
