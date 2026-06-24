import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// REQ-001: the static marketing site is four standalone HTML5 documents at the
// repo root that all share ONE stylesheet and ONE script. These tests encode the
// issue's acceptance check so the scaffold can't silently drift (golden rule 1).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const CSS_PATH = "assets/css/styles.css";
const JS_PATH = "assets/js/main.js";

const PAGES = [
  { file: "index.html", label: "Home" },
  { file: "about.html", label: "About" },
  { file: "donate.html", label: "Donate" },
  { file: "contact.html", label: "Contact" },
] as const;

function readOrEmpty(rel: string): string {
  const abs = resolve(ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}

function titleOf(html: string): string {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  return m ? m[1].trim() : "";
}

function cssHrefs(html: string): string[] {
  return [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/gi)].map((m) => m[1]);
}

function jsSrcs(html: string): string[] {
  return [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/gi)].map((m) => m[1]);
}

describe("static site shared assets", () => {
  it("ships exactly one shared stylesheet and one shared script", () => {
    expect(existsSync(resolve(ROOT, CSS_PATH))).toBe(true);
    expect(existsSync(resolve(ROOT, JS_PATH))).toBe(true);
  });
});

for (const { file, label } of PAGES) {
  describe(file, () => {
    const html = readOrEmpty(file);

    it("exists at the repo root", () => {
      expect(existsSync(resolve(ROOT, file))).toBe(true);
    });

    it("is a complete standalone HTML5 document", () => {
      expect(html.trimStart()).toMatch(/^<!doctype html>/i);
      expect(html).toMatch(/<html\s+lang="/i);
      expect(html).toMatch(/<head[\s>]/i);
      expect(html).toMatch(/<meta\s+charset="utf-8"/i);
      expect(html).toMatch(/name="viewport"/i);
      expect(html).toMatch(/<body[\s>]/i);
      expect(html).toMatch(/<\/body>\s*<\/html>/i);
    });

    it("has a non-empty, page-distinguishing <title>", () => {
      const title = titleOf(html);
      expect(title.length).toBeGreaterThan(0);
      expect(title).toContain(label);
    });

    it("links the one shared stylesheet, and no other CSS", () => {
      expect(html).toContain(`<link rel="stylesheet" href="${CSS_PATH}"`);
      expect(cssHrefs(html)).toEqual([CSS_PATH]);
    });

    it("loads the one shared script with defer, and no other JS", () => {
      expect(html).toContain(`<script defer src="${JS_PATH}"></script>`);
      expect(jsSrcs(html)).toEqual([JS_PATH]);
    });

    it("has no inline <style> or inline <script> blocks", () => {
      expect(html).not.toMatch(/<style[\s>]/i);
      const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
      for (const tag of scripts) {
        expect(tag).toMatch(/\ssrc=/i);
      }
    });
  });
}

describe("the four pages together", () => {
  it("each have a distinct <title>", () => {
    const titles = PAGES.map(({ file }) => titleOf(readOrEmpty(file)));
    const nonEmpty = titles.filter((t) => t.length > 0);
    expect(new Set(nonEmpty).size).toBe(PAGES.length);
  });

  it("all reference the exact same single CSS path", () => {
    const all = PAGES.flatMap(({ file }) => cssHrefs(readOrEmpty(file)));
    expect(all).toHaveLength(PAGES.length);
    expect(new Set(all)).toEqual(new Set([CSS_PATH]));
  });

  it("all reference the exact same single JS path", () => {
    const all = PAGES.flatMap(({ file }) => jsSrcs(readOrEmpty(file)));
    expect(all).toHaveLength(PAGES.length);
    expect(new Set(all)).toEqual(new Set([JS_PATH]));
  });
});
