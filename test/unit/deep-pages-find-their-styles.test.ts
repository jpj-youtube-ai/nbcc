import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Three pages are reached from an email at an address two or more levels deep:
//   portal.html             /portal/access?t=...       (the donor portal link)
//   business-thank-you.html /business/thank-you?t=...  (a business supporter's thank-you)
//   gift-aid.html           /api/gift-aid/<token>      (the Gift Aid declaration)
// A relative `href="assets/css/styles.css"` there is asked for as /portal/assets/..., which is
// a 404, so the page opened with no styles and no scripts at all (found on the live site,
// 5 October 2026). 404.html already says why it uses absolute addresses; these must too.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const DEEP_PAGES = ["portal.html", "business-thank-you.html", "gift-aid.html"];

describe.each(DEEP_PAGES)("%s is served below the top level", (page) => {
  const html = read(page);
  const refs = [...html.matchAll(/<(?:link|script|img|source)\b[^>]*?\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);

  it("loads a stylesheet and a script", () => {
    expect(refs).toContain("/assets/css/styles.css");
    expect(refs).toContain("/assets/js/main.js");
  });

  it("asks for nothing by a relative address", () => {
    const relative = refs.filter((r) => !/^(\/|https?:|data:|#|mailto:|tel:)/.test(r));
    expect(relative).toEqual([]);
  });
});

describe("a long supporter name wraps", () => {
  // One partner's name is five place names joined by slashes, with nowhere to break. On a phone
  // it made its card 489px wide in a 334px column and the whole Supporters page scroll sideways.
  // `anywhere` (not `break-word`) also lets the card's column be narrower than the name.
  it(".supporter-name may break anywhere", () => {
    const css = read("assets/css/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = css.match(/\.supporter-name\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("overflow-wrap:anywhere");
  });
});
