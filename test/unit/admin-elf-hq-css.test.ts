import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Head Elf HQ's stylesheet (assets/css/admin-elf-hq.css) keeps to the house rules: its own names so
// it can never restyle the rest of the admin, no !important, nothing that scrolls inside a box, and
// motion only for someone happy with it, moving only transform and opacity.
const CSS = readFileSync(resolve(__dirname, "../../assets/css/admin-elf-hq.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The blocks of the stylesheet, with the at rule each sits in ("" at the top). */
function rules(css: string): { at: string; selector: string; body: string }[] {
  const out: { at: string; selector: string; body: string }[] = [];
  let i = 0;
  const walk = (at: string, end: number) => {
    while (i < end) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= end) break;
      const head = css.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      if (head.startsWith("@media") || head.startsWith("@supports") || head.startsWith("@container")) {
        i = open + 1;
        walk(head, j - 1);
        i = j;
      } else {
        out.push({ at, selector: head, body: css.slice(open + 1, j - 1) });
        i = j;
      }
    }
  };
  walk("", css.length);
  return out;
}

describe("Head Elf HQ's stylesheet", () => {
  const all = rules(CSS);

  it("names only its own pieces", () => {
    for (const r of all) {
      if (r.selector.startsWith("@keyframes") || r.selector.startsWith("@font-face")) continue;
      for (const s of r.selector.split(",").map((x) => x.trim())) {
        expect(s.startsWith(".hq-") || s.startsWith("#view-elf"), s).toBe(true);
      }
    }
  });

  it("never needs !important and never scrolls inside a box", () => {
    expect(CSS).not.toMatch(/!important/);
    expect(CSS).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
  });

  it("moves only for someone happy with motion, and only by transform and opacity", () => {
    const frames = all.filter((r) => r.selector.startsWith("@keyframes"));
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f.at, f.selector).toMatch(/prefers-reduced-motion:\s*no-preference/);
      const props = [...f.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity"], `${f.selector}: ${p}`).toContain(p);
    }
    for (const r of all.filter((x) => /(^|;|\s)(animation|transition)\s*:/.test(x.body))) {
      expect(r.at, r.selector).toMatch(/prefers-reduced-motion:\s*no-preference/);
    }
  });

  it("draws in NBCC's own colours, with a deep maroon ink rather than black", () => {
    expect(CSS).toContain("--hq-ink: #3A0B0B");
    expect(CSS).toContain("--hq-maroon: #800000");
    expect(CSS).not.toMatch(/#000(000)?\b/i);
  });
});
