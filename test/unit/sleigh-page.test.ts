import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { amountFromSession, renderSleighPage, renderSleighThanks } from "../../src/sleigh/page";
import type { SleighNight } from "../../src/sleigh/model";
import { ABOUT_NBCC_SHORT } from "../../src/email/brand";
import { SINGLE_DONATION_WORDING } from "../../src/declarations/wording";
import { ALL_PAGES, PRIVATE_PAGES, RESERVED_PREFIXES } from "../../src/site/pages";

// The Kilmarnock Santa Sleigh page (docs/superpowers/specs/2026-11-10-santa-sleigh-design.md). The
// nights are the poster's own; every person named here is invented.

const ROOT = resolve(__dirname, "../..");
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const NIGHTS: SleighNight[] = [
  ["2026-12-15", "New Farm"],
  ["2026-12-16", "Wardneuk, Onthank & Altonhill"],
  ["2026-12-17", "Bellfield & Shortlees"],
  ["2026-12-18", "Fardalehill, Margaret Parker, Whisky"],
  ["2026-12-20", "Southcraig & surrounding"],
  ["2026-12-21", "Gargieston & Moorfield"],
  ["2026-12-22", "Caprington & Grange"],
].map(([nightOn, areas], i) => ({ id: i + 1, nightOn, areas, startsAt: null, endsAt: null }));

const page = renderSleighPage({ nights: NIGHTS, phase: "before", stop: 0, totalPence: 318_450 });

