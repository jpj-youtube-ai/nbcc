import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { POSTAL_ADDRESS_LINES } from "../../src/legal/registration";

// The building has one name, and it is written one way: The Elves' Workshop.
//
// It is the workshop of the elves, more than one of them, so the apostrophe goes after the s. And
// it is a straight apostrophe, not a curly one and not an HTML entity, because
// contact-address.test.ts holds contact.html to the address constant letter for letter.
//
// Before this test the site had three spellings at once: "The Elves Workshop" in every page
// footer and every email, "Elves Workshop" on the thank-you letterhead, and "The Elves' Workshop"
// on the printed fundraising pieces. Nothing tied them together, which is how they drifted. This
// reads every top-level page and everything under src/ and fails on any spelling but the one.
//
// It only looks at the two words themselves. Whether "the" in front has a capital depends on the
// sentence ("post it to The Elves' Workshop, Annbank Village Hall", "volunteers at the Elves'
// Workshop"), so that is left to the person writing.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RIGHT = "Elves' Workshop";

// Any way of writing the name: Elf or Elves, whatever punctuation or entity follows (an
// apostrophe either side of the s, a curly one, &rsquo;, &#39;), then Workshop.
const ANY_SPELLING = /\bel(?:f|ve)[^\s<>]{0,12}\s+workshop/gi;

function wrongSpellings(text: string): string[] {
  return [...text.matchAll(ANY_SPELLING)].map((m) => m[0]).filter((found) => found !== RIGHT);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

const pages = readdirSync(ROOT)
  .filter((f) => f.endsWith(".html"))
  .map((f) => resolve(ROOT, f));
const sources = filesUnder(resolve(ROOT, "src"));
const files = [...pages, ...sources].map((f) => relative(ROOT, f).replace(/\\/g, "/"));

describe("the name of the building", () => {
  it("is The Elves' Workshop in the registered address", () => {
    expect(POSTAL_ADDRESS_LINES[0]).toBe("The Elves' Workshop");
  });

  it("the check catches the spellings that have been on the site", () => {
    expect(wrongSpellings("The Elves Workshop")).toEqual(["Elves Workshop"]);
    expect(wrongSpellings("the Elve's Workshop")).toEqual(["Elve's Workshop"]);
    expect(wrongSpellings("The Elf's Workshop")).toEqual(["Elf's Workshop"]);
    expect(wrongSpellings("The Elves’ Workshop")).toEqual(["Elves’ Workshop"]);
    expect(wrongSpellings("The Elves&rsquo; Workshop")).toEqual(["Elves&rsquo; Workshop"]);
    expect(wrongSpellings("The Elves&#39; Workshop")).toEqual(["Elves&#39; Workshop"]);
    expect(wrongSpellings("the elves' workshop")).toEqual(["elves' workshop"]);
    expect(wrongSpellings("at the Elves' Workshop, and The Elves' Workshop")).toEqual([]);
  });

  it("finds pages and source files to read", () => {
    expect(pages.length).toBeGreaterThan(10);
    expect(sources.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [f]))("%s writes it no other way", (file) => {
    expect(wrongSpellings(readFileSync(resolve(ROOT, file), "utf8"))).toEqual([]);
  });
});
