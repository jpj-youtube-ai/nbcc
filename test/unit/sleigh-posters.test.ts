import { describe, expect, it } from "vitest";
import { posterCodeName, renderSleighPoster, sleighPosterAssets } from "../../src/sleigh/posters";
import type { SleighNight } from "../../src/sleigh/model";
import { NAME_MAX } from "../../src/site/qr-named";
import { ABOUT_NBCC_SHORT } from "../../src/email/brand";

// The Santa Sleigh posters, downloaded from Admin > Santa Sleigh (Jaimie, 10 November 2026: one with
// every night and area, one per area, A4 and A3, each with a named QR code; "bold, fun, family, money").

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const words = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const NIGHTS: SleighNight[] = [
  ["2026-12-15", "New Farm"],
  ["2026-12-16", "Wardneuk, Onthank & Altonhill"],
  ["2026-12-17", "Bellfield & Shortlees"],
  ["2026-12-18", "Fardalehill, Margaret Parker, Whisky"],
  ["2026-12-20", "Southcraig & surrounding"],
  ["2026-12-21", "Gargieston & Moorfield"],
  ["2026-12-22", "Caprington & Grange"],
].map(([nightOn, areas], i) => ({ id: i + 1, nightOn, areas, startsAt: null, endsAt: null }));

const ASSETS = { fontCss: "/* fonts */", art: "data:image/webp;base64,AAAA", logo: "data:image/png;base64,BBBB" };
const QR = "https://nbcc.scot/q/c41";

describe("the poster with every night", () => {
  const p = renderSleighPoster({ nights: NIGHTS, night: null, size: "a4", qrUrl: QR, assets: ASSETS });

  it("lists all seven nights in order, each with its date, areas and Timings TBC", () => {
    const w = words(p);
    let at = -1;
    for (const n of NIGHTS) {
      const i = w.indexOf(n.areas.replace(/&/g, "&amp;"));
      expect(i).toBeGreaterThan(at);
      at = i;
    }
    expect(w).toContain("Tue 15 Dec");
    expect(w.match(/Timings TBC/g)?.length).toBe(7);
  });

  it("names Kilmarnock, carries the QR code for its own named code, and prints the short address", () => {
    expect(words(p)).toContain("Kilmarnock");
    expect(p).toMatch(/<svg[^>]+role="img"[\s\S]*?<title>QR code for nbcc\.scot\/sleigh<\/title>/);
    expect(words(p)).toContain("nbcc.scot/sleigh");
    expect(words(p)).toContain("Scan to give");
  });

  it("says who NBCC is in its own words, with the charity number, and no dashes", () => {
    expect(words(p)).toContain(ABOUT_NBCC_SHORT);
    expect(words(p)).toContain("SC047995");
    expect(words(p)).not.toMatch(/Ayrshire/i);
    expect(p).not.toMatch(DASHES);
  });

  it("prints on A4, and the same design on A3", () => {
    expect(p).toMatch(/@page\{size:A4 portrait;margin:0\}/);
    const a3 = renderSleighPoster({ nights: NIGHTS, night: null, size: "a3", qrUrl: QR, assets: ASSETS });
    expect(a3).toMatch(/@page\{size:A3 portrait;margin:0\}/);
    expect(a3).toMatch(/scale\(1\.4142\)/);
  });

  it("is self contained: the picture and the fonts are in the page itself", () => {
    expect(p).toContain(ASSETS.art);
    expect(p).toContain(ASSETS.fontCss);
    expect(p).not.toMatch(/src="\/assets\//);
  });
});

describe("the poster for one night", () => {
  const night = NIGHTS[4];
  const p = renderSleighPoster({ nights: NIGHTS, night, size: "a4", qrUrl: QR, assets: ASSETS });

  it("names only its own areas and date", () => {
    const w = words(p);
    expect(w).toContain("Southcraig &amp; surrounding");
    expect(w).toContain("Sun 20 Dec");
    expect(w).not.toContain("New Farm");
    expect(w).toContain("Timings TBC");
  });

  it("says the times once they are set", () => {
    const timed = renderSleighPoster({ nights: NIGHTS, night: { ...night, startsAt: "18:00", endsAt: "20:30" }, size: "a4", qrUrl: QR, assets: ASSETS });
    expect(words(timed)).toContain("6pm to 8.30pm");
  });
});

describe("the named codes the posters carry", () => {
  it("is one code for the every night poster, and one per area", () => {
    expect(posterCodeName(null)).toBe("Santa Sleigh poster: every night");
    expect(posterCodeName(NIGHTS[0])).toBe("Santa Sleigh poster: New Farm");
  });
  it("keeps a long name inside the length a code's name may be", () => {
    const long = posterCodeName({ ...NIGHTS[0], areas: "A".repeat(200) });
    expect(long.length).toBeLessThanOrEqual(NAME_MAX);
    expect(long.startsWith("Santa Sleigh poster: AAA")).toBe(true);
  });
});

describe("the poster's assets", () => {
  it("reads the sleigh picture, the logo and the fonts from the site's own files", () => {
    const a = sleighPosterAssets();
    expect(a.art.startsWith("data:image/webp;base64,")).toBe(true);
    expect(a.logo.startsWith("data:image/png;base64,")).toBe(true);
    expect(a.fontCss).toContain("Playfair Display");
  });
});
