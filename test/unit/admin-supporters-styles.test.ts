import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// assets/css/admin-supporters.css: what Business supporters, Monthly givers and Invoices need on top
// of the kit (docs/superpowers/specs/2026-11-14-admin-refresh-supporters.md). The kit's house rules
// hold for it too, and are pinned here the way test/unit/admin-kit.test.ts pins the kit's own.

const ROOT = resolve(__dirname, "../..");
const css = readFileSync(resolve(ROOT, "assets/css/admin-supporters.css"), "utf8");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every selector in the sheet, with at-rules opened up and keyframe steps left out. */
function selectors(): string[] {
  const out: string[] = [];
  const flat = noComments.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  for (const m of flat.matchAll(/([^{}]+)\{/g)) {
    const head = m[1].trim();
    if (!head || head.startsWith("@")) continue;
    let depth = 0;
    let one = "";
    for (const ch of head) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(one.trim());
        one = "";
      } else one += ch;
    }
    out.push(one.trim());
  }
  return out;
}

/** The declarations of the first rule whose selector list starts with these words. */
function rule(start: string): string {
  const at = noComments.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  return noComments.slice(at, noComments.indexOf("}", at));
}

describe("the supporters stylesheet keeps the house rules", () => {
  it("has rules for all three screens", () => {
    const all = selectors();
    for (const view of ["#view-fulfilments", "#view-monthly", "#view-invoices"]) {
      expect(all.filter((s) => s.startsWith(view)).length, view).toBeGreaterThan(5);
    }
  });

  it("names every rule through one of its own screens, so no other screen is touched", () => {
    expect(selectors().filter((s) => !s.startsWith("#view-"))).toEqual([]);
  });

  it("never uses !important", () => {
    expect(noComments).not.toContain("!important");
  });

  it("never makes a box that scrolls, inside itself or sideways", () => {
    expect(noComments).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
  });

  it("moves only transform and opacity, and only for someone happy with motion", () => {
    const outside = noComments.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/transition\s*:/);
    expect(outside).not.toMatch(/animation\s*:/);
    const transitions = [...noComments.matchAll(/transition\s*:\s*([^;]+);/g)].map((m) => m[1]);
    transitions.forEach((t) => expect(t.trim().startsWith("transform") || t.trim().startsWith("opacity")).toBe(true));
  });

  it("has no side stripe and no gradient words", () => {
    expect(noComments).not.toMatch(/border-left\s*:\s*\d+(\.\d+)?px solid/);
    expect(noComments).not.toContain("background-clip: text");
  });

  it("sets no width in pixels that a 390px phone could not hold", () => {
    const widths = [...noComments.matchAll(/(?:^|[\s;{])(?:min-)?width\s*:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(widths.filter((w) => w > 320)).toEqual([]);
  });

  it("gives what is pressed a finger's height", () => {
    [
      "#view-fulfilments .fx-tel",
      "#view-fulfilments .sup-email",
      "#view-monthly .mg-email",
      "#view-invoices .inv-kind label",
      "#view-invoices .inv-mail",
    ].forEach((start) => expect(rule(start), start).toMatch(/min-height:\s*4[4-9]px/));
  });

  it("keeps a field's words at 16px, so an iPhone does not zoom in", () => {
    expect(noComments).not.toMatch(/(input|select|textarea)[^{}]*\{[^}]*font-size:\s*0?\.\d+rem/);
  });

  it("is loaded after the kit", () => {
    expect(html.indexOf("/assets/css/admin-supporters.css")).toBeGreaterThan(html.indexOf("/assets/css/admin-kit.css"));
  });
});
