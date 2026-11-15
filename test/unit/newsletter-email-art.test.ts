import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { EMAIL_ART_FILES } from "../../src/newsletter/paper-blocks";

// The pictures the paper look blocks draw with (assets/img/email, built by scripts/build-email-art.mjs).
// A name the renderers use that is not on disk is a broken picture in hundreds of inboxes, and a heavy
// one is what a reader on a phone signal waits for.

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "assets/img/email");
const files = readdirSync(DIR);
const credits = readFileSync(resolve(ROOT, "assets/img/CREDITS.md"), "utf8");

describe("the email art", () => {
  it.each([...EMAIL_ART_FILES])("%s, which a block draws, is there", (name) => {
    expect(existsSync(resolve(DIR, name))).toBe(true);
  });

  it("is only PNG and JPG: Outlook on a desktop shows no WebP, and Gmail no SVG", () => {
    for (const name of files) expect(name).toMatch(/\.(png|jpg)$/);
  });

  it("keeps a header picture under 150 KB and every small piece under 25 KB", () => {
    for (const name of files) {
      const kb = statSync(resolve(DIR, name)).size / 1024;
      expect(kb, name).toBeLessThan(/^(hero|print)-/.test(name) ? 150 : 25);
    }
  });

  it("is listed in the credits, with what it was made from", () => {
    expect(credits).toContain("scripts/build-email-art.mjs");
    for (const name of files) {
      const listed = credits.includes("`" + name + "`") || (name.startsWith("item-") && credits.includes("`item-<key>.png`"));
      expect(listed, name).toBe(true);
    }
  });
});
