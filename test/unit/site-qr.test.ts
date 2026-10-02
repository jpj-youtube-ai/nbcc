import { describe, it, expect } from "vitest";
import { qrSlug, qrLink, qrPath, qrRows } from "../../src/site/qr";
import { SITE_PAGES, type SitePage } from "../../src/site/pages";

// TASK-492: QR codes for every page of the site, in the admin. These are the pure rules: which
// pages get a code, the link a code carries, and which typed addresses are allowed.

describe("the name a page's code is known by", () => {
  it("is the address without its slashes, and home for the home page", () => {
    expect(qrSlug("/")).toBe("home");
    expect(qrSlug("/ball")).toBe("ball");
    expect(qrSlug("/ball/terms")).toBe("ball-terms");
    expect(qrSlug("/about-us")).toBe("about-us");
  });
});

// The tag is how Admin > Analytics tells a scan from a typed address.
describe("the link a code carries", () => {
  it("is the page on nbcc.scot, tagged as a QR scan of that page", () => {
    expect(qrLink("/ball")).toBe("https://nbcc.scot/ball?utm_medium=qr&utm_campaign=ball");
    expect(qrLink("/")).toBe("https://nbcc.scot/?utm_medium=qr&utm_campaign=home");
    expect(qrLink("/ball/terms")).toBe("https://nbcc.scot/ball/terms?utm_medium=qr&utm_campaign=ball-terms");
  });
});

// A code for somebody else's website is not ours to print.
describe("a typed address", () => {
  it("is taken when it is a path on nbcc.scot", () => {
    expect(qrPath("/give")).toBe("/give");
    expect(qrPath("/ball/terms")).toBe("/ball/terms");
    expect(qrPath("/")).toBe("/");
    expect(qrPath(" /Give ")).toBe("/Give");
  });

  it("is refused otherwise", () => {
    for (const bad of ["", "give", "https://evil.example/x", "//evil.example", "/a b", "/x?y=1", "/x#y", "/..", "/a/../b", "/" + "a".repeat(200)]) {
      expect(qrPath(bad), bad).toBeNull();
    }
    expect(qrPath(undefined)).toBeNull();
    expect(qrPath(42)).toBeNull();
  });
});

const allPaths = (pages: SitePage[]): string[] => pages.flatMap((p) => [p.path, ...allPaths(p.children ?? [])]);

describe("the pages that get a code", () => {
  it("is every page in the site's page list, children included, so a new page is never missed", () => {
    const rows = qrRows(SITE_PAGES, { ballOpen: true, eventsOn: true });
    expect(rows.map((r) => r.path)).toEqual(allPaths(SITE_PAGES));
  });

  it("gives each its title and the link its code carries", () => {
    const home = qrRows(SITE_PAGES, { ballOpen: true, eventsOn: true })[0];
    expect(home).toEqual({ path: "/", title: "Home", live: true, link: "https://nbcc.scot/?utm_medium=qr&utm_campaign=home" });
  });

  // Posters can be made before launch, but staff should know the page is not up yet.
  it("marks the Festive Ball and Events pages not live while they are switched off", () => {
    const live = (open: { ballOpen: boolean; eventsOn: boolean }) =>
      Object.fromEntries(qrRows(SITE_PAGES, open).map((r) => [r.path, r.live]));
    const off = live({ ballOpen: false, eventsOn: false });
    expect(off["/ball"]).toBe(false);
    expect(off["/ball/terms"]).toBe(false);
    expect(off["/events"]).toBe(false);
    expect(off["/donate"]).toBe(true);
    const on = live({ ballOpen: true, eventsOn: true });
    expect(on["/ball"]).toBe(true);
    expect(on["/events"]).toBe(true);
  });
});
