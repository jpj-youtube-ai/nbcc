import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The records' own stylesheet (assets/css/admin-records.css) keeps the kit's house rules
// (test/unit/admin-kit.test.ts): every rule named through one of its four screens, no !important,
// nothing that scrolls in a box, motion only for someone happy with it, no side stripes.

const ROOT = resolve(__dirname, "../..");
const css = readFileSync(resolve(ROOT, "assets/css/admin-records.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");

function selectors(): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
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

describe("the records' stylesheet", () => {
  it("names every rule through one of its four screens", () => {
    const mine = /^#view-(audit|email-audit|analytics|notifications)\b/;
    expect(selectors().length).toBeGreaterThan(20);
    expect(selectors().filter((s) => !mine.test(s))).toEqual([]);
  });

  it("never uses !important, never scrolls in a box, has no side stripe", () => {
    expect(css).not.toContain("!important");
    expect(css).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
    expect(css).not.toMatch(/border-left\s*:\s*\d+px solid/);
  });

  it("moves nothing (the kit's own motion is enough)", () => {
    expect(css).not.toMatch(/transition\s*:|animation\s*:/);
  });

  it("is loaded after the kit", () => {
    expect(html.indexOf("/assets/css/admin-records.css")).toBeGreaterThan(html.indexOf("/assets/css/admin-kit.css"));
  });

  it("puts all four screens in the kit's look", () => {
    for (const id of ["view-audit", "view-email-audit", "view-analytics", "view-notifications"]) {
      expect(html).toMatch(new RegExp(`<section class="admin-view ak" id="${id}"`));
    }
  });
});
