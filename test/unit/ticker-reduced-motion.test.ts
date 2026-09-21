import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-420: the partner ticker looked broken on some devices and fine on others, which is the
// signature of a platform difference rather than a bug in the logic.
//
// It was the reduced-motion fallback, and the fallback itself is right: someone who has asked
// their device to stop animating things must not be given a marquee, so the band becomes a
// manually scrollable strip instead. What was wrong is what that strip LOOKS like.
//
// macOS and iOS draw overlay scrollbars that stay invisible until you scroll, so the band looked
// normal. Windows and Android draw a permanent one about 15px tall, which inside a 40px band is
// a third of its height, sitting under the names like a piece of broken furniture.
//
// So the guard is on the APPEARANCE, and equally on the two things that must not be traded away
// to get it: the animation stays off, and the names stay reachable.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const styles = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");

// The stylesheet has three reduced-motion blocks; this is the one governing the ticker. Matched
// by brace balance rather than a fixed slice, so adding a rule to it cannot silently move the
// end of what gets asserted.
function reducedMotionBlockFor(marker: string): string {
  const pattern = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(styles)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < styles.length && depth > 0) {
      if (styles[i] === "{") depth += 1;
      else if (styles[i] === "}") depth -= 1;
      i += 1;
    }
    const body = styles.slice(start, i - 1);
    if (body.includes(marker)) return body;
  }
  return "";
}

const block = reducedMotionBlockFor("supporter-ticker");
const flat = block.replace(/\s+/g, "");

describe("the ticker's reduced-motion fallback", () => {
  it("has a reduced-motion block governing the ticker at all", () => {
    expect(block).not.toBe("");
  });

  // The whole reason the fallback exists. Losing this to tidy up the scrollbar would trade an
  // accessibility requirement for a cosmetic one.
  it("still stops the marquee", () => {
    expect(flat).toMatch(/\.supporter-ticker__track\{[^}]*animation:none!important/);
  });

  // And the other thing that must survive: a partner whose name is off-screen has to remain
  // reachable, so the strip stays scrollable rather than being clipped.
  it("still lets someone reach the names that do not fit", () => {
    expect(flat).toMatch(/overflow-x:auto/);
  });
});

describe("what that scrollbar looks like", () => {
  // The actual fix. A default scrollbar is ~15px on Windows and Android, inside a 40px band.
  it("asks for a thin scrollbar rather than the platform default", () => {
    expect(flat).toMatch(/scrollbar-width:thin/);
  });

  it("colours it from the brand rather than leaving it grey on maroon", () => {
    expect(flat).toMatch(/scrollbar-color:var\(--cream-24\)/);
  });

  // scrollbar-width/color only landed in Chromium 121. Safari and anything older need the
  // -webkit- pseudo-elements, and Safari is not a rounding error on a charity's traffic.
  it("styles it for WebKit too, which is most phones", () => {
    expect(flat).toMatch(/::-webkit-scrollbar\{height:\d+px/);
    expect(flat).toMatch(/::-webkit-scrollbar-thumb\{[^}]*background:var\(--cream-24\)/);
  });

  it("keeps the WebKit bar no taller than the CSS one asks for", () => {
    const h = Number(flat.match(/::-webkit-scrollbar\{height:(\d+)px/)?.[1] ?? 99);
    // A 40px band. Anything approaching the platform default puts us back where we started.
    expect(h).toBeLessThanOrEqual(6);
  });
});
