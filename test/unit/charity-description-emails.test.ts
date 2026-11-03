import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ABOUT_NBCC_FULL, ABOUT_NBCC_SHORT } from "../../src/email/brand";
import { welcomeDoc } from "../../src/newsletter/welcome";
import { forwardMessage } from "../../src/fundraising/teams";

// How NBCC describes itself in its emails and letters (Jaimie, October 2026): "volunteer led", never
// "volunteer run" or "run entirely by volunteers"; and every December "a full red bag". The pages'
// copy is held by charity-description.test.ts, the footer's by footer-master.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("the charity's own description", () => {
  it("is exact, in both versions", () => {
    expect(ABOUT_NBCC_SHORT).toBe(
      "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland.",
    );
    expect(ABOUT_NBCC_FULL).toBe(
      "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland, " +
        "with school clothing and crisis support whenever it is needed, and every December a full red bag for those who would " +
        "otherwise wake up on Christmas morning with nothing to open.",
    );
  });

  it("opens the newsletter welcome email, in its short form", () => {
    const words = JSON.stringify(welcomeDoc());
    expect(words).toContain(ABOUT_NBCC_SHORT);
    expect(words).not.toMatch(/volunteer[ -]run/i);
  });

  it("is in the team invite people paste into a chat, in the short form's words after the charity's full name", () => {
    const message = forwardMessage({ title: "The Annbank Amblers" }, "https://nbcc.scot/fundraise/join/abc");
    expect(message).toBe(
      "I've set up a team, The Annbank Amblers, to raise money for the Night Before Christmas Campaign (NBCC), a volunteer led " +
        "charity here all year for children, young people and vulnerable adults across South West Scotland. Would you like to join? You get your own page, and " +
        "everything you raise counts towards our team total too. Join here: https://nbcc.scot/fundraise/join/abc",
    );
  });
});

// Every email, letter and page, read as source: the old phrases must not come back. The Festive
// Ball's page keeps its paragraph until after the Ball (7 November 2026), so it is not read here.
function filesUnder(dir: string, ends: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path, ends) : path.endsWith(ends) ? [path] : [];
  });
}
const HELD = new Set(["ball.html"]);
const sources = [
  ...filesUnder(resolve(ROOT, "src"), ".ts"),
  ...readdirSync(ROOT).filter((f) => f.endsWith(".html") && !HELD.has(f)).map((f) => resolve(ROOT, f)),
];
// Read as one line, so a phrase wrapped across two lines of a template is still found.
const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");

describe("the old phrases are gone from every email, letter and page", () => {
  it("reads the emails and the pages", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it.each([
    ["volunteer run", /volunteer[ -]run\b/i],
    ["run entirely by volunteers", /run entirely by volunteers/i],
    ["a full bag for those", /a full bag for those/i],
  ])('nothing says "%s"', (_phrase, pattern) => {
    const found = sources.filter((path) => pattern.test(flat(path))).map((path) => relative(ROOT, path).replace(/\\/g, "/"));
    expect(found).toEqual([]);
  });
});
