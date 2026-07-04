// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-032 (REQ-024): donate.html's Holly Green .give-side panel, filled with the
// three "where your gift goes" points, the SC047995 charity number (OSCR
// regulated, mirroring the footer reference), and four payment-method chips
// (Card, Direct Debit, Apple Pay, Google Pay). Inverted cream-on-holly tints
// only; decorative check SVGs are aria-hidden, no <img> (perf budget). Parsed
// with jsdom; mirrors give-widget.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const CHIPS = ["Card", "Direct Debit", "Apple Pay", "Google Pay"];

describe("donate side panel content (REQ-024)", () => {
  const side = doc.querySelector(".give-card aside.give-side");

  it("renders the Holly Green side panel inside the give-card", () => {
    expect(side).not.toBeNull();
  });

  it("lists three 'where your gift goes' points as a semantic list", () => {
    const items = [...(side?.querySelectorAll(".side-list li") ?? [])];
    expect(items).toHaveLength(3);
    for (const li of items) {
      expect(norm(li.textContent).length).toBeGreaterThan(0);
    }
  });

  it("uses the full beneficiary phrasing (REQ-031)", () => {
    expect(norm(side?.textContent)).toContain("children, young people and vulnerable adults");
  });

  it("shows the SC047995 charity number, OSCR regulated", () => {
    const text = norm(side?.textContent);
    expect(text).toContain("SC047995");
    expect(text).toContain("OSCR");
    // Reuses the footer reference style: SC047995 links to the OSCR register.
    expect(side?.querySelector('a[href*="oscr.org.uk"]')).not.toBeNull();
  });

  it("renders the four payment-method chips", () => {
    const chips = [...(side?.querySelectorAll(".side-pay .chip") ?? [])].map((c) => norm(c.textContent));
    expect(chips).toEqual(CHIPS);
  });

  it("marks decorative check icons aria-hidden and ships no <img> (REQ-032/perf)", () => {
    const svgs = [...(side?.querySelectorAll("svg") ?? [])];
    expect(svgs.length).toBeGreaterThan(0);
    for (const s of svgs) {
      expect(s.getAttribute("aria-hidden")).toBe("true");
    }
    expect(side?.querySelector("img")).toBeNull();
  });

  it("writes the side-panel copy without dashes (REQ-031)", () => {
    expect(norm(side?.textContent)).not.toMatch(/[–—-]/);
  });

  it("styles the panel cream-on-holly, token-only (no hex/rgb in side rules)", () => {
    // The settled stylesheet labels the side-panel rules with a "side panel" block header.
    expect(css).toMatch(/side panel/i);
    const sideCss = [...css.matchAll(/\.side-[a-z]+[^{]*\{[^}]*\}/g)].map((m) => m[0]).join("\n");
    expect(sideCss).not.toBe("");
    expect(sideCss.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(sideCss.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});
