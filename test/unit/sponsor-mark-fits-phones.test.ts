import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The sponsor's wordmark must fit the screen it is on. It is set 500px wide in three places (the
// Ball page's hero and its foot, and the home page's Ball promotion; TASK-337 keeps them one size),
// each with `max-width: 100%`, and on a phone that cap did nothing: measured on the live site at
// 375px, the Ball page was 453px wide and the home page 504px, the mark cut off at both edges.
//
// Why the cap did nothing, in each place:
//  - Ball page (and the thank-you page, which ends on the same band). The mark's wrapper is an
//    item in a centred column. Such an item is as wide as its content needs, and while that is
//    being worked out a percentage cap on the content counts as no cap at all, so the wrapper
//    came out 500px and "100%" of it was 500px. The wrapper needs the cap too: its own 100% is of
//    the page column, which is a real width.
//  - Home page. On a narrow screen the promotion is a one column grid, and a `1fr` column may not
//    be narrower than its content, so the 500px mark set the width of the whole text column. The
//    column must be `minmax(0, 1fr)`, as the two column layout already is, and the credit capped
//    at the column it is in. Without that second cap it also ran off the screen wherever the two
//    columns were each narrower than the mark, about 821px to 1040px wide.
//
// jsdom lays nothing out, so these hold the rules themselves, as the other Ball style tests do.
// The widths were measured on the real pages with the rules applied: 320, 375, 414, 560, 768, 835,
// 900, 1000, 1100, 1280 and 1600px, and from 1280px up nothing moves.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const ballCss = read("assets/css/ball.css");
const promo = read("src/ball/home-promo.ts");

// Both brace styles, as in ball-lines-and-logo.test.ts: ball.css writes `.sel {`, the promotion's
// inline styles write `.sel{`. The first rule with that selector.
function rule(css: string, selector: string): string {
  let start = css.indexOf(selector + " {");
  if (start === -1) start = css.indexOf(selector + "{");
  if (start === -1) return "";
  const end = css.indexOf("}", start);
  return end === -1 ? "" : css.slice(start, end);
}
const tight = (css: string) => css.replace(/\s+/g, "");

describe("the sponsor's mark fits a phone: the Ball page and its thank-you page", () => {
  it.each([
    ["the hero's credit", ".ball-credit"],
    ["the band at the foot", ".ball-sponsor-name"],
  ])("%s is never wider than the page column", (_where, selector) => {
    const css = rule(ballCss, selector);
    expect(css).not.toBe("");
    expect(tight(css)).toContain("max-width:100%");
  });

  it.each([".ball-credit a", ".ball-sponsor-name a"])("%s keeps its one size, and its cap", (selector) => {
    // The cap on the mark is what shrinks it once its wrapper has a real width. Both stay.
    const css = tight(rule(ballCss, selector));
    expect(css).toContain("width:500px");
    expect(css).toContain("max-width:100%");
  });
});

describe("the sponsor's mark fits a phone: the home page's Ball promotion", () => {
  it("lets the one column layout be as narrow as the screen", () => {
    const css = tight(promo);
    expect(css).toContain("@media(max-width:820px){.ball-home-feature.wrap{grid-template-columns:minmax(0,1fr)}}");
    // A bare 1fr is the fault: it may not shrink below its content.
    expect(css).not.toContain("grid-template-columns:1fr}");
  });

  it("caps the credit at its column, and no wider than the paragraphs above it", () => {
    // The paragraphs' own measure is 46ch, and the credit is a paragraph, so the cap repeats it:
    // where there is room nothing changes, and where there is not the column wins.
    expect(tight(rule(promo, ".ball-home-copy p"))).toContain("max-width:46ch");
    expect(tight(rule(promo, ".ball-home-copy .ball-home-credit"))).toContain("max-width:min(46ch,100%)");
  });

  it("keeps the mark its one size, and its cap", () => {
    const css = tight(rule(promo, ".ball-home-credit a"));
    expect(css).toContain("width:500px");
    expect(css).toContain("max-width:100%");
  });
});
