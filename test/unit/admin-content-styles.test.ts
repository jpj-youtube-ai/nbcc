import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// assets/css/admin-content.css: what only Stories and Partners need, on top of the kit
// (docs/superpowers/specs/2026-11-14-admin-refresh-content.md). The kit's house rules hold here too,
// and are pinned the way test/unit/admin-kit.test.ts pins them for the kit.

const ROOT = resolve(__dirname, "../..");
const css = readFileSync(resolve(ROOT, "assets/css/admin-content.css"), "utf8");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
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
const rule = (start: string) => {
  const at = noComments.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  return noComments.slice(at, noComments.indexOf("}", at));
};

describe("the Stories and Partners stylesheet keeps the house rules", () => {
  it("names every rule through one of its three screens, or a part of its own", () => {
    const all = selectors();
    expect(all.length).toBeGreaterThan(40);
    const stray = all.filter((s) => !/^(#view-stories|#view-story|#view-ticker|\.st-|\.pt-)/.test(s));
    expect(stray).toEqual([]);
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
    transitions.forEach((t) => expect(/^(transform|opacity)/.test(t.trim())).toBe(true));
  });

  it("has no side stripe and no gradient words", () => {
    expect(noComments).not.toMatch(/border-left\s*:\s*\d+px solid/);
    expect(noComments).not.toContain("background-clip: text");
  });

  it("gives everything that is pressed a finger's height", () => {
    [".pt-switch {", ".pt-card__open {", "#view-stories .st-open {", ".st-step {"].forEach((start) =>
      expect(rule(start)).toMatch(/min-height:\s*4[4-9]px/),
    );
  });

  it("sets no width that a 390px phone cannot hold", () => {
    const widths = [...noComments.matchAll(/[;{\s](?:min-)?width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    widths.forEach((w) => expect(w).toBeLessThanOrEqual(320));
  });

  it("is loaded after the kit", () => {
    expect(html.indexOf("/assets/css/admin-content.css")).toBeGreaterThan(html.indexOf("/assets/css/admin-kit.css"));
  });
});

// A class the page or app.js uses and the sheet has no rule for draws as plain text (TASK-557).
describe.each([
  ["pt-", "Partners"],
  ["st-", "Stories"],
])("every %s class that %s uses has a rule", (prefix) => {
  const used = new Set<string>();
  for (const src of [html, appSrc]) {
    for (const m of src.matchAll(/class=\\?"([^"]*)/g)) {
      for (const word of m[1].split(/\s+/)) {
        const name = word.replace(/[^\w-].*$/, "");
        if (name.startsWith(prefix) && /[a-z0-9]$/i.test(name)) used.add(name);
      }
    }
  }
  // Names for the script or a test to find, with no look of their own.
  const namesOnly = new Set(["st-list", "st-value"]);

  it("finds the screen's own classes", () => {
    expect(used.size).toBeGreaterThanOrEqual(8);
  });

  it.each([...used].filter((n) => !namesOnly.has(n)).sort())("has a rule for .%s", (name) => {
    expect(new RegExp("\\." + name + "(?![\\w-])[^{}]*\\{").test(noComments)).toBe(true);
  });
});