describe("the page, /sleigh", () => {
  it("is a whole page that loads only its own stylesheet, its script and the visit counter", () => {
    expect(page.startsWith("<!doctype html>")).toBe(true);
    const sheets = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    expect(sheets).toEqual(["/assets/css/sleigh.css"]);
    const scripts = [...page.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual(["/assets/js/sleigh.js", "/assets/js/pulse.js"]);
    expect(page).not.toMatch(/<script>(?!<\/script>)/);
  });

  it("says who NBCC is in NBCC's own words, never Ayrshire as its reach, never a child alone", () => {
    expect(words(page)).toContain(ABOUT_NBCC_SHORT);
    expect(words(page)).not.toMatch(/Ayrshire/i);
    expect(words(page)).not.toMatch(/\ba child\b/i);
    expect(page).not.toMatch(DASHES);
  });

  it("shows the sleigh picture with words for anyone who cannot see it", () => {
    expect(page).toMatch(/<img[^>]+src="\/assets\/img\/santa-sleigh-1340\.webp"/);
    expect(page).toMatch(/srcset="\/assets\/img\/santa-sleigh-720\.webp 720w, \/assets\/img\/santa-sleigh-1340\.webp 1340w"/);
    expect(page).toMatch(/alt="Santa and an NBCC elf waving from a red sleigh full of presents"/);
  });

  it("draws one house per night on the road, in date order, each with its date, its areas and Timings TBC", () => {
    const houses = [...page.matchAll(/<li class="sl-house[^"]*"[^>]*data-night="([^"]+)"/g)].map((m) => m[1]);
    expect(houses).toEqual(NIGHTS.map((n) => n.nightOn));
    for (const n of NIGHTS) expect(words(page)).toContain(n.areas.replace(/&/g, "&amp;"));
    expect(words(page).match(/Timings TBC/g)?.length).toBe(7);
    expect(words(page)).toContain("Tue 15 Dec");
    expect(words(page)).toContain("Sun 20 Dec");
  });

  it("puts the little sleigh at the house it is at, for the script to drive to", () => {
    expect(page).toMatch(/data-stop="0"/);
    const later = renderSleighPage({ nights: NIGHTS, phase: "on", stop: 3, totalPence: 0 });
    expect(later).toMatch(/data-stop="3"/);
    expect(later).toMatch(/<li class="sl-house is-tonight"[^>]*data-night="2026-12-18"/);
  });

  it("shows the year's total, for the script to count up to", () => {
    expect(page).toMatch(/data-total="318450"/);
    expect(words(page)).toContain("£3,184.50");
  });

  it("leaves the number out, and keeps everything else, when the total could not be read", () => {
    const blind = renderSleighPage({ nights: NIGHTS, phase: "before", stop: 0, totalPence: null });
    expect(blind).not.toMatch(/data-total=/);
    expect(blind).toContain('id="slGive"');
  });

  it("leaves the number out while nothing has been raised yet, rather than saying £0", () => {
    const none = renderSleighPage({ nights: NIGHTS, phase: "before", stop: 0, totalPence: 0 });
    expect(none).not.toMatch(/data-total=/);
    expect(words(none)).not.toContain("£0 raised");
  });

  it("offers £5, £10, £20 and £50, an amount of your own, and Gift Aid in the site's own words", () => {
    for (const p of [500, 1000, 2000, 5000]) expect(page).toMatch(new RegExp(`data-amount="${p}"`));
    expect(page).toMatch(/id="slOther"[^>]*inputmode="decimal"/);
    expect(page).toContain(SINGLE_DONATION_WORDING.wording_snapshot.replace(/'/g, "&#39;").slice(0, 40));
    expect(page).toMatch(/autocomplete="given-name"/);
    expect(page).toMatch(/autocomplete="email"/);
    expect(page).toMatch(/data-give-pay/);
  });

  it("after the last night thanks Kilmarnock and keeps giving open", () => {
    const after = renderSleighPage({ nights: NIGHTS, phase: "after", stop: 7, totalPence: 1_000_000 });
    expect(words(after)).toContain("Thank you, Kilmarnock");
    expect(after).toContain('id="slGive"');
  });

  it("points other ways in at this site only", () => {
    const hrefs = [...page.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.startsWith("/assets/"));
    for (const h of hrefs) expect(h.startsWith("/") || h.startsWith("#")).toBe(true);
    expect(hrefs).toEqual(expect.arrayContaining(["/fill", "/about-us", "/newsletter"]));
  });
});

describe("the stylesheet and the script", () => {
  const css = readFileSync(resolve(ROOT, "assets/css/sleigh.css"), "utf8");
  const js = readFileSync(resolve(ROOT, "assets/js/sleigh.js"), "utf8");

  it("moves things with transform and opacity only", () => {
    const frames = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThan(3);
    for (const f of frames) {
      const props = [...f.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity", "offset", "animation-timing-function"]).toContain(p);
    }
  });

  it("shows a clear outline on a box chosen from the keyboard, not only a border colour", () => {
    expect(css).toMatch(/\.sl-field input:focus-visible,\.sl-other__box:focus-within\{outline:3px solid var\(--gold\)/);
  });

  it("stops every movement for anyone who asks for less motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(js).toMatch(/prefers-reduced-motion: reduce/);
  });

  it("sends a one off Santa Sleigh gift to the site's checkout", () => {
    expect(js).toContain('"/api/checkout-session"');
    expect(js).toMatch(/sleigh: true/);
    expect(js).toMatch(/mode: "once"/);
  });
});

describe("the thank you, /sleigh/thank-you", () => {
  it("thanks the giver for the amount they gave", () => {
    const t = renderSleighThanks(2000);
    expect(words(t)).toContain("Thank you for your £20");
    expect(t).not.toMatch(DASHES);
    expect(t).toMatch(/<meta name="robots" content="noindex"/);
  });
  it("points the Give button at the top back at the page's give form", () => {
    expect(renderSleighThanks(2000)).toContain('class="sl-top__give" href="/sleigh#give"');
    expect(page).toContain('class="sl-top__give" href="#give"');
  });
  it("is a plain thank you when the amount is not known", () => {
    expect(words(renderSleighThanks(null))).toContain("Thank you");
    expect(words(renderSleighThanks(null))).not.toContain("£");
  });
  it("reads the amount from a paid session only", () => {
    expect(amountFromSession({ payment_status: "paid", amount_total: 1500, metadata: { sleigh: "true" } })).toBe(1500);
    expect(amountFromSession({ payment_status: "unpaid", amount_total: 1500, metadata: { sleigh: "true" } })).toBeNull();
    expect(amountFromSession({ payment_status: "paid", amount_total: 1500, metadata: {} })).toBeNull();
    expect(amountFromSession(null)).toBeNull();
  });
});

describe("the site's page lists", () => {
  it("lists /sleigh for search engines and the QR codes, and keeps its thank you private", () => {
    expect(ALL_PAGES.some((p) => p.path === "/sleigh" && p.listedByDefault)).toBe(true);
    expect(PRIVATE_PAGES.some((p) => p.path === "/sleigh/thank-you")).toBe(true);
    expect(RESERVED_PREFIXES).toEqual(expect.arrayContaining(["/sleigh", "/santa-sleigh"]));
  });
});
