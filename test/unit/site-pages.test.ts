import { describe, it, expect } from "vitest";
import {
  SITE_PAGES,
  ALL_PAGES,
  DEFAULT_ALIASES,
  aliasFromProblem,
  aliasToProblem,
  forwardTarget,
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

  // TASK-568: a spare address may also forward to an NBCC subdomain (nbcc.scot/drop to drop.nbcc.scot).
  // Only our own subdomains: if a staff login were misused, an nbcc.scot link still could not be
  // pointed at somebody else's website.
  describe("forwarding to an NBCC subdomain", () => {
    it("stores what staff type as an https address", () => {
      expect(forwardTarget("drop.nbcc.scot")).toBe("https://drop.nbcc.scot");
      expect(forwardTarget("  Drop.NBCC.scot/  ")).toBe("https://drop.nbcc.scot");
      expect(forwardTarget("drop.nbcc.scot/collect/today")).toBe("https://drop.nbcc.scot/collect/today");
      expect(forwardTarget("https://drop.nbcc.scot/collect")).toBe("https://drop.nbcc.scot/collect");
      expect(forwardTarget("http://drop.nbcc.scot")).toBe("https://drop.nbcc.scot");
      expect(forwardTarget("shop.events.nbcc.scot")).toBe("https://shop.events.nbcc.scot");
    });

    it("refuses anything that is not an NBCC subdomain, lookalikes included", () => {
      for (const bad of [
        "example.com",
        "nbcc.scot.example.com",
        "evilnbcc.scot",
        "drop.nbcc.scot.example.com",
        "drop.nbcc.scot@example.com",
        "https://example.com/drop.nbcc.scot",
        "example.com/.nbcc.scot",
        "drop.nbcc.scot\\@example.com",
        "//example.com",
        "javascript:alert(1)",
        "ftp://drop.nbcc.scot",
        "",
        "drop",
      ]) {
        expect(forwardTarget(bad), bad).toBeNull();
      }
    });

    it("refuses this site itself, which could send a visitor round in a circle", () => {
      for (const bad of ["nbcc.scot", "www.nbcc.scot", "https://www.nbcc.scot/drop", ".nbcc.scot"]) {
        expect(forwardTarget(bad), bad).toBeNull();
      }
    });

    it("refuses a port, a user name, a query, a fragment and odd characters", () => {
      for (const bad of [
        "drop.nbcc.scot:8080",
        "user@drop.nbcc.scot",
        "user:pw@drop.nbcc.scot",
        "drop.nbcc.scot/a?x=1",
        "drop.nbcc.scot/#top",
        "drop.nbcc.scot/a b",
        "drop.nbcc.scot/<script>",
        "drop.nbcc.scot/" + "a".repeat(300),
      ]) {
        expect(forwardTarget(bad), bad).toBeNull();
      }
    });

    it("accepts a stored subdomain address as a destination, and nothing unstored", () => {
      expect(aliasToProblem("https://drop.nbcc.scot")).toBeNull();
      expect(aliasToProblem("https://drop.nbcc.scot/collect")).toBeNull();
      expect(aliasToProblem("drop.nbcc.scot")).not.toBeNull(); // not yet in its stored form
      expect(aliasToProblem("https://example.com")).not.toBeNull();
      expect(aliasToProblem("http://drop.nbcc.scot")).not.toBeNull();
    });
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

// TASK-453: the Events page is switched on and off from the admin. Off, it is a 404 - so a search
// engine offered it would be offered a dead link, and the site map would show a page that is not
// there. TASK-494 renamed it Get involved, at /get-involved; /events redirects there.
describe("the Get involved page in the site maps", () => {
  it("is a real page, and no spare address may take its place or its old address", () => {
    expect(isKnownPage("/get-involved")).toBe(true);
    expect(isKnownPage("/events")).toBe(false);
    expect(aliasFromProblem("/get-involved")).not.toBeNull();
    expect(aliasFromProblem("/events")).not.toBeNull();
  });

  it("is left out of both maps while the page is switched off", () => {
    expect(renderSitemapTree(SITE_PAGES, true)).not.toContain('href="/get-involved"');
    expect(renderSitemapTree(SITE_PAGES, true, false)).not.toContain('href="/get-involved"');
    expect(
      renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map([["/get-involved", true]]), true, false),
    ).not.toContain("/get-involved");
  });

  it("is in both maps once the page is switched on, named Get involved", () => {
    expect(renderSitemapTree(SITE_PAGES, false, true)).toContain('<a href="/get-involved">Get involved</a>');
    expect(renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), false, true)).toContain(
      "<loc>https://nbcc.scot/get-involved</loc>",
    );
  });
});

// TASK-494: the sign up form is a page of its own while fundraising is switched on.
describe("the fundraising sign up in the site maps", () => {
  it("is a real page, and nothing under /fundraise may become a spare address", () => {
    expect(isKnownPage("/fundraise")).toBe(true);
    expect(aliasFromProblem("/fundraise")).not.toBeNull();
    expect(aliasFromProblem("/fundraise/my-walk")).not.toBeNull();
  });

  it("is listed only while fundraising is switched on", () => {
    expect(renderSitemapTree(SITE_PAGES, true, true)).not.toContain('href="/fundraise"');
    expect(renderSitemapTree(SITE_PAGES, true, true, true)).toContain('<a href="/fundraise">Fundraise for us</a>');
    expect(renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), true, true)).not.toContain("/fundraise<");
    expect(renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), true, true, true)).toContain(
      "<loc>https://nbcc.scot/fundraise</loc>",
    );
  });

  it("does not depend on the Get involved page being on", () => {
    expect(renderSitemapTree(SITE_PAGES, false, false, true)).toContain('href="/fundraise"');
  });
});

// TASK-498: the fundraising help page, listed like the sign up and only while fundraising is on.
describe("the fundraising help page in the site maps", () => {
  it("is a real page", () => {
    expect(isKnownPage("/fundraise/help")).toBe(true);
    expect(aliasFromProblem("/fundraise/help")).not.toBeNull();
  });

  it("is listed under the sign up only while fundraising is switched on", () => {
    expect(renderSitemapTree(SITE_PAGES, true, true)).not.toContain('href="/fundraise/help"');
    expect(renderSitemapTree(SITE_PAGES, true, true, true)).toContain('<a href="/fundraise/help">Fundraising help</a>');
    expect(renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), true, true)).not.toContain("/fundraise/help");
    expect(renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), true, true, true)).toContain(
      "<loc>https://nbcc.scot/fundraise/help</loc>",
    );
  });
});
