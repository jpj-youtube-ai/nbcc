import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { renderBallBagsPage } from "../../src/ball/bags-page";

// Fill a Red Bag's pictures became paintings on 5 November 2026. The Ball's own fill a bag (/bag,
// reached from the table QR codes on the night) stays exactly as it was (Jaimie): it keeps the hand
// drawings, word for word, and never asks for a painting.
const require = createRequire(import.meta.url);
const rb = require(resolve(__dirname, "../../assets/js/red-bag-catalogue.js"));
const page = renderBallBagsPage();

describe("the Ball's /bag page and Fill a Red Bag's paintings", () => {
  it("draws no painting", () => {
    expect(page).not.toContain("/assets/img/red-bag/");
  });

  it("keeps a hand drawing for every picture Fill a Red Bag has, in shapes", () => {
    for (const key of Object.keys(rb.ART)) {
      const svg = rb.drawing(key, "bb-art", 34);
      expect(svg, key).toMatch(/^<svg class="rb-art bb-art" viewBox="0 0 40 40" width="34" height="34"/);
      expect(svg, key).not.toMatch(/<image|href/);
      expect(svg.match(/<(path|rect|circle|ellipse)\b/g)?.length ?? 0, key).toBeGreaterThan(2);
    }
    expect(rb.drawing("no-such-thing")).toBe("");
  });

  it("shows those drawings on the page", () => {
    expect(page).toContain('class="rb-art bb-art"');
  });
});
