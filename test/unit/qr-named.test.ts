import { describe, it, expect } from "vitest";
import {
  SIGNUP_SITES,
  cleanName,
  destinationTitle,
  isDestination,
  labelNamedScans,
  namedShortLink,
  namedShortPath,
  namedTarget,
  parseNamedCode,
  qrDestinations,
  scanSummary,
} from "../../src/site/qr-named";
import { qrRows } from "../../src/site/qr";
import { SITE_PAGES } from "../../src/site/pages";

// TASK-588: named QR codes. The pure rules: what the "Goes to" list offers, what a code's link is,
// where a scan goes, and how its scans add up. Invented names only.

const CLOSED = { ballOpen: false, eventsOn: false, fundraisingOn: false };

describe("the Goes to list", () => {
  it("offers every page of the site, children included, then the three sign up sites", () => {
    const list = qrDestinations(SITE_PAGES, CLOSED);
    const pages = qrRows(SITE_PAGES, CLOSED);
    expect(list.filter((d) => d.group === "page").map((d) => d.value)).toEqual(pages.map((p) => p.path));
    expect(list.filter((d) => d.group === "signup").map((d) => d.value)).toEqual([
      "https://drop.nbcc.scot",
      "https://referrals.nbcc.scot",
      "https://vol.nbcc.scot",
    ]);
    expect(list.at(-1)?.group).toBe("signup");
  });

  it("marks a page that is switched off, and never a sign up site", () => {
    const ball = qrDestinations(SITE_PAGES, CLOSED).find((d) => d.value === "/ball");
    expect(ball?.live).toBe(false);
    expect(qrDestinations(SITE_PAGES, { ballOpen: true, eventsOn: true, fundraisingOn: true }).find((d) => d.value === "/ball")?.live).toBe(true);
    expect(qrDestinations(SITE_PAGES, CLOSED).filter((d) => d.group === "signup").every((d) => d.live)).toBe(true);
  });

  it("accepts only the list's own values, exactly", () => {
    expect(isDestination("/donate", SITE_PAGES)).toBe(true);
    expect(isDestination("/ball", SITE_PAGES)).toBe(true);
    expect(isDestination("https://vol.nbcc.scot", SITE_PAGES)).toBe(true);
    for (const bad of ["/donat", "/Donate", "donate", "/donate?x=1", "https://vol.nbcc.scot/", "https://example.com", "", null, 3]) {
      expect(isDestination(bad, SITE_PAGES), String(bad)).toBe(false);
    }
  });

  it("names a destination for the screen, and shows a value that left the list as it is", () => {
    expect(destinationTitle("/donate", SITE_PAGES)).toBe("Donate");
    expect(destinationTitle("https://drop.nbcc.scot", SITE_PAGES)).toBe(SIGNUP_SITES[0].title);
    expect(destinationTitle("/gone-page", SITE_PAGES)).toBe("/gone-page");
  });
});

describe("a named code's link", () => {
  it("is a short link on the public site", () => {
    expect(namedShortPath(12)).toBe("/q/c12");
    expect(namedShortLink(12)).toBe("https://nbcc.scot/q/c12");
  });

  it("reads back only our own short codes, in any case", () => {
    expect(parseNamedCode("c12")).toBe(12);
    expect(parseNamedCode("C12")).toBe(12);
    for (const bad of ["c0", "c012", "12", "12-a4", "f12-a4", "c", "c12x", "c99999999999", "", null, undefined]) {
      expect(parseNamedCode(bad), String(bad)).toBeNull();
    }
  });
});

describe("where a scan goes", () => {
  it("goes to a page with the tags Analytics counts it by", () => {
    expect(namedTarget("/donate", 12)).toBe("https://nbcc.scot/donate?utm_medium=qr&utm_campaign=c12");
    expect(namedTarget("/", 3)).toBe("https://nbcc.scot/?utm_medium=qr&utm_campaign=c3");
  });

  it("goes to a sign up site as it is", () => {
    expect(namedTarget("https://drop.nbcc.scot", 12)).toBe("https://drop.nbcc.scot");
  });

  it("never goes off to somebody else's site, whatever was stored", () => {
    for (const bad of ["https://example.com", "//example.com", "/donate?next=https://example.com", "javascript:alert(1)"]) {
      expect(namedTarget(bad, 7), bad).toBe("https://nbcc.scot/?utm_medium=qr&utm_campaign=c7");
    }
  });
});

describe("a code's name", () => {
  it("is trimmed and squeezed, and must be 1 to 80 letters long", () => {
    expect(cleanName("  Donate   billboard, High Street ")).toBe("Donate billboard, High Street");
    expect(cleanName("x".repeat(80))).toHaveLength(80);
    expect(cleanName("x".repeat(81))).toBeNull();
    expect(cleanName("   ")).toBeNull();
    expect(cleanName(undefined)).toBeNull();
  });
});

describe("a code's scans", () => {
  it("adds up the total, the last seven days and the last day with a scan", () => {
    const rows = [
      { day: "2026-10-20", scans: 5 },
      { day: "2026-10-28", scans: 2 },
      { day: "2026-10-29", scans: 3 },
      { day: "2026-11-03", scans: 1 },
    ];
    // The seven days are 28 October to 3 November: 2 + 3 + 1.
    expect(scanSummary(rows, "2026-11-03")).toEqual({ total: 11, week: 6, lastDay: "2026-11-03" });
  });

  it("says none yet for a new code", () => {
    expect(scanSummary([], "2026-11-03")).toEqual({ total: 0, week: 0, lastDay: null });
  });
});

describe("the names in Analytics", () => {
  it("names the named codes' tags and leaves every other tag alone", () => {
    const names = new Map([[12, "Donate billboard"]]);
    const out = labelNamedScans(["c12", "c13", "donate", "f4-a4", null], names);
    expect([...out.entries()]).toEqual([
      ["c12", "Donate billboard"],
      ["c13", "QR code 13"],
    ]);
  });
});
