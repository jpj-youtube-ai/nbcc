// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// How NBCC describes itself, word for word (Jaimie, October 2026). Two versions: the short one, and
// the full one where there is room. These are the charity's own words, so the pages are held to them
// exactly: "volunteer led" (never "volunteer run"), "South West Scotland", "a full red bag".
// The footer's copy is held by test/unit/footer-master.test.ts.

const SHORT =
  "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland.";
const FULL =
  "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland, " +
  "with school clothing and crisis support whenever it is needed, and every December a full red bag for those who would " +
  "otherwise wake up on Christmas morning with nothing to open.";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const page = (file: string) => new DOMParser().parseFromString(readFileSync(resolve(ROOT, file), "utf8"), "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const meta = (doc: Document, key: string) =>
  doc.querySelector(`meta[name="${key}"], meta[property="${key}"]`)?.getAttribute("content") ?? "";

describe("the home page", () => {
  const doc = page("index.html");

  it("opens with the short description", () => {
    expect(norm(doc.querySelector("main .lede")?.textContent)).toBe(SHORT);
  });

  it("keeps where we are in the small heading, as volunteer led", () => {
    expect(norm(doc.querySelector("main .eyebrow")?.textContent)).toBe("Volunteer led Scottish charity · Annbank, Ayrshire");
  });

  it("is described to search engines by the short description and the charity number", () => {
    expect(meta(doc, "description")).toBe(`${SHORT} Scottish charity SC047995.`);
  });

  it("is described by the short description when shared", () => {
    expect(meta(doc, "og:description")).toBe(SHORT);
    expect(meta(doc, "twitter:description")).toBe(SHORT);
  });
});

describe("the About page", () => {
  const doc = page("about.html");

  it("opens with the full description, then where we are and how far we reach", () => {
    expect(norm(doc.querySelector(".lede")?.textContent)).toBe(`${FULL} We are based in Annbank, Ayrshire, and reach from Girvan to Largs.`);
  });

  it("is described to search engines and when shared by the short description and where we are", () => {
    const words = `${SHORT} Based in Annbank, Ayrshire.`;
    expect(meta(doc, "description")).toBe(words);
    expect(meta(doc, "og:description")).toBe(words);
    expect(meta(doc, "twitter:description")).toBe(words);
    // What a search result shows before it is cut short.
    expect(words.length).toBeLessThanOrEqual(160);
  });
});

describe("volunteer led, not volunteer run", () => {
  it.each(["index.html", "about.html", "privacy.html"])("%s", (file) => {
    const text = norm(readFileSync(resolve(ROOT, file), "utf8"));
    expect(text).not.toMatch(/volunteer[ -]run/i);
  });

  it("the privacy notice names what NBCC is, as volunteer led", () => {
    expect(norm(page("privacy.html").body.textContent)).toContain("NBCC is a volunteer led Scottish Charitable Incorporated Organisation (SCIO)");
  });
});
