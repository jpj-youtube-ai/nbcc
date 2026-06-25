import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-009 (REQ-004): assets/css/styles.css declares the canonical NBCC brand
// colour token system in ONE :root block, and every colour value elsewhere is a
// var(--…) token — the only hex/rgb literals allowed are inside :root. Guards the
// tan/holly-on-cream contrast rule. DB-free, mirrors static-site.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CSS = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");

const ROOT_BLOCK_RE = /:root\s*\{[\s\S]*?\}/g;
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const rootBlocks = (css: string) => (css.match(ROOT_BLOCK_RE) ?? []).join("\n");
const outsideRoot = (css: string) => stripComments(css).replace(ROOT_BLOCK_RE, "");

const OFFICIAL: Record<string, string> = {
  "--crimson": "#c02238",
  "--maroon": "#800000",
  "--cream": "#f8f5ee",
  "--tan": "#d29c8a",
  "--slate": "#333333",
  "--holly": "#1a531a",
};
const DERIVED: Record<string, string> = {
  "--card": "#fffdfa",
  "--line": "#e9dfd2",
  "--tan-soft": "#f3e4dd",
  "--holly-soft": "#eaf0e7",
  "--slate-soft": "#6f6a66",
};

describe("brand colour tokens are declared (REQ-004)", () => {
  const root = rootBlocks(CSS);
  for (const [name, hex] of Object.entries({ ...OFFICIAL, ...DERIVED })) {
    it(`declares ${name} = ${hex}`, () => {
      expect(root).toMatch(new RegExp(`${name}\\s*:\\s*${hex}\\b`, "i"));
    });
  }

  it("uses a single canonical :root block", () => {
    expect((CSS.match(/:root\s*\{/g) ?? []).length).toBe(1);
  });
});

describe("no colour literals outside the :root token block", () => {
  const body = outsideRoot(CSS);

  it("has no hex colour literals", () => {
    expect(body.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });

  it("has no rgb()/rgba() literals", () => {
    expect(body.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});

describe("contrast rule: no tan/holly text on cream/card", () => {
  const body = outsideRoot(CSS);

  it("never sets color to --tan/--holly without a dark background in the same rule", () => {
    for (const block of body.split("}")) {
      if (/color\s*:\s*var\(--(tan|holly)\)/i.test(block)) {
        const darkBg = /background[^;]*var\(--(maroon|crimson|slate|holly)\)/i.test(block);
        expect(darkBg, `tan/holly text without a dark background near: ${block.trim().slice(0, 60)}`).toBe(true);
      }
    }
  });
});
