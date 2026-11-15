import { describe, it, expect } from "vitest";
import { adminHtml, read } from "./helpers/admin-settings-harness";

// Site pages, QR codes, Team, Manage access and My account take the kit's look (the class ak), with
// what only they need in assets/css/admin-settings.css
// (docs/superpowers/specs/2026-11-14-admin-refresh-settings.md). The kit's house rules are pinned for
// that sheet here, as test/unit/admin-kit.test.ts pins them for the kit.

const VIEWS = ["view-site", "view-qr", "view-team", "view-team-permissions", "view-account"];
const css = read("assets/css/admin-settings.css");
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

describe("the five screens are in the kit's look", () => {
  it.each(VIEWS)("#%s carries the class ak", (id) => {
    const tag = adminHtml.match(new RegExp('<section class="([^"]*)" id="' + id + '"'));
    expect(tag, id).not.toBeNull();
    expect(tag![1].split(/\s+/)).toContain("admin-view");
    expect(tag![1].split(/\s+/)).toContain("ak");
  });

  it("loads their sheet after the kit, so it wins on order", () => {
    const kit = adminHtml.indexOf("/assets/css/admin-kit.css");
    const own = adminHtml.indexOf("/assets/css/admin-settings.css");
    expect(kit).toBeGreaterThan(-1);
    expect(own).toBeGreaterThan(kit);
  });

  it.each(VIEWS)("#%s opens with its title and one plain sentence saying what it is for", (id) => {
    const start = adminHtml.indexOf('id="' + id + '"');
    const view = adminHtml.slice(start, adminHtml.indexOf('<section class="admin-view', start));
    expect(view).toMatch(/<h2 id="[^"]+">[^<]+<\/h2>/);
    expect(view).toContain('class="admin-view-intro"');
  });
});

describe("their stylesheet keeps the house rules", () => {
  it("has rules of its own", () => {
    expect(selectors().length).toBeGreaterThan(40);
  });

  it("names every rule through one of the five screens, or a part of their own", () => {
    const stray = selectors().filter((s) => !(VIEWS.some((v) => s.startsWith("#" + v + " ") || s === "#" + v) || s.startsWith(".set-")));
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
    transitions.forEach((t) => expect(/^(transform|opacity)\b/.test(t.trim())).toBe(true));
  });

  it("has no side stripe and no gradient words", () => {
    expect(noComments).not.toMatch(/border-left\s*:\s*\d+px solid/);
    expect(noComments).not.toContain("background-clip: text");
  });

  it("sets no fixed width wider than a phone", () => {
    const widths = [...noComments.matchAll(/[^-]width\s*:\s*(\d+)px/g)].map((m) => Number(m[1]));
    widths.forEach((w) => expect(w).toBeLessThanOrEqual(358));
  });

  it("leaves the QR and spare address rules the older tests read where they are, in admin.css", () => {
    const old = read("assets/css/admin.css");
    expect(old).toContain("#view-qr .qr-card{");
    expect(old).toContain(".sa-list{container:salist / inline-size}");
  });
});

describe("no field in the five screens carries a width of its own", () => {
  // The old forms pinned each box with style="width:220px", which is how a row of them ran off a
  // phone. The kit's fields fill the space they are given.
  it.each(VIEWS)("#%s has no inline style", (id) => {
    const start = adminHtml.indexOf('id="' + id + '"');
    const view = adminHtml.slice(start, adminHtml.indexOf('<section class="admin-view', start));
    expect(view).not.toContain("style=");
  });
});
