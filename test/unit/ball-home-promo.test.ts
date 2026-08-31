import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHomePromo } from "../../src/ball/home-promo";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = readFileSync(resolve(ROOT, "index.html"), "utf8");

describe("renderHomePromo", () => {
  it("changes absolutely nothing while the gate is shut", () => {
    expect(renderHomePromo(HOME, { gateOpen: false })).toBe(HOME);
  });

  it("does not leave the promotion in the page source when shut", () => {
    // The whole point: not hidden with CSS, simply absent. There must be nothing to find.
    const html = renderHomePromo(HOME, { gateOpen: false });
    expect(html).not.toContain("ball-banner");
    expect(html).not.toContain("A Night to Remember");
    expect(html).not.toContain("/ball");
  });

  it("adds the banner and the feature once the gate is open", () => {
    const html = renderHomePromo(HOME, { gateOpen: true });
    expect(html).toContain("ball-banner");
    expect(html).toContain("ball-home-feature");
    expect(html).toContain("A Night to Remember");
  });

  // NB: match the ELEMENTS, not the class names. The class names also appear in the injected
  // <style> block in <head>, so a bare indexOf finds the CSS rule and the position assertion
  // passes (or fails) for entirely the wrong reason.
  it("puts the banner above the hero, so a QR scan sees it without scrolling", () => {
    const html = renderHomePromo(HOME, { gateOpen: true });
    const banner = html.indexOf('<a class="ball-banner"');
    const hero = html.indexOf('<section class="hero"');
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(hero);
  });

  it("puts the feature section below the hero, not in place of it", () => {
    const html = renderHomePromo(HOME, { gateOpen: true });
    const hero = html.indexOf('<section class="hero"');
    const feature = html.indexOf('<section class="ball-home-feature"');
    expect(feature).toBeGreaterThan(-1);
    expect(feature).toBeGreaterThan(hero);
    // the existing hero call to action must survive untouched
    expect(html).toContain('<a class="btn btn-primary" href="/donate">Donate now</a>');
  });

  it("adds Festive Ball to the primary navigation", () => {
    const html = renderHomePromo(HOME, { gateOpen: true });
    expect(html).toMatch(/<li><a href="\/ball">Festive Ball<\/a><\/li>/);
    // and leaves the existing links alone
    expect(html).toContain('<li><a href="/about-us">About</a></li>');
    expect(html).toContain('<li><a href="/supporters">Supporters</a></li>');
  });

  it("carries its own styles inline rather than growing the shared bundle", () => {
    const html = renderHomePromo(HOME, { gateOpen: true });
    expect(html).toContain("<style");
    // donate.html sits ~369 bytes under its enforced budget; the shared file must not grow
    expect(html).not.toContain("ball.css");
  });

  it("links every route through to /ball", () => {
    const html = renderHomePromo(HOME, { gateOpen: true });
    const links = html.match(/href="\/ball"/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(3);
  });

  it("states the price and the date, because that is what a scanner wants first", () => {
    const html = renderHomePromo(HOME, { gateOpen: true });
    expect(html).toContain("7 November 2026");
    expect(html).toContain("&pound;100");
  });

  it("is safe to run twice without doubling the promotion", () => {
    const once = renderHomePromo(HOME, { gateOpen: true });
    const twice = renderHomePromo(once, { gateOpen: true });
    expect(twice).toBe(once);
  });
});

describe("the banner sits BELOW the fixed header, not behind it (TASK-322)", () => {
  // The home page nav is transparent until you scroll, so anything painting a background
  // behind it shows through. Clearing the nav with PADDING put the banner's navy inside its
  // own box and therefore behind the header: grey nav links and the red NBCC logo ended up on
  // a dark band. A MARGIN starts the band below the nav instead.
  //
  // Asserted on the .ball-banner rule alone rather than the whole stylesheet, so an unrelated
  // rule elsewhere cannot make this pass or fail by accident.
  const rule = () => {
    const css = renderHomePromo(HOME, { gateOpen: true });
    const start = css.indexOf(".ball-banner{");
    return css.slice(start, css.indexOf("}", start) + 1);
  };

  it("clears the nav with a margin", () => {
    expect(rule()).toContain("margin-top:var(--nav-h)");
  });

  it("does not clear it with padding, which would paint behind the header", () => {
    const padding = rule().match(/padding:[^;}]*/)?.[0] ?? "";
    expect(padding).not.toContain("--nav-h");
  });

  // body.has-ticker already reserves the partner ticker's height for the whole page. Adding it
  // here as well would double-count and leave a cream gap between the ticker and the banner.
  it("does not also try to clear the partner ticker", () => {
    expect(rule()).not.toContain("--ticker-h");
  });
});
