import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-008 (REQ-003): every page carries the same maroon three-column footer
// (brand+socials, Explore, Ways to give) plus a legal strip with the SCIO line
// and the OSCR registration link for SC047995. Mirrors nav.test.ts (golden
// rules 1 & 5).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const footerOf = (html: string) =>
  html.match(/<footer[^>]*class="site-footer"[\s\S]*?<\/footer>/i)?.[0] ?? "";
const exploreList = (footer: string) =>
  footer.match(/Explore<\/h4>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i)?.[1] ?? "";

const PAGES = [
  "index.html",
  "about.html",
  "donate.html",
  "contact.html",
  "supporters.html",
  "my-story.html",
  "portal.html",
  "privacy.html",
  "gift-aid.html",
  "thank-you.html",
];

// Pages whose footer is byte-identical to index.html's (full brand paragraph,
// "Find us at nbcc.scot" handle line, three-item "Ways to give"). Some pages
// (portal/privacy/gift-aid/thank-you) ship a legitimately shorter footer (no
// handle line, only two "Ways to give" items) and are intentionally excluded
// from the byte-identity group below.
const IDENTICAL_FOOTER_GROUP = ["index.html", "about.html", "donate.html", "contact.html", "supporters.html", "my-story.html"];

describe.each(PAGES)("%s footer", (file) => {
  const footer = footerOf(read(file));

  it("fills the footer region", () => {
    expect(footer).not.toBe("");
    expect(footer).toMatch(/data-region="footer"/);
  });

  it("has the three columns (brand+socials, Explore, Ways to give)", () => {
    expect(footer).toMatch(/class="foot-brand"/);
    expect(footer).toMatch(/class="socials"/);
    expect(footer).toMatch(/<h4>\s*Explore\s*<\/h4>/i);
    expect(footer).toMatch(/<h4>\s*Ways to give\s*<\/h4>/i);
  });

  it("shows the brand logo lockup in the foot-brand column", () => {
    const brand = footer.match(/<div class="foot-brand">[\s\S]*?<div class="socials">/i)?.[0] ?? "";
    // TASK-177: the footer brand logo is the white-lettered SVG (on the maroon footer).
    expect(brand).toMatch(/<img[^>]+src="[^"]*nbcc-logo(-footer\.png|-white\.svg)"[^>]*>/i);
    expect(brand).toMatch(/alt="[^"]+"/);
  });

  it("lists the six Explore links by clean URL", () => {
    const list = exploreList(footer);
    for (const href of ["/", "/about-us", "/donate", "/contact", "/supporters", "/my-story"]) {
      expect(list).toContain(`href="${href}"`);
    }
  });

  it("has a legal strip with the exact charity-registration wording and OSCR link", () => {
    expect(footer).toMatch(/class="legal"/);
    expect(footer).toContain(
      "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.",
    );
    expect(footer).toMatch(
      /Scottish Charity Number\s*<a[^>]*>SC047995<\/a>\.\s*Regulated by the Scottish Charity Regulator, OSCR\./,
    );
    expect(footer).toMatch(/href="[^"]*oscr\.org\.uk[^"]*SC047995[^"]*"/i);
    expect(footer).not.toContain("&copy; 2026");
  });

  it("uses no raw .html inter-page hrefs", () => {
    const raw = [...footer.matchAll(/href="([^"]+\.html[^"]*)"/gi)].map((m) => m[1]);
    expect(raw).toEqual([]);
  });
});

describe("the footer is identical across pages that share the full footer", () => {
  it("is byte-identical", () => {
    const footers = IDENTICAL_FOOTER_GROUP.map((f) => footerOf(read(f)));
    expect(footers.every((f) => f.length > 0)).toBe(true);
    expect(new Set(footers).size).toBe(1);
  });
});

describe("the shorter-footer pages are identical to each other", () => {
  const SHORT_FOOTER_GROUP = PAGES.filter((f) => !IDENTICAL_FOOTER_GROUP.includes(f));

  it("is byte-identical", () => {
    const footers = SHORT_FOOTER_GROUP.map((f) => footerOf(read(f)));
    expect(footers.every((f) => f.length > 0)).toBe(true);
    expect(new Set(footers).size).toBe(1);
  });

  it("still carries the /my-story Explore link", () => {
    for (const file of SHORT_FOOTER_GROUP) {
      const list = exploreList(footerOf(read(file)));
      expect(list, `${file} Explore list`).toContain('href="/my-story"');
    }
  });
});
