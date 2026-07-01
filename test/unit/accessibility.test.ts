// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-044 (REQ-032): a sitewide guard for the WCAG 2.1 AA accessibility floor
// across the marketing pages. This is the *structural* half of the AA audit — it
// encodes the invariants a full axe / Lighthouse pass checks against a running
// app (that manual pass is documented in README, mirroring the perf-budget note),
// so a regression fails in CI instead of only in a manual audit. Host-free and
// DB-free: jsdom + DOMParser over each page's HTML, mirroring copy-rules /
// perf-budget / contact tests. Pairs with the skip-link + landmark markup
// (TASK-043) — those assertions rely on that markup being in place.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const docOf = (html: string) => new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const CSS = read("assets/css/styles.css");

// supporters.html rides along defensively once TASK-022 lands (mirrors copy-rules).
const PAGES = ["index.html", "about.html", "donate.html", "contact.html", "supporters.html"].filter(
  (f) => existsSync(resolve(ROOT, f)),
);

// Tabbable = what the first Tab from page load can reach, in DOM order. A
// tabindex="-1" element is programmatically focusable but NOT in the tab order,
// so <main tabindex="-1"> is excluded and the skip link must come out first.
const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

describe.each(PAGES)("accessibility floor (REQ-032): %s", (page) => {
  const doc = docOf(read(page));

  it("makes a skip link the first tabbable element, targeting an existing #main", () => {
    const first = doc.body.querySelector(TABBABLE);
    expect(first?.tagName).toBe("A");
    expect(first?.classList.contains("skip-link")).toBe(true);
    expect(norm(first?.textContent).length).toBeGreaterThan(0);

    const href = first?.getAttribute("href") ?? "";
    expect(href).toMatch(/^#.+/);
    const target = doc.getElementById(href.slice(1));
    expect(target, `skip link target ${href} must exist on ${page}`).not.toBeNull();
    expect(target?.tagName).toBe("MAIN");
  });

  it("has exactly one <main> and the header/nav/footer landmarks", () => {
    expect(doc.querySelectorAll("main").length).toBe(1);
    expect(doc.querySelector("header"), "no <header> landmark").not.toBeNull();
    expect(doc.querySelector("nav"), "no <nav> landmark").not.toBeNull();
    expect(doc.querySelector("footer"), "no <footer> landmark").not.toBeNull();
  });

  it("gives every <img> non-empty alt text (decorative SVGs use aria-hidden instead)", () => {
    const imgs = [...doc.querySelectorAll("img")];
    for (const img of imgs) {
      const alt = img.getAttribute("alt");
      const src = img.getAttribute("src");
      expect(alt, `<img src="${src}"> is missing an alt attribute`).not.toBeNull();
      expect(norm(alt).length, `<img src="${src}"> has empty alt text`).toBeGreaterThan(0);
    }
  });

  it("labels every form control and marks required fields with required + aria-required", () => {
    const controls = [...doc.querySelectorAll("input, textarea, select")].filter(
      (el) => (el.getAttribute("type") ?? "").toLowerCase() !== "hidden",
    );
    for (const el of controls) {
      const id = el.getAttribute("id");
      expect(id, `form control without an id: ${el.outerHTML}`).toBeTruthy();

      const label = doc.querySelector(`label[for="${id}"]`);
      expect(label, `no <label for="${id}"> on ${page}`).not.toBeNull();
      expect(norm(label?.textContent).length, `empty <label for="${id}">`).toBeGreaterThan(0);

      // Required fields must carry BOTH the HTML constraint and the ARIA hint.
      if (el.hasAttribute("required")) {
        expect(
          el.getAttribute("aria-required"),
          `#${id} is required but missing aria-required="true"`,
        ).toBe("true");
      }
    }
  });
});

// The two AA invariants that live once in the shared stylesheet, not per page.
describe("accessibility floor (REQ-032): shared stylesheet", () => {
  it("declares a visible Holly Green :focus-visible ring", () => {
    // Isolate the GLOBAL :focus-visible rule (preceded by } or start of file),
    // not the component variants like .btn:focus-visible::after.
    const rule = CSS.match(/(?:^|\})\s*:focus-visible\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule, "no global :focus-visible rule").not.toBe("");
    expect(rule).toMatch(/outline/);
    expect(rule).toMatch(/var\(--holly\)/);
  });

  it("carries a prefers-reduced-motion off-switch that zeroes transition + animation", () => {
    expect(CSS).toMatch(/@media[^{]*prefers-reduced-motion:\s*reduce/i);
    expect(CSS).toMatch(/transition:\s*none\s*!important/i);
    expect(CSS).toMatch(/animation:\s*none\s*!important/i);
  });
});

it("guards at least the four core marketing pages", () => {
  for (const f of ["index.html", "about.html", "donate.html", "contact.html"]) {
    expect(PAGES).toContain(f);
  }
});
