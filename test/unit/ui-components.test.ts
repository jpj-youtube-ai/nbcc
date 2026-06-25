import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-015 (REQ-009): the global UI components — three .btn pill variants with an
// animated arrow, and the shared .card surface — declared token-only in the
// stylesheet. Mirrors brand-marks.test.ts / layout-tokens.test.ts. DB-free.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CSS = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");

const rules = (re: RegExp) => [...CSS.matchAll(re)].map((m) => m[0]).join("\n");
const btnCss = rules(/\.btn[^{]*\{[^}]*\}/g);
const cardCss = rules(/\.card[^{]*\{[^}]*\}/g);
const variant = (name: string) => rules(new RegExp(`\\.${name}[^{]*\\{[^}]*\\}`, "g"));
const cardSurface = CSS.match(/\.card\s*\{[^}]*\}/)?.[0] ?? "";

describe("button system (REQ-009)", () => {
  it("declares .btn and the three variants", () => {
    for (const sel of [/\.btn\b/, /\.btn-primary\b/, /\.btn-ghost\b/, /\.btn-holly\b/]) {
      expect(CSS).toMatch(sel);
    }
  });

  it(".btn-primary: crimson fill + cream text, maroon hover", () => {
    const v = variant("btn-primary");
    expect(v).toMatch(/var\(--crimson\)/);
    expect(v).toMatch(/var\(--cream\)/);
    expect(v).toMatch(/var\(--maroon\)/);
  });

  it(".btn-ghost: maroon outline + text on a transparent fill", () => {
    const v = variant("btn-ghost");
    expect(v).toMatch(/var\(--maroon\)/);
    expect(v).toMatch(/transparent/);
    expect(v).toMatch(/var\(--cream\)/); // hover text
  });

  it(".btn-holly: holly fill + cream text", () => {
    const v = variant("btn-holly");
    expect(v).toMatch(/var\(--holly\)/);
    expect(v).toMatch(/var\(--cream\)/);
  });

  it("uses --radius-pill for the pill shape", () => {
    expect(btnCss).toMatch(/border-radius:\s*var\(--radius-pill\)/);
  });

  it("animates an arrow via a pseudo-element transform, with no image", () => {
    expect(CSS).toMatch(/\.btn::(after|before)/);
    expect(btnCss).toMatch(/transform:\s*translateX/i);
    expect(btnCss).not.toMatch(/url\(/i);
  });
});

describe("card surface (REQ-009)", () => {
  it("uses var(--card) bg + var(--line) border + a shadow token + a radius token", () => {
    expect(cardSurface).toMatch(/background:\s*var\(--card\)/);
    expect(cardSurface).toMatch(/border:[^;]*var\(--line\)/);
    expect(cardSurface).toMatch(/box-shadow:\s*var\(--shadow[a-z-]*\)/);
    expect(cardSurface).toMatch(/border-radius:\s*var\(--radius[a-z-]*\)/);
  });
});

describe("token-only colours (brand-colours contract)", () => {
  it("no hex/rgb literal in any .btn or .card rule", () => {
    const body = `${btnCss}\n${cardCss}`.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(body.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});
