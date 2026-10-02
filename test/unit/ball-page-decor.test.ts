import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decorateBallPage } from "../../src/ball/page-decor";

// TASK-494 review: the Festive Ball's pages are served by src/routes/ball.ts, not the site router,
// so they need the same serve time changes as every other page: the Get involved menu item while
// that page is on, and the footer's "Fundraise for us" pointing at the sign up while fundraising is
// on. With both off, /ball/terms goes out exactly as it is on disk.

const ROOT = resolve(__dirname, "../..");
const ball = readFileSync(resolve(ROOT, "ball.html"), "utf8");
const terms = readFileSync(resolve(ROOT, "ball-terms.html"), "utf8");
const footer = (html: string) => html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";

describe("the ball's pages while fundraising is on", () => {
  it("send the footer's Fundraise for us to the sign up, on the page and the terms", () => {
    for (const html of [ball, terms]) {
      const out = decorateBallPage(html, { ballItem: true, eventsOn: false, fundraisingOn: true });
      if (footer(html).includes("Fundraise for us")) expect(footer(out)).toContain('<a href="/fundraise">Fundraise for us</a>');
      expect(footer(out)).not.toContain('<a href="/contact">Fundraise for us</a>');
    }
  });
});

describe("the ball's pages while fundraising is off", () => {
  it("leave the footer's link at the contact page", () => {
    const out = decorateBallPage(ball, { ballItem: true, eventsOn: false, fundraisingOn: false });
    expect(footer(out)).not.toContain('href="/fundraise"');
  });

  it("leave the terms exactly as on disk when nothing is switched on", () => {
    expect(decorateBallPage(terms, { ballItem: false, eventsOn: false, fundraisingOn: false })).toBe(terms);
  });
});

describe("the menu", () => {
  it("still gets the Festive Ball item and, while it is on, Get involved", () => {
    const out = decorateBallPage(ball, { ballItem: true, eventsOn: true, fundraisingOn: false });
    const nav = out.match(/<ul class="nav-links"[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(nav).toContain('href="/ball"');
    expect(nav).toContain('href="/get-involved"');
  });
});

describe("the routes use it", () => {
  it("for /ball and /ball/terms, asking whether fundraising is on", () => {
    const src = readFileSync(resolve(ROOT, "src/routes/ball.ts"), "utf8");
    expect(src.match(/decorateBallPage\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(src).toContain("fundraisingIsOn");
  });
});
