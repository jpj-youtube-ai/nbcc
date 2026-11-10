import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Elf Detective School is always called Elf Detective School, never "the school".
//
// Jaimie, 10 November 2026: NBCC takes referrals from schools, so "school" on its own reads as a
// real school, and "Join the school" on a button was confusing. "If you're actually talking about a
// school, then just use the word school. But if you're talking about the elf detective school, then
// use the full elf detective school."
//
// So this reads every file of the game (its pages, emails, scripts and routes, and Head Elf HQ's
// script) with the code comments taken out, and fails on the ways the words have said "the school"
// for the game: "the school", "school's", "school is" and "school starts", unless "Elf Detective"
// comes just before. A real school can still be named ("never a real surname, school or age",
// "school days", "in the school holidays"), because none of those are ways of naming the game.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// "the school holidays" and "the school day" are real schools' days, as in the clue times.
const SHORT_NAME = /(?<!Detective )\b(?:the school(?!\s+(?:holidays?|days?|terms?)\b)|school's|school is|school starts)\b/gi;

/** The text with block comments and line comments taken out: what a visitor or a head elf can read. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

function shortNames(text: string): string[] {
  return [...withoutComments(text).matchAll(SHORT_NAME)].map((m) => m[0]);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

const gameScripts = readdirSync(resolve(ROOT, "assets/js"))
  .filter((f) => /^elf-.*\.js$/.test(f))
  .map((f) => resolve(ROOT, "assets/js", f));

const files = [
  ...filesUnder(resolve(ROOT, "src/elf")),
  resolve(ROOT, "src/routes/elf.ts"),
  resolve(ROOT, "src/routes/admin-elf.ts"),
  resolve(ROOT, "assets/js/admin/elf-hq.js"),
  ...gameScripts,
].map((f) => relative(ROOT, f).replace(/\\/g, "/"));

describe("Elf Detective School's name", () => {
  it("the check catches the short names the words have used", () => {
    expect(shortNames("Join the school")).toEqual(["the school"]);
    expect(shortNames("The school is live")).toEqual(["The school"]);
    expect(shortNames("School starts on Tuesday 1 December at 5:30pm")).toEqual(["School starts"]);
    expect(shortNames("aria-label: The school's switch")).toEqual(["The school"]);
    expect(shortNames("the elf school's switch")).toEqual(["school's"]);
  });

  it("the check lets the full name and real schools through", () => {
    expect(shortNames("Join Elf Detective School")).toEqual([]);
    expect(shortNames("Elf Detective School is live. Elf Detective School's switch.")).toEqual([]);
    expect(shortNames("Elf Detective School starts on Tuesday 1 December")).toEqual([]);
    expect(shortNames("Just a first name for each. Never a real surname, school or age.")).toEqual([]);
    expect(shortNames("We never ask for a real surname, a school or an age.")).toEqual([]);
    expect(shortNames("5:30pm on school days, 10am at weekends and in the school holidays")).toEqual([]);
  });

  it("the check reads the words, not the code comments", () => {
    expect(shortNames("// everything here is 404 while the school is off\nconst on = true;")).toEqual([]);
    expect(shortNames("/** May this browser see the school? */ const x = 1;")).toEqual([]);
    expect(shortNames('const url = "https://nbcc.scot/elf"; const words = "Join the school";')).toEqual(["the school"]);
  });

  it("finds the game's files to read", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("assets/js/admin/elf-hq.js");
    expect(files).toContain("src/elf/emails.ts");
  });

  it.each(files.map((f) => [f]))("%s calls the game by its full name", (file) => {
    expect(shortNames(readFileSync(resolve(ROOT, file), "utf8"))).toEqual([]);
  });
});
