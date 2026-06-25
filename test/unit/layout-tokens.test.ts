import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-011 (REQ-006): layout/radius/shadow design tokens live in the single
// canonical :root block of assets/css/styles.css. Mirrors brand-colours.test.ts
// / typography.test.ts. DB-free.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CSS = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const rootBlock = (CSS.match(/:root\s*\{[\s\S]*?\}/g) ?? []).join("\n");

describe("layout/radius tokens declared in the single :root (REQ-006)", () => {
  it("uses a single canonical :root block", () => {
    expect((CSS.match(/:root\s*\{/g) ?? []).length).toBe(1);
  });

  const SIMPLE: Record<string, RegExp> = {
    "--maxw": /--maxw:\s*1180px/,
    "--nav-h": /--nav-h:\s*78px/,
    "--pad": /--pad:\s*clamp\(\s*20px\s*,\s*5vw\s*,\s*48px\s*\)/,
    "--radius": /--radius:\s*16px/,
    "--radius-lg": /--radius-lg:\s*24px/,
    "--radius-pill": /--radius-pill:\s*999px/,
  };
  for (const [name, re] of Object.entries(SIMPLE)) {
    it(`declares ${name}`, () => {
      expect(rootBlock).toMatch(re);
    });
  }
});

describe("three maroon-tinted shadow tokens", () => {
  for (const name of ["--shadow-sm", "--shadow", "--shadow-lg"]) {
    it(`${name} is declared and tinted off maroon (rgba 128,0,0)`, () => {
      // value runs from the token name to the next semicolon
      const value = rootBlock.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? "";
      expect(value, `${name} not declared`).not.toBe("");
      expect(value).toMatch(/rgba\(\s*128\s*,\s*0\s*,\s*0\s*,/);
    });
  }
});
