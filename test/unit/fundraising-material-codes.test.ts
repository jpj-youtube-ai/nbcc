import { describe, it, expect } from "vitest";
import {
  TRACKED_PIECES,
  labelScanCampaigns,
  materialScanCounts,
  parseScanCampaign,
  parseShortCode,
  scanCampaign,
  scanTarget,
  shortCode,
  trackedPath,
} from "../../src/fundraising/material-codes";

// TASK-512: every printed piece's QR code is its own short link, /q/<fundraiser id>-<size>, so a
// scan says which fundraiser and which piece it came from. The link answers with a 302 to wherever
// that fundraiser is NOW (looked up by its id, never its address), tagged so Admin > Analytics counts
// it as a QR code scan (TASK-492) named after the piece. Pure; every name here is invented.

describe("the short link on each piece", () => {
  it("is the fundraiser's id and the piece's size", () => {
    expect(shortCode(12, "poster")).toBe("12-a4");
    expect(shortCode(12, "poster-a3")).toBe("12-a3");
    expect(shortCode(12, "leaflet")).toBe("12-a5");
    expect(trackedPath(345, "leaflet")).toBe("/q/345-a5");
  });

  it("covers the three printed pieces with a QR code", () => {
    expect([...TRACKED_PIECES]).toEqual(["poster", "poster-a3", "leaflet"]);
  });

  it("stays short enough to scan when small", () => {
    expect(`https://nbcc.scot${trackedPath(2147483647, "poster-a3")}`.length).toBeLessThanOrEqual(40);
  });
});

describe("reading a short link", () => {
  it("reads one of ours", () => {
    expect(parseShortCode("12-a4")).toEqual({ id: 12, code: "a4" });
    expect(parseShortCode("7-a5")).toEqual({ id: 7, code: "a5" });
    expect(parseShortCode("12-A3")).toEqual({ id: 12, code: "a3" });
  });

  it("refuses anything else", () => {
    for (const bad of ["", "12", "12-a6", "0-a4", "012-a4", "12-a4x", "a4", "12-a4/../x", "99999999999-a4", "-1-a4", null, undefined, 12]) {
      expect(parseShortCode(bad)).toBeNull();
    }
  });
});

describe("the tag a scan carries into Analytics", () => {
  it("names the fundraiser and the piece", () => {
    expect(scanCampaign(12, "a4")).toBe("f12-a4");
    expect(parseScanCampaign("f12-a4")).toEqual({ id: 12, code: "a4" });
  });

  it("is not mistaken for a page of the site", () => {
    expect(parseScanCampaign("ball")).toBeNull();
    expect(parseScanCampaign("fundraise")).toBeNull();
    expect(parseScanCampaign(null)).toBeNull();
    expect(parseScanCampaign("f12-a9")).toBeNull();
  });
});

describe("where a scan goes", () => {
  const sam = { id: 12, slug: "sams-santa-dash", path: "raising" as const, public: true, status: "approved" as const };

  it("goes to the page as it is called now, tagged as a QR code scan", () => {
    expect(scanTarget(sam, "a4")).toBe("/fundraise/sams-santa-dash?utm_medium=qr&utm_campaign=f12-a4");
  });

  it("follows the page when staff change its address", () => {
    expect(scanTarget({ ...sam, slug: "sams-big-santa-dash" }, "a3")).toBe("/fundraise/sams-big-santa-dash?utm_medium=qr&utm_campaign=f12-a3");
  });

  it("still reaches a finished fundraiser's page", () => {
    expect(scanTarget({ ...sam, status: "finished" }, "a5")).toBe("/fundraise/sams-santa-dash?utm_medium=qr&utm_campaign=f12-a5");
  });

  it("goes to Get involved for a listed event, which has no page", () => {
    expect(scanTarget({ ...sam, path: "event" }, "a4")).toBe("/get-involved?utm_medium=qr&utm_campaign=f12-a4");
  });

  it("goes nowhere for one that is declined, new or not on the website", () => {
    expect(scanTarget({ ...sam, status: "declined" }, "a4")).toBeNull();
    expect(scanTarget({ ...sam, status: "new" }, "a4")).toBeNull();
    expect(scanTarget({ ...sam, public: false }, "a4")).toBeNull();
  });

  it("never sends anyone off our site, whatever is stored", () => {
    expect(scanTarget({ ...sam, slug: "//evil.example" }, "a4")).toBeNull();
    expect(scanTarget({ ...sam, slug: "https://evil.example" }, "a4")).toBeNull();
    expect(scanTarget({ ...sam, slug: "a/../b" }, "a4")).toBeNull();
  });
});

describe("naming scans for staff", () => {
  it("labels a fundraiser's piece as its title and the piece", () => {
    const labels = labelScanCampaigns(["f12-a4", "f12-a5", "f99-a3", "ball", null], new Map([[12, "Sam's Santa Dash"]]));
    expect(labels.get("f12-a4")).toBe("Sam's Santa Dash, A4 poster");
    expect(labels.get("f12-a5")).toBe("Sam's Santa Dash, A5 leaflet");
    // A fundraiser since removed still says what the piece was.
    expect(labels.get("f99-a3")).toBe("Fundraiser 99, A3 poster");
    expect(labels.has("ball")).toBe(false);
  });

  it("gives every piece a count for one fundraiser, none as nought", () => {
    expect(materialScanCounts(12, [{ campaign: "f12-a4", scans: 5 }, { campaign: "f12-a5", scans: 2 }, { campaign: "f13-a4", scans: 9 }])).toEqual([
      { piece: "poster", code: "a4", label: "A4 poster", scans: 5 },
      { piece: "poster-a3", code: "a3", label: "A3 poster", scans: 0 },
      { piece: "leaflet", code: "a5", label: "A5 leaflet", scans: 2 },
    ]);
  });
});
