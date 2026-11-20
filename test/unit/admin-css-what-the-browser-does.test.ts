import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// TASK-643: two things a jsdom test cannot see, because jsdom never applies a stylesheet, and that
// both reached the live admin on 15 Nov 2026.
//
// 1. assets/css/styles.css (loaded by admin.html before every admin sheet) hides anything with the
//    hidden attribute with `[hidden]{display:none !important}`. So a rule meaning to SHOW a [hidden]
//    element can never win: Analytics' "on a laptop every part shows" rule did nothing, and on a
//    laptop five of its six parts (and the links through to QR codes and Newsletter) could not be
//    reached at all. An element shown on one screen size and not another needs the script to take
//    the attribute off, not a stylesheet.
// 2. A <summary> laid out as flex or grid loses the browser's open-and-close triangle. Without a
//    marker drawn in its place, "Hidden codes (1)" on QR codes read as a heading nobody would press.

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule in a sheet as [one selector, its declarations], with @media and @supports opened up. */
function rules(css: string): [string, string][] {
  const out: [string, string][] = [];
  const flat = noComments(css).replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = m[1].replace(/^[\s\S]*@[^{]*$/, "").trim();
    if (!head) continue;
    for (const one of head.split(",")) out.push([one.trim(), m[2]]);
  }
  return out;
}

describe("the global [hidden] rule the admin lives with", () => {
  it("is still in styles.css with !important, so the guard below is still needed", () => {
    expect(noComments(read("assets/css/styles.css"))).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  const sheets = ["assets/css/admin.css", ...readdirSync(resolve(ROOT, "assets/css")).filter((f) => /^admin-.*\.css$/.test(f)).map((f) => "assets/css/" + f)];
  it.each(sheets)("%s never tries to show an element that has the hidden attribute", (sheet) => {
    const showsHidden = rules(read(sheet)).filter(
      ([sel, body]) => /\[hidden\]$/.test(sel) && /display:\s*(?!none)[a-z-]+/.test(body),
    );
    expect(showsHidden.map(([sel]) => sel)).toEqual([]);
  });
});

describe("a fold the admin draws keeps a sign that it opens", () => {
  const refreshed = readdirSync(resolve(ROOT, "assets/css"))
    .filter((f) => /^admin-.*\.css$/.test(f))
    .map((f) => "assets/css/" + f);
  it.each(refreshed)("%s: every <summary> laid out as flex or grid draws its own marker", (sheet) => {
    const all = rules(read(sheet));
    const drawn = new Set(all.filter(([sel, body]) => /::(after|before)$/.test(sel) && /content:/.test(body)).map(([sel]) => sel.replace(/::(after|before)$/, "")));
    const bare = all
      .filter(([sel, body]) => /(^|[\s>])summary$/.test(sel) && /display:\s*(flex|grid|block|inline-flex|inline-grid)/.test(body))
      .map(([sel]) => sel)
      .filter((sel) => !drawn.has(sel));
    expect(bare).toEqual([]);
  });
});
