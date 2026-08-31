import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-334: three things staff had to report more than once before they were actually fixed.
// Each was "adjusted" in an earlier pass in a way that looked right in the diff and changed
// nothing on screen, so each gets a guard that fails on the value rather than on the intent.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const ballCss = read("assets/css/ball.css");
const siteCss = read("assets/css/styles.css");
const ballHtml = read("ball.html");
const ballRoute = read("src/routes/ball.ts");

// Pull a declaration's value out of a named rule. Plain indexOf/slice: the earlier attempt at
// this used a RegExp built from a template literal, which escaped into a pattern that matched
// nothing and compared two empty strings for a cheerful pass.
//
// Both brace styles, because the two stylesheets do not agree: styles.css writes
// `.sel{...}` and ball.css writes `.sel {...}`. Looking for only one of them returns "" for a
// rule that is right there, and "" passes any assertion phrased as "does not contain".
function rule(css: string, selector: string): string {
  let start = css.indexOf(selector + " {");
  if (start === -1) start = css.indexOf(selector + "{");
  if (start === -1) return "";
  const end = css.indexOf("}", start);
  return end === -1 ? "" : css.slice(start, end);
}

describe("the dividers in the main nav are visible (TASK-334)", () => {
  // Reported twice. A 1px bar in --line (#E9DFD2) on a cream ground is very nearly the cream
  // ground, so the nav read as four words with nothing between them.
  const divider = rule(siteCss, ".nav-links li + li::before");

  it("has a divider rule at all", () => {
    expect(divider).not.toBe("");
  });

  it("is at least 3px wide, not a hairline", () => {
    const width = divider.match(/width:\s*(\d+)px/)?.[1];
    expect(width).toBeDefined();
    expect(Number(width)).toBeGreaterThanOrEqual(3);
  });
});

describe("the rules across the ball hero are visible (TASK-334)", () => {
  // Also reported twice. The first attempt raised the OPACITY (0.22 -> 0.42) and left the width
  // at 1px, which is why nothing appeared to change: on a dark ground a 1px line reads as a
  // screen artefact however bright it is.
  const facts = rule(ballCss, ".ball-facts");

  it("draws its top and bottom rules at 3px or more", () => {
    const widths = [...facts.matchAll(/border-(?:top|bottom):\s*(\d+)px/g)].map((m) =>
      Number(m[1]),
    );
    expect(widths.length).toBe(2);
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(3);
  });
});

describe("the sponsor logo is centred in its band (TASK-334)", () => {
  // The anchor was an inline-block around an image capped at 320px. Shrink-to-fit resolved
  // against the image's INTRINSIC 486px (a percentage counts as auto while that width is being
  // decided), so the image painted flush left inside a 486px box — about 83px off centre.
  const anchor = rule(ballCss, ".ball-sponsor-name a");
  const img = rule(ballCss, ".ball-sponsor-name img");

  it("gives the anchor a definite width instead of letting it shrink to fit", () => {
    expect(anchor).toContain("display: block");
    expect(anchor).toMatch(/width:\s*\d+px/);
    expect(anchor).not.toContain("display: inline-block");
  });

  it("centres that anchor explicitly", () => {
    expect(anchor).toContain("margin-inline: auto");
  });

  it("lets the image fill the box it was given", () => {
    // min(100%, 320px) here is what created the mismatch: the cap belongs on the BOX, and the
    // image should simply fill it.
    expect(img).toContain("width: 100%");
    expect(img).not.toContain("min(100%");
  });

  it("keeps the optical nudge, which measurement says is right", () => {
    // The wordmark's ink sits left of the artwork's centre because the swoosh carries almost
    // none. The alpha-weighted centre of mass of the PNG is 228 of 486, so centring the ink
    // needs +3.1% — the box was the bug, not this number.
    expect(img).toContain("translateX(3.1%)");
  });
});

describe("the ball page carries its own nav item (TASK-334)", () => {
  // Behaviour is covered in features/ball-gate.feature. This guards the wiring, because the
  // failure was not a broken function — addBallNavLink was correct and tested — but a route
  // that never called it.
  it("applies the nav link to the page it serves", () => {
    // The CALL, not the mention. Asserting the file merely contains "addBallNavLink" passes on
    // the import line alone — verified by deleting the call and watching this go green.
    expect(ballRoute).toMatch(/send\(\s*addBallNavLink\(/);
  });
});

describe("what is still to be confirmed (TASK-334)", () => {
  // The page said a drink on arrival was included AND that drinks were still being finalised.
  // A buyer cannot tell from that whether drinks are included, so it had to stop saying both.
  const tbc = ballHtml.slice(
    ballHtml.indexOf('<p class="ball-tbc">'),
    ballHtml.indexOf("</p>", ballHtml.indexOf('<p class="ball-tbc">')),
  );

  it("does not list drinks among the things still being decided", () => {
    expect(tbc).not.toMatch(/drinks/i);
  });

  it("still says the menu and running order are coming", () => {
    expect(tbc).toMatch(/menu/i);
    expect(tbc).toMatch(/running order/i);
  });

  it("still promises to tell buyers once they are confirmed", () => {
    expect(tbc).toMatch(/email/i);
  });

  // The same sentence is the confirmation email's fallback, and the two drifting apart is how
  // a buyer ends up reading one thing on the page and another in their inbox.
  it("says the same in the confirmation email", () => {
    const email = read("src/ball/confirmation-email.ts");
    expect(email).not.toMatch(/menu and drinks are still being finalised/i);
    expect(email).toMatch(/menu and the running order are still being finalised/i);
  });
});
