// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// TASK-402: every public page must wear the site's own page shell.
//
// Why this test exists. The privacy notice, the site map and the 404 were each built from class
// names that no stylesheet had ever heard of - .privacy-intro, .privacy-body, .privacy-actions,
// .page-sections, .sitemap-tree. Nothing was broken in a way a build could see: the HTML was
// valid, the CSS was valid, the pages served a 200. They simply had no container, so the copy ran
// edge to edge, and no nav-clearing section, so the heading sat underneath the fixed header. The
// privacy notice - a legal page - was live in that state.
//
// It happened three times because the second and third pages were copied from the first. Nothing
// in the repo could tell that a page had been assembled from invented parts, so this test does:
// it is the difference between "we fixed three pages" and "a fourth cannot happen".

const ROOT = resolve(__dirname, "../..");
const html = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const parse = (f: string) => new DOMParser().parseFromString(html(f), "text/html");

/**
 * A page carries its own shell and its own stylesheet, so the shared contract does not apply.
 * Exemptions are named here, with a reason, rather than the test quietly skipping anything it
 * cannot classify.
 */
const OWN_SHELL: Record<string, string> = {
  "business-thank-you.html": "token-gated standalone page with its own business-thankyou.css",
  "admin.html": "the staff tool, outside the marketing shell entirely",
  "set-password.html": "a single-purpose form reached only from an emailed link",
};

const PAGES = readdirSync(ROOT)
  .filter((f) => f.endsWith(".html") && !(f in OWN_SHELL))
  .sort();

/**
 * The two shells the site actually has:
 *
 *  - BOXED: <main class="site-main site-main--boxed"> is itself the container. It sets the
 *    max-width, the side padding and the top padding that clears the fixed nav, so its sections
 *    need no .wrap of their own.
 *  - WRAPPED: <main class="site-main"> holds full-bleed <section>s, each of which puts its
 *    content inside a .wrap. The first section carries the top padding that clears the nav.
 *
 * There is no third option, and a page that is neither is a page nobody gave a container to.
 */
const NAV_CLEARING = ["page-top", "hero", "ball-hero"];

describe("every public page wears the site's page shell (TASK-402)", () => {
  it("finds the pages to check", () => {
    expect(PAGES.length).toBeGreaterThan(10);
    expect(PAGES).toContain("privacy.html");
    expect(PAGES).toContain("404.html");
    expect(PAGES).toContain("sitemap.html");
  });

  describe.each(PAGES)("%s", (page) => {
    const doc = parse(page);
    const main = doc.querySelector("main.site-main");
    const boxed = !!main?.classList.contains("site-main--boxed");

    it("has a <main class='site-main'>", () => {
      expect(main, "no <main class='site-main'> - the page is not on the shared shell").not.toBeNull();
    });

    // The failure the three broken pages actually had: no container anywhere, so every line of
    // copy ran the full width of the browser window.
    it("gives its content a container", () => {
      if (boxed) return; // site-main--boxed IS the container
      expect(
        main!.querySelectorAll(".wrap").length,
        "no .wrap inside <main>: content will run edge to edge on a wide screen",
      ).toBeGreaterThan(0);
    });

    // The other half of the failure: the header is fixed, so the first section has to make room
    // for it or the page's own <h1> is hidden behind the logo.
    it("clears the fixed header", () => {
      if (boxed) return; // site-main--boxed carries the nav-clearing top padding itself
      const first = main!.querySelector("section");
      expect(first, "no <section> inside <main>").not.toBeNull();
      const classes = [...first!.classList];
      expect(
        NAV_CLEARING.some((c) => classes.includes(c)),
        `first section is "${classes.join(" ")}" - it needs one of ${NAV_CLEARING.join(", ")} ` +
          "or the heading sits underneath the fixed nav",
      ).toBe(true);
    });

    // Every section between the first and the footer needs its own container, not just the first.
    it("wraps every full-bleed section, not only the first", () => {
      if (boxed) return;
      for (const section of main!.querySelectorAll(":scope > section")) {
        const classes = [...section.classList];
        // The hero sections carry their own internal layout.
        if (classes.some((c) => c.endsWith("hero"))) continue;
        // An empty section holds nothing to contain. about.html keeps one deliberately as a
        // marker slot (five about-* tests assert it), so this is a real case, not a loophole.
        if (section.childElementCount === 0) continue;
        expect(
          section.querySelector(".wrap"),
          `<section class="${classes.join(" ")}"> has no .wrap`,
        ).not.toBeNull();
      }
    });
  });
});

// The rule beneath the rule: a class in the markup that no stylesheet defines is a page built
// from parts that do not exist. Checked only for the three pages this bit, because the older
// pages carry legacy names the footer and nav style by [data-region] instead - widening it is a
// separate clean-up, and a test that fails for reasons nobody will act on gets switched off.
describe("the text-only pages use classes that actually exist (TASK-402)", () => {
  // Read exactly the stylesheets these pages link, so the test proves what the browser gets.
  const css = ["assets/css/styles.css", "assets/css/pages.css", "assets/css/ball.css"]
    .map((f) => readFileSync(resolve(ROOT, f), "utf8"))
    .join("");
  const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

  // Styled through an attribute selector or added by main.js at runtime, not by class name.
  const NOT_BY_CLASS = new Set(["site-footer", "foot-col", "foot-logo", "site-main"]);

  it.each(["404.html", "privacy.html", "sitemap.html"])("%s", (page) => {
    const doc = parse(page);
    const main = doc.querySelector("main.site-main")!;
    const used = new Set<string>();
    for (const el of main.querySelectorAll("[class]")) {
      for (const c of el.classList) used.add(c);
    }
    const orphans = [...used].filter((c) => !defined.has(c) && !NOT_BY_CLASS.has(c));
    expect(orphans, `classes with no CSS behind them: ${orphans.join(", ")}`).toEqual([]);
  });
});
