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

const PAGES = ["index.html", "about.html", "donate.html", "contact.html"];

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

  it("lists the four Explore links by clean URL", () => {
    const list = exploreList(footer);
    for (const href of ["/", "/about-us", "/donate", "/contact"]) {
      expect(list).toContain(`href="${href}"`);
    }
  });

  it("has a legal strip with the SCIO line and an OSCR link for SC047995", () => {
    expect(footer).toMatch(/class="legal"/);
    expect(footer).toMatch(/Scottish Charitable Incorporated Organisation/i);
    expect(footer).toMatch(/href="[^"]*oscr\.org\.uk[^"]*SC047995[^"]*"/i);
    expect(footer).toContain("SC047995");
  });

  it("uses no raw .html inter-page hrefs", () => {
    const raw = [...footer.matchAll(/href="([^"]+\.html[^"]*)"/gi)].map((m) => m[1]);
    expect(raw).toEqual([]);
  });
});

describe("the footer is identical across all four pages", () => {
  it("is byte-identical", () => {
    const footers = PAGES.map((f) => footerOf(read(f)));
    expect(footers.every((f) => f.length > 0)).toBe(true);
    expect(new Set(footers).size).toBe(1);
  });
});
