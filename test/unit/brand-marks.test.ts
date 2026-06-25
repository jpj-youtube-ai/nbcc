import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-012 (REQ-007): the signature .rule divider — a Holly Green hairline with a
// centred crimson diamond — exists in the shared stylesheet (token colours only)
// and is placed directly under page headings (never free-floating). Mirrors
// footer.test.ts / layout-tokens.test.ts. DB-free.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const PAGES = ["index.html", "about.html", "donate.html", "contact.html"];

describe(".rule component in the stylesheet", () => {
  const css = read("assets/css/styles.css");
  const ruleCss = [...css.matchAll(/\.rule[^{]*\{[^}]*\}/g)].map((m) => m[0]).join("\n");

  it("declares a .rule component", () => {
    expect(ruleCss).not.toBe("");
  });
  it("draws the hairline in Holly Green (var(--holly))", () => {
    expect(ruleCss).toMatch(/var\(--holly\)/);
  });
  it("draws the diamond in crimson (var(--crimson))", () => {
    expect(ruleCss).toMatch(/var\(--crimson\)/);
  });
  it("uses pseudo-elements / borders, not an image", () => {
    expect(ruleCss).not.toMatch(/url\(/i);
  });
});

describe.each(PAGES)("%s places the .rule under a heading", (file) => {
  const html = read(file);
  const rules = (html.match(/class="rule"/g) ?? []).length;
  const underHeading = (html.match(/<\/h[1-4]>\s*<div[^>]*class="rule"/gi) ?? []).length;

  it("has at least one .rule divider", () => {
    expect(rules).toBeGreaterThan(0);
  });
  it("places every .rule immediately after a heading (never free-floating)", () => {
    expect(underHeading).toBe(rules);
  });
});
