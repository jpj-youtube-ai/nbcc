import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-010 (REQ-005): assets/css/styles.css defines a two-family type system —
// Playfair Display (--font-head) for headings, Poppins (--font-body) for body —
// with clamp() scale tokens, self-hosted via exactly two @font-face woff2.
// Mirrors brand-colours.test.ts. DB-free.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CSS = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");

const ROOT_BLOCK_RE = /:root\s*\{[\s\S]*?\}/g;
const FONT_FACE_RE = /@font-face\s*\{[\s\S]*?\}/gi;
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const rootBlock = (CSS.match(ROOT_BLOCK_RE) ?? []).join("\n");
const fontFaces = CSS.match(FONT_FACE_RE) ?? [];
// rule bodies with :root, @font-face and comments removed
const ruleBody = stripComments(CSS).replace(ROOT_BLOCK_RE, "").replace(FONT_FACE_RE, "");

describe("two font families declared as tokens (REQ-005)", () => {
  it("--font-head is Playfair Display", () => {
    expect(rootBlock).toMatch(/--font-head:\s*[^;]*Playfair Display/i);
  });
  it("--font-body is Poppins", () => {
    expect(rootBlock).toMatch(/--font-body:\s*[^;]*Poppins/i);
  });
  it("declares exactly two --font-* family tokens (no third)", () => {
    const names = [...rootBlock.matchAll(/(--font-[a-z]+)\s*:/gi)].map((m) => m[1].toLowerCase());
    expect(new Set(names)).toEqual(new Set(["--font-head", "--font-body"]));
  });
});

describe("clamp() type-scale tokens exist", () => {
  for (const key of ["--fs-hero", "--fs-page-intro", "--fs-section", "--fs-lede", "--fs-body", "--fs-eyebrow"]) {
    it(`${key} is a clamp() token`, () => {
      expect(rootBlock).toMatch(new RegExp(`${key}\\s*:\\s*clamp\\(`, "i"));
    });
  }
});

describe("self-hosted via exactly two woff2 @font-face blocks", () => {
  it("has exactly two @font-face blocks", () => {
    expect(fontFaces.length).toBe(2);
  });
  it("declares only Playfair Display and Poppins, each woff2", () => {
    const families = fontFaces.map((f) => f.match(/font-family:\s*["']?([^"';]+)/i)?.[1].trim());
    expect(new Set(families)).toEqual(new Set(["Playfair Display", "Poppins"]));
    for (const f of fontFaces) expect(f).toMatch(/format\(\s*["']woff2["']\s*\)/i);
  });
});

describe("headings use the heading font in crimson", () => {
  const block = CSS.match(/[^{}]*\bh1\b[^{]*\{[^}]*\}/i)?.[0] ?? "";
  it("sets font-family: var(--font-head)", () => {
    expect(block).toMatch(/font-family:\s*var\(--font-head\)/);
  });
  it("sets color: var(--crimson)", () => {
    expect(block).toMatch(/color:\s*var\(--crimson\)/);
  });
});

describe("no third font family leaks into rules", () => {
  it("every font-family in a rule references --font-head or --font-body", () => {
    const decls = [...ruleBody.matchAll(/font-family:\s*([^;}]+)/gi)].map((m) => m[1].trim());
    for (const d of decls) {
      expect(d, `unexpected font-family: ${d}`).toMatch(/^var\(--font-(head|body)\)$/);
    }
    expect(decls.length).toBeGreaterThan(0);
  });
});
