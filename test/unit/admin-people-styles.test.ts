import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The stylesheet for one donor's page and Search (assets/css/admin-people.css), on top of the kit
// (docs/superpowers/specs/2026-11-14-admin-refresh-people.md). The kit's house rules hold for an
// area's own sheet too, so they are pinned here for this one.

const ROOT = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");
const css = read("assets/css/admin-people.css");
const html = read("admin.html");
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

describe("the people sheet (one donor's page and Search)", () => {
  it("is linked straight after the supporters sheet, so it sits on top of the kit", () => {
    const supporters = html.indexOf('<link rel="stylesheet" href="/assets/css/admin-supporters.css" />');
    const people = html.indexOf('<link rel="stylesheet" href="/assets/css/admin-people.css" />');
    expect(supporters).toBeGreaterThan(-1);
    expect(people).toBeGreaterThan(supporters);
    expect(html.slice(supporters, people).split("\n").length).toBe(2);
    expect(people).toBeGreaterThan(html.indexOf("/assets/css/admin-kit.css"));
  });

  it("is read by the guard that checks every class family has rules", () => {
    expect(read("test/unit/admin-screen-styles.test.ts")).toContain('"people"');
  });

  it("names every rule through one of its two screens, or a part of its own", () => {
    const stray = selectors().filter((s) => !(s.startsWith("#view-donor") || s.startsWith("#view-search") || s.startsWith(".pp-")));
    expect(stray).toEqual([]);
    expect(selectors().length).toBeGreaterThan(10);
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
    for (const m of noComments.matchAll(/transition\s*:\s*([^;]+);/g)) {
      expect(m[1].trim().startsWith("transform") || m[1].trim().startsWith("opacity")).toBe(true);
    }
  });

  it("has no side stripe and no gradient words", () => {
    expect(noComments).not.toMatch(/border-left\s*:\s*\d+px solid/);
    expect(noComments).not.toContain("background-clip: text");
  });

  it("never fixes a width a 390px phone cannot hold", () => {
    for (const m of noComments.matchAll(/(?:^|[;{\s])(?:min-)?width\s*:\s*(\d+)px/g)) {
      expect(Number(m[1]), m[0]).toBeLessThanOrEqual(320);
    }
  });

  // The gifts found by Search stay in the donations table, which stacks itself where it is narrow
  // (admin.css, .dn-list). This sheet may dress its cards; it may not lay its rows or cells out.
  it("leaves the layout of the gifts table's rows and cells to the table's own rules", () => {
    const flat = noComments.replace(/\s+/g, " ");
    for (const m of flat.matchAll(/([^{}]*\.dn-table[^{}]*)\{([^}]*)\}/g)) {
      if (m[1].includes("::before")) continue;
      expect(m[2], m[1]).not.toMatch(/(^|;|\s)(display|width|min-width|max-width|flex|flex-basis)\s*:/);
    }
  });

  it("gives both screens the kit's look", () => {
    expect(html).toContain('<section class="admin-view ak" id="view-search"');
    expect(html).toContain('<section class="admin-view ak" id="view-donor"');
  });
});
