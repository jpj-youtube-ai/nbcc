import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addElfCard, renderElfCard, ELF_CARD_ANCHORS, ELF_CARD_STYLES, type ElfCardPage } from "../../src/elf/promo";
import { SCHOOL_LOGO_SRC } from "../../src/elf/logo";
import { addFillStageToHome, renderFillStage } from "../../src/red-bag/stage";

// The card that sends people to the Elf Detective School (/elf) from the home page, Get involved and
// Your school, drawn only while the school is switched on (Jaimie, 9 November 2026: nothing on the
// site linked to the school). How it reaches the pages through the real routes is in
// elf-promo-routes.test.ts.

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const FILES: Record<ElfCardPage, string> = {
  home: "index.html",
  "get-involved": "get-involved.html",
  schools: "get-involved-schools.html",
};
const PAGES = Object.keys(FILES) as ElfCardPage[];
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
// What a visitor reads: the tags gone, the few entities the card uses turned back into letters.
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("the elf school's card", () => {
  it("goes to the school, and nowhere else", () => {
    for (const page of PAGES) {
      const hrefs = [...renderElfCard(page).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
      expect(hrefs).toEqual(["/elf"]);
    }
  });

  it("says what the school is, in the words drafted for Jaimie's yes", () => {
    const card = renderElfCard("home");
    expect(card).toContain(">New this Christmas<");
    // A straight apostrophe, as the building's name is written everywhere (elves-workshop-name.test.ts).
    expect(card).toContain(">24 cheeky elves have escaped from the Elves' Workshop<");
    expect(card).toContain(">Join Elf Detective School, crack the clues and find them all by the Night Before Christmas.<");
    expect(words(card)).toContain("Find out more about Elf Detective School");
  });

  it("is a section named by its own heading, with the school's logo saying nothing a screen reader would hear twice", () => {
    for (const page of PAGES) {
      const card = renderElfCard(page);
      const labelledBy = card.match(/<section[^>]*aria-labelledby="([^"]+)"/)?.[1];
      expect(labelledBy).toBeTruthy();
      expect(card).toMatch(new RegExp(`<h2[^>]*id="${labelledBy}"`));
      const logo = card.match(/<img[^>]*>/)?.[0] ?? "";
      expect(logo).toContain(`src="${SCHOOL_LOGO_SRC}"`);
      expect(logo).toContain('alt=""');
      expect(logo).toMatch(/width="\d+"/);
      expect(logo).toMatch(/height="\d+"/);
      expect(logo).toContain('loading="lazy"');
    }
  });

  it("gives a school the address to put in a letter home, and only on Your school", () => {
    expect(words(renderElfCard("schools"))).toContain("Telling families at your school? Send them to nbcc.scot/elf");
    expect(renderElfCard("home")).not.toContain("nbcc.scot/elf");
    expect(renderElfCard("get-involved")).not.toContain("nbcc.scot/elf");
  });

  it("keeps the house rules for public words", () => {
    for (const page of PAGES) {
      const said = words(renderElfCard(page));
      expect(said).not.toMatch(/[–—]/);
      expect(said).not.toMatch(/\s-\s/);
      // No hyphenated words. The address nbcc.scot/elf has none either.
      expect(said).not.toMatch(/[A-Za-z]-[A-Za-z]/);
      expect(said.toLowerCase()).not.toContain("on the shelf");
      expect(said).toContain("Elves' Workshop");
    }
  });
});

describe("adding the card to a page", () => {
  it("finds its place exactly once in each page's own file", () => {
    for (const page of PAGES) expect(count(read(FILES[page]), ELF_CARD_ANCHORS[page])).toBe(1);
  });

  it("leaves the page byte for byte as it was while the school is switched off", () => {
    for (const page of PAGES) {
      const html = read(FILES[page]);
      expect(addElfCard(html, page, false)).toBe(html);
    }
  });

  it("puts the card straight before its place, with its own styles in the head, when the school is on", () => {
    for (const page of PAGES) {
      const out = addElfCard(read(FILES[page]), page, true);
      expect(count(out, 'id="elfCard"')).toBe(1);
      expect(out.indexOf('id="elfCard"')).toBeLessThan(out.indexOf(ELF_CARD_ANCHORS[page]));
      expect(count(out, ELF_CARD_STYLES)).toBe(1);
      expect(out.indexOf(ELF_CARD_STYLES)).toBeLessThan(out.indexOf("</head>"));
    }
  });

  it("never adds a second card or a second stylesheet", () => {
    for (const page of PAGES) {
      const once = addElfCard(read(FILES[page]), page, true);
      expect(addElfCard(once, page, true)).toBe(once);
    }
  });

  it("on the home page, sits after Fill a Red Bag and before the four ways to start", () => {
    const out = addElfCard(addFillStageToHome(read("index.html"), renderFillStage(null)), "home", true);
    expect(out.indexOf('id="fillBand"')).toBeGreaterThan(-1);
    expect(out.indexOf('id="fillBand"')).toBeLessThan(out.indexOf('id="elfCard"'));
    expect(out.indexOf('id="elfCard"')).toBeLessThan(out.indexOf('<section class="home-lane"'));
  });

  it("leaves a page that has no place for it alone, styles and all", () => {
    const bare = "<!doctype html><html><head><title>x</title></head><body><main></main></body></html>";
    for (const page of PAGES) expect(addElfCard(bare, page, true)).toBe(bare);
  });
});

describe("the card's stylesheet", () => {
  const css = read("assets/css/elf-promo.css");

  it("styles only the card, so it can never change the page around it", () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@media[^{]*\{/g, "")
      .split("}")
      .map((block) => block.split("{")[0].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const group of selectors) {
      for (const selector of group.split(",")) expect(selector.trim()).toMatch(/^\.elfp/);
    }
  });

  it("keeps clear of the patterns the house rules ban", () => {
    // No side stripes, no gradient letters, no inner scrollbars.
    expect(css).not.toMatch(/border-(left|right)\s*:\s*[2-9]/);
    expect(css).not.toMatch(/background-clip\s*:\s*text/);
    expect(css).not.toMatch(/overflow(-y|-x)?\s*:\s*(auto|scroll)/);
  });
});
