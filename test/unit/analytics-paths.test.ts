import { describe, it, expect } from "vitest";
import { canonicalPath } from "../../src/analytics/paths";
import { ALL_PAGES } from "../../src/site/pages";

// TASK-479: the path kept for a page view is the page's own canonical address from the site map,
// or "other". A query string or anything after it never survives, so a token in an address can
// never reach the analytics tables.

describe("canonicalPath", () => {
  it.each(ALL_PAGES.map((p) => p.path))("keeps the site map's own page %s", (path) => {
    expect(canonicalPath(path)).toBe(path);
  });

  it("keeps the home page", () => {
    expect(canonicalPath("/")).toBe("/");
  });

  it("drops a query string and a fragment", () => {
    expect(canonicalPath("/donate?token=abc123&utm_source=newsletter")).toBe("/donate");
    expect(canonicalPath("/about-us#team")).toBe("/about-us");
  });

  it("ignores a trailing slash and capital letters", () => {
    expect(canonicalPath("/donate/")).toBe("/donate");
    expect(canonicalPath("/About-Us")).toBe("/about-us");
  });

  it("keeps the unlisted public pages that carry the script", () => {
    expect(canonicalPath("/sitemap")).toBe("/sitemap");
    expect(canonicalPath("/business/thank-you")).toBe("/business/thank-you");
  });

  it("files every Gift Aid form under one path, never its token", () => {
    expect(canonicalPath("/api/gift-aid/0123456789abcdef")).toBe("/gift-aid/declare");
    expect(canonicalPath("/gift-aid/declare")).toBe("/gift-aid/declare");
  });

  it.each([
    "/no-such-page",
    "/thank-you/letter/secret-token",
    "/admin",
    "/donor-portal-typo",
    "",
    "not a path",
    "https://example.com/donate",
  ])("calls anything else other: %s", (path) => {
    expect(canonicalPath(path)).toBe("other");
  });
});
