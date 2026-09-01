import { describe, it, expect } from "vitest";
import {
  SITE_PAGES,
  ALL_PAGES,
  DEFAULT_ALIASES,
  aliasFromProblem,
  aliasToProblem,
  isKnownPage,
  renderSitemapTree,
  renderSitemapXml,
} from "../../src/site/pages";

// The public page registry (site-pages feature): one source for the /sitemap tree, the
// sitemap.xml feed, the admin panel and the alias validators. These tests pin the promises the
// feature was approved on: spare addresses can never shadow real routes, the ball stays
// invisible until its gate opens, and the admin's visibility choices actually decide what a
// search engine is offered.

describe("alias validation", () => {
  it("accepts a clean spare address", () => {
    expect(aliasFromProblem("/give-now")).toBeNull();
    expect(aliasFromProblem("/old/page")).toBeNull();
  });

  it("refuses shapes that are not clean lowercase paths", () => {
    for (const bad of ["give", "/Give", "/a b", "/a?x=1", "/a/b/c", "/", ""]) {
      expect(aliasFromProblem(bad), bad).not.toBeNull();
    }
  });

  it("refuses anything that would shadow a real page or system route", () => {
    for (const bad of ["/donate", "/api", "/api/anything", "/admin", "/ball/terms", "/sitemap", "/assets"]) {
      expect(aliasFromProblem(bad), bad).not.toBeNull();
    }
  });

  it("only accepts a registry page as a destination", () => {
    expect(aliasToProblem("/donate")).toBeNull();
    expect(aliasToProblem("/")).toBeNull();
    expect(aliasToProblem("/nowhere")).not.toBeNull();
  });

  it("every seeded day-one alias passes its own validators", () => {
    for (const a of DEFAULT_ALIASES) {
      expect(aliasFromProblem(a.from), a.from).toBeNull();
      expect(aliasToProblem(a.to), a.to).toBeNull();
    }
    // and the two the commissioners asked for by name are in the seed
    expect(DEFAULT_ALIASES).toContainEqual({ from: "/about", to: "/about-us" });
    expect(DEFAULT_ALIASES).toContainEqual({ from: "/mystory", to: "/my-story" });
  });
});

describe("the registry", () => {
  it("flattens children and answers isKnownPage", () => {
    expect(isKnownPage("/donate/thank-you")).toBe(true);
    expect(isKnownPage("/ball/terms")).toBe(true);
    expect(isKnownPage("/made-up")).toBe(false);
  });

  it("never lists an admin or token page", () => {
    for (const p of ALL_PAGES) {
      expect(p.path).not.toMatch(/^\/(admin|invite|reset|business|portal\/access)/);
    }
  });
});

describe("renderSitemapTree", () => {
  it("renders nested links for every page when the ball is open", () => {
    const html = renderSitemapTree(SITE_PAGES, true);
    expect(html).toContain('href="/donate"');
    expect(html).toContain('href="/donate/thank-you"');
    expect(html).toContain('href="/ball"');
    expect(html).toContain(">Festive Ball<");
  });

  it("hides the ball pages entirely while the gate is shut — an unannounced event must not leak", () => {
    const html = renderSitemapTree(SITE_PAGES, false);
    expect(html).not.toContain("/ball");
    expect(html).toContain('href="/donate"');
  });
});

describe("renderSitemapXml", () => {
  it("lists default-listed pages as absolute URLs and omits the unlisted-by-default ones", () => {
    const xml = renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), true);
    expect(xml).toContain("<loc>https://nbcc.scot/</loc>");
    expect(xml).toContain("<loc>https://nbcc.scot/about-us</loc>");
    expect(xml).not.toContain("/donor-portal"); // unlisted by default
    expect(xml).not.toContain("/donate/thank-you"); // post-payment page, unlisted by default
  });

  it("honours the admin's overrides in both directions", () => {
    const overrides = new Map<string, boolean>([
      ["/about-us", false], // an admin hid a default-listed page
      ["/donor-portal", true], // and showed a default-hidden one
    ]);
    const xml = renderSitemapXml(SITE_PAGES, "https://nbcc.scot", overrides, true);
    expect(xml).not.toContain("/about-us");
    expect(xml).toContain("<loc>https://nbcc.scot/donor-portal</loc>");
  });

  it("keeps ball pages out while the gate is shut, whatever the overrides say", () => {
    const xml = renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map([["/ball", true]]), false);
    expect(xml).not.toContain("/ball");
  });
});
