// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRIVATE_PAGES, ALL_PAGES, RESERVED_PREFIXES } from "../../src/site/pages";

// TASK-402: the admin's "Every page" list. Its whole value is being COMPLETE - it exists so a
// page nobody has opened in a year is still visible to the people responsible for it. A list that
// quietly drops a page is worse than no list, because it is trusted.

const ROOT = resolve(__dirname, "../..");
const admin = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");

describe("the private page registry", () => {
  it("names every page in plain English, with a reason to exist", () => {
    for (const p of PRIVATE_PAGES) {
      expect(p.path, "a path is required").toMatch(/^\//);
      expect(p.title.length, `${p.path} needs a title`).toBeGreaterThan(2);
      expect(p.note.length, `${p.path} needs a note a volunteer can read`).toBeGreaterThan(20);
    }
  });

  // The two registries do different jobs. SITE_PAGES feeds /sitemap and sitemap.xml; this one
  // must never reach either. A page in both would leak a private page into the public map.
  it("shares no page with the public registry", () => {
    const publicPaths = new Set(ALL_PAGES.map((p) => p.path));
    for (const p of PRIVATE_PAGES) {
      expect(publicPaths.has(p.path), `${p.path} is in BOTH registries`).toBe(false);
    }
  });

  it("lists no page twice", () => {
    const paths = PRIVATE_PAGES.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  // Every one of these sits under a reserved prefix, which is what stops a spare address ever
  // shadowing it. If one did not, someone could point /admin somewhere else.
  it("keeps every private page inside a reserved prefix", () => {
    for (const p of PRIVATE_PAGES) {
      const covered = RESERVED_PREFIXES.some((r) => p.path === r || p.path.startsWith(`${r}/`));
      expect(covered, `${p.path} is not covered by RESERVED_PREFIXES`).toBe(true);
    }
  });

  // The pages a volunteer would most easily forget, because you cannot reach any of them by
  // clicking around the site. Named individually so removing one is a deliberate act.
  it.each(["/admin", "/business/thank-you", "/gift-aid/declare", "/sitemap"])(
    "remembers %s",
    (path) => {
      expect(PRIVATE_PAGES.some((p) => p.path === path)).toBe(true);
    },
  );
});

describe("the admin shows the complete list", () => {
  it("has the Every page block in the Site pages tab, not a tab of its own", () => {
    const doc = new DOMParser().parseFromString(admin, "text/html");
    const view = doc.getElementById("view-site");
    expect(view?.querySelector("#siteAllTable")).not.toBeNull();
    // One subject, one place: the alias and search-engine controls act on the same pages.
    expect(doc.querySelector('[data-view="site-all"]'), "no separate tab").toBeNull();
  });

  it("renders both halves of the list, not just the public one", () => {
    expect(app).toContain("renderSiteAll(d.pages || [], d.privatePages || [])");
    expect(app).toContain("privatePages");
  });

  // Checking a page is still right means looking at it, so the address is a link.
  it("makes every address clickable", () => {
    expect(app).toMatch(/renderSiteAll[\s\S]*target="_blank"/);
  });

  it("says who can reach a page in words, not in codes", () => {
    for (const phrase of ["Personal link only", "Staff only", "Not listed", "On the site map"]) {
      expect(app, phrase).toContain(phrase);
    }
  });
});
