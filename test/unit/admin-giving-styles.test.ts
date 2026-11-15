import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// assets/css/admin-giving.css: what only Claims, GASDS and Subscriptions need on top of the kit
// (docs/superpowers/specs/2026-11-14-admin-refresh-giving.md). The kit's house rules, pinned for this
// sheet too, and a rule for every gv- class the three screens use.

const ROOT = resolve(__dirname, "../..");
const css = readFileSync(resolve(ROOT, "assets/css/admin-giving.css"), "utf8");
const js = readFileSync(resolve(ROOT, "assets/js/admin/giving.js"), "utf8");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

function selectors(): string[] {
  const out: string[] = [];
  const flat = bare.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  for (const m of flat.matchAll(/([^{}]+)\{/g)) {
    const head = m[1].trim();
    if (!head || head.startsWith("@")) continue;
    let depth = 0;
    let one = "";
    for (const ch of head) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(one.trim()); one = ""; } else one += ch;
    }
    out.push(one.trim());
  }
  return out;
}

describe("the Giving sheet keeps the house rules", () => {
  it("names every rule through one of its three screens or its own gv- prefix", () => {
    const stray = selectors().filter((s) => !/^(#view-(claims|gasds|subscriptions)\b|\.gv-)/.test(s));
    expect(stray).toEqual([]);
  });

  it("never uses !important, and nothing scrolls inside a box or sideways", () => {
    expect(bare).not.toContain("!important");
    expect(bare).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
  });

  it("moves only transform and opacity, and only for someone happy with motion", () => {
    const outside = bare.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/transition\s*:|animation\s*:/);
  });

  it("has no side stripes, no gradient words and no fixed width wider than a phone", () => {
    expect(bare).not.toMatch(/border-left\s*:\s*\d+px solid/);
    expect(bare).not.toContain("background-clip: text");
    for (const m of bare.matchAll(/(?:^|[^-])width\s*:\s*(\d+)px/g)) expect(Number(m[1])).toBeLessThanOrEqual(358);
  });

  it("gives a tick box's label a finger's height", () => {
    const at = bare.indexOf(".gv-row__tick {");
    expect(at).toBeGreaterThan(-1);
    expect(bare.slice(at, bare.indexOf("}", at))).toMatch(/min-height:\s*44px/);
  });

  it("has a rule for every gv- class the three screens use", () => {
    const used = new Set<string>();
    for (const src of [js, html]) for (const m of src.matchAll(/\bgv-[a-z0-9_-]*[a-z0-9]/g)) used.add(m[0]);
    const missing = [...used].filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(bare));
    expect(used.size).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
