import { describe, it, expect } from "vitest";
import sharp from "sharp";
import jsQR from "jsqr";
import { qrSlug, qrLink, qrPath, qrRows, drawQr, labelQrScans } from "../../src/site/qr";
import { SITE_PAGES, type SitePage } from "../../src/site/pages";

// Reads a code back the way a phone would: the image's pixels, decoded.
async function scan(image: Buffer): Promise<{ text: string | null; width: number }> {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  return { text: found ? found.data : null, width: info.width };
}

describe("drawing a code", () => {
  const link = qrLink("/ball/terms");

  it("draws a PNG, 1200 pixels across, that scans as the page's link", async () => {
    const png = await drawQr(link, "png");
    expect(Buffer.isBuffer(png)).toBe(true);
    const read = await scan(png as Buffer);
    expect(read.width).toBe(1200);
    expect(read.text).toBe(link);
  });

  it("draws an SVG, for printing at any size, that scans as the same link", async () => {
    const svg = (await drawQr(link, "svg")) as string;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<script/i);
    const read = await scan(await sharp(Buffer.from(svg), { density: 300 }).png().toBuffer());
    expect(read.text).toBe(link);
  });
});

// TASK-492: QR codes for every page of the site, in the admin. These are the pure rules: which
// pages get a code, the link a code carries, and which typed addresses are allowed.

describe("the name a page's code is known by", () => {
  it("is the address without its slashes, and home for the home page", () => {
    expect(qrSlug("/")).toBe("home");
    expect(qrSlug("/ball")).toBe("ball");
    expect(qrSlug("/ball/terms")).toBe("ball-terms");
    expect(qrSlug("/about-us")).toBe("about-us");
  });

  // So a typed /Ball is counted in Analytics as the Festive Ball page, not as an address of its own.
  it("is in small letters, however the address was typed", () => {
    expect(qrSlug("/Ball/Terms")).toBe("ball-terms");
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

// Admin > Analytics lists scans by the tag each code carries; staff read them as page names.
describe("naming the codes that were scanned", () => {
  it("gives each tag its page's name, and keeps a tag it does not know as the address", () => {
    expect(
      labelQrScans(
        [
          { campaign: "ball-terms", visits: 3 },
          { campaign: "home", visits: 2 },
          { campaign: "give", visits: 1 },
          { campaign: null, visits: 1 },
        ],
        SITE_PAGES,
      ),
    ).toEqual([
      { label: "Ticket terms", visits: 3 },
      { label: "Home", visits: 2 },
      { label: "/give", visits: 1 },
      { label: "Not named", visits: 1 },
    ]);
  });

  // TASK-512: a fundraiser's printed piece has its own code; its tag is named for the fundraiser and
  // the piece ("Sam's Santa Dash, A4 poster"), from names looked up for it.
  it("names a fundraiser's piece from the names it is given", () => {
    expect(
      labelQrScans(
        [
          { campaign: "f12-a4", visits: 4 },
          { campaign: "ball-terms", visits: 1 },
        ],
        SITE_PAGES,
        new Map([["f12-a4", "Sam's Santa Dash, A4 poster"]]),
      ),
    ).toEqual([
      { label: "Sam's Santa Dash, A4 poster", visits: 4 },
      { label: "Ticket terms", visits: 1 },
    ]);
  });
});

const allPaths = (pages: SitePage[]): string[] => pages.flatMap((p) => [p.path, ...allPaths(p.children ?? [])]);

describe("the pages that get a code", () => {
  it("is every page in the site's page list, children included, so a new page is never missed", () => {
    const rows = qrRows(SITE_PAGES, { ballOpen: true, eventsOn: true, fundraisingOn: true });
    expect(rows.map((r) => r.path)).toEqual(allPaths(SITE_PAGES));
  });

  it("gives each its title and the link its code carries", () => {
    const home = qrRows(SITE_PAGES, { ballOpen: true, eventsOn: true, fundraisingOn: true })[0];
    expect(home).toEqual({ path: "/", title: "Home", live: true, link: "https://nbcc.scot/?utm_medium=qr&utm_campaign=home" });
  });

  // Posters can be made before launch, but staff should know the page is not up yet.
  it("marks the Festive Ball, Get involved and Fundraising pages not live while they are switched off", () => {
    const live = (open: { ballOpen: boolean; eventsOn: boolean; fundraisingOn: boolean }) =>
      Object.fromEntries(qrRows(SITE_PAGES, open).map((r) => [r.path, r.live]));
    const off = live({ ballOpen: false, eventsOn: false, fundraisingOn: false });
    expect(off["/ball"]).toBe(false);
    expect(off["/ball/terms"]).toBe(false);
    expect(off["/get-involved"]).toBe(false);
    expect(off["/fundraise"]).toBe(false);
    expect(off["/fundraise/help"]).toBe(false);
    expect(off["/donate"]).toBe(true);
    const on = live({ ballOpen: true, eventsOn: true, fundraisingOn: true });
    expect(on["/ball"]).toBe(true);
    expect(on["/get-involved"]).toBe(true);
    expect(on["/fundraise"]).toBe(true);
  });
});
