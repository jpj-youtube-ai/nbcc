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
  "newsletter.html",
  "gift-aid.html",
  "thank-you.html",
  "ball.html",
  "ball-terms.html",
  "404.html",
  "sitemap.html",
];

// Every page carries the one footer: the full brand paragraph, the "Find us at nbcc.scot" handle
// line and the three-item "Ways to give". It is kept in partials/footer.html and copied into each
// page by scripts/sync-footer.mjs; test/unit/footer-master.test.ts holds every page to it, however
// the page indents it. Some pages (portal, privacy, gift-aid, thank-you, 404, sitemap) once shipped
// a shorter footer; staff asked for one footer everywhere (TASK-326 for the Ball pages, then all).

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

describe("the footer is the same on every page", () => {
  it("is identical, line for line, whatever the page's indentation", () => {
    const lines = (footer: string) => footer.split(/\r?\n/).map((l) => l.trim()).join("\n");
    const footers = PAGES.map((f) => lines(footerOf(read(f))));
    expect(footers.every((f) => f.length > 0)).toBe(true);
    expect(new Set(footers).size).toBe(1);
  });
});
