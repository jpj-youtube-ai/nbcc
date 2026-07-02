// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-040 (REQ-031): a sitewide guard for the NBCC house style across the
// marketing pages' VISIBLE copy — the text content of <body> plus the
// alt / title / aria-label / placeholder attributes; NOT URLs, mailto:/tel:
// hrefs, data-* attributes, code / SVG path data, or HTML comments. Rules:
//   1. no dash characters in visible copy: hyphen-minus '-' between word
//      characters, en dash '–', em dash '—';
//   2. the string 'NB4CC' never appears anywhere (use 'NBCC');
//   3. wherever beneficiaries are described, the full phrasing
//      'children, young people and vulnerable adults' is used — no truncated
//      variants (e.g. 'children and young people').
// DB-free; mirrors the structural HTML scan of perf-budget / seo-metadata tests.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

// supporters.html and thank-you.html are guarded defensively — scanned only if/when
// they exist.
const PAGES = [
  "index.html",
  "about.html",
  "donate.html",
  "contact.html",
  "supporters.html",
  "thank-you.html",
].filter((f) => existsSync(resolve(ROOT, f)));

const VISIBLE_ATTRS = ["alt", "title", "aria-label", "placeholder"];
const FULL_PHRASE = "children, young people and vulnerable adults";

// The rendered, human-visible copy of a page: <body> text (with script / style /
// svg stripped, so code and path data never count) plus the four human-facing
// attributes. URLs, mailto:/tel: hrefs and data-* attributes are excluded by
// reading only those attributes and the text nodes. Comments are not part of
// textContent. The result is whitespace-normalised.
function visibleCopy(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  body.querySelectorAll("script, style, svg").forEach((el) => el.remove());
  const parts: string[] = [body.textContent ?? ""];
  for (const attr of VISIBLE_ATTRS) {
    for (const el of body.querySelectorAll(`[${attr}]`)) {
      parts.push(el.getAttribute(attr) ?? "");
    }
  }
  return parts.join("  ").replace(/\s+/g, " ").trim();
}

const occurrences = (s: string, sub: string): number => (sub ? s.split(sub).length - 1 : 0);

describe.each(PAGES)("copy rules (REQ-031): %s", (page) => {
  const raw = read(page);
  const copy = visibleCopy(raw);
  const lower = copy.toLowerCase();

  it("has no en dash or em dash in visible copy", () => {
    const matches = copy.match(/[–—]/g) ?? [];
    expect(matches, `en/em dash(es) in visible copy: ${matches.join(" ")}`).toEqual([]);
  });

  it("has no hyphen between word characters (e.g. one-off, year-round, volunteer-run)", () => {
    const matches = copy.match(/\w-\w/g) ?? [];
    expect(matches, `hyphenated word(s) in visible copy: ${[...new Set(matches)].join(", ")}`).toEqual(
      [],
    );
  });

  it("never contains 'NB4CC' (the campaign is 'NBCC')", () => {
    expect(raw.includes("NB4CC")).toBe(false);
  });

  it("uses the full beneficiary phrasing where beneficiaries are described", () => {
    const refsBeneficiaries = /young people|vulnerable adults/i.test(lower);
    if (!refsBeneficiaries) return;

    // The exact phrase must be present...
    expect(lower).toContain(FULL_PHRASE);
    // ...and every mention of the beneficiary groups must sit inside it, so no
    // truncated variant ("children and young people", "young people" alone) leaks.
    expect(occurrences(lower, "young people")).toBe(occurrences(lower, FULL_PHRASE));
    expect(occurrences(lower, "vulnerable adults")).toBe(occurrences(lower, FULL_PHRASE));
    expect(lower).not.toContain("children and young people");
  });
});

it("scans at least the four core marketing pages", () => {
  for (const f of ["index.html", "about.html", "donate.html", "contact.html"]) {
    expect(PAGES).toContain(f);
  }
});
