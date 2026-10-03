import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { meter, isValidSlug, type FundraiserRecord } from "../../src/fundraising/model";
import { SPONSOR_DECLARATION } from "../../src/fundraising/materials";

// TASK-504: the public pieces of the fundraising materials, through the real site router with the
// database mocked. The blank sponsor form (/fundraise/sponsor-form) and the logo pack
// (/fundraise/logos) are there only while fundraising is switched on, like the help page, and the
// help page now links to both. A page's print size QR code (/fundraise/<slug>/qr.png) sits beside
// its SVG. Every name and address here is invented.

const state = vi.hoisted(() => ({ fundraisingOn: true, fundraisers: [] as unknown[] }));

vi.mock("../../src/db/ball", () => ({
  getSettings: async () => {
    throw new Error("no database in unit tests");
  },
}));
vi.mock("../../src/db/events", () => ({ getEventsSettings: async () => ({ pageOn: true }), listPageEvents: async () => [] }));
vi.mock("../../src/db/site-pages", () => ({ resolveAlias: async () => null, getSeoOverrides: async () => new Map() }));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => state.fundraisingOn,
  listApprovedPublic: async () => state.fundraisers,
  getBySlug: async (slug: string) => (state.fundraisers as FundraiserRecord[]).find((f) => f.slug === slug) ?? null,
  wallRows: async () => [],
}));
vi.mock("../../src/fundraising/send", () => ({ fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}` }));
// The real encoders, watched: the cache must spare them a second run for the same address.
const drawn = vi.hoisted(() => ({ png: 0, svg: 0 }));
vi.mock("../../src/fundraising/qr-png", async (orig) => {
  const real = (await orig()) as typeof import("../../src/fundraising/qr-png");
  return { ...real, qrPng: (text: string) => (drawn.png++, real.qrPng(text)) };
});
vi.mock("../../src/fundraising/qr", async (orig) => {
  const real = (await orig()) as typeof import("../../src/fundraising/qr");
  return { ...real, qrSvg: (text: string, opts?: Parameters<typeof real.qrSvg>[1]) => (drawn.svg++, real.qrSvg(text, opts)) };
});

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");
const record = (over: Partial<FundraiserRecord> = {}) => ({
  id: 7,
  slug: "robins-santa-dash",
  path: "raising",
  kind: "santa_dash",
  title: "Robin's Santa Dash",
  description: "Five kilometres in a red suit.",
  public: true,
  status: "approved",
  name: "Robin Quill",
  email: "robin.quill@example.com",
  targetPence: 25000,
  meter: meter({ onlinePence: 12500, cashPence: 0, targetPence: 25000 }),
  ...over,
});

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(createSiteRouter(ROOT));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  state.fundraisingOn = true;
  state.fundraisers = [record()];
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

describe("the blank sponsor form", () => {
  it("is a print page with HMRC's declaration and nobody's details", async () => {
    const res = await get("/fundraise/sponsor-form");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(SPONSOR_DECLARATION.replace(/'/g, "&#39;"));
    expect(html).toContain("SC047995");
    expect(html).toContain("Please send this form back to us with the money so we can claim Gift Aid");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(html).not.toContain("Robin");
  });

  it("is not there while fundraising is switched off", async () => {
    state.fundraisingOn = false;
    expect((await get("/fundraise/sponsor-form")).status).toBe(404);
  });
});

describe("the logo pack", () => {
  it("is there while fundraising is on, with each official logo to download", async () => {
    const res = await get("/fundraise/logos");
    expect(res.status).toBe(200);
    const html = await res.text();
    const downloads = [...html.matchAll(/<a [^>]*href="(\/assets\/img\/[^"]+)"[^>]*\bdownload\b/g)].map((m) => m[1]);
    expect(downloads.sort()).toEqual(["/assets/img/nbcc-logo-footer.png", "/assets/img/nbcc-logo-white.svg", "/assets/img/nbcc-logo.png"]);
    for (const file of downloads) expect(existsSync(resolve(ROOT, file.slice(1)))).toBe(true);
  });

  it("gives the simple rules", async () => {
    const html = await (await get("/fundraise/logos")).text();
    expect(html).toMatch(/don&rsquo;t stretch, recolour or redraw|don't stretch, recolour or redraw/i);
    expect(html).toMatch(/space around/i);
    expect(html).toMatch(/white logo on dark backgrounds/i);
    expect(html).toMatch(/fundraising <(?:b|strong)>for<\/(?:b|strong)> NBCC|fundraising for NBCC/i);
  });

  it("is not there while fundraising is switched off", async () => {
    state.fundraisingOn = false;
    expect((await get("/fundraise/logos")).status).toBe(404);
  });
});

describe("the help page", () => {
  const help = readFileSync(resolve(ROOT, "fundraise-help.html"), "utf8");

  it("links to the logo pack instead of asking people to email for it", () => {
    const section = /<section[^>]*id="logo"[\s\S]*?<\/section>/.exec(help)?.[0] ?? "";
    expect(section).toContain('href="/fundraise/logos"');
    expect(section).not.toContain("Just ask and we will send you our logo");
  });

  it("links to the blank sponsor form", () => {
    expect(help).toContain('href="/fundraise/sponsor-form"');
  });
});

describe("the addresses no fundraiser may take", () => {
  it("include the logo pack and the sponsor form", () => {
    expect(isValidSlug("logos")).toBe(false);
    expect(isValidSlug("sponsor-form")).toBe(false);
  });
});

describe("a page's print size QR code", () => {
  it("downloads as a PNG named for the page", async () => {
    const res = await get("/fundraise/robins-santa-dash/qr.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="nbcc-robins-santa-dash-qr-code.png"');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBeGreaterThanOrEqual(2000);
  });

  it("is drawn once and then served from memory, kept by browsers for a day", async () => {
    state.fundraisers = [record({ slug: "cache-check-walk" })];
    const before = drawn.png;
    const first = await get("/fundraise/cache-check-walk/qr.png");
    const second = await get("/fundraise/cache-check-walk/qr.png");
    expect(drawn.png - before).toBe(1);
    expect(Buffer.from(await second.arrayBuffer())).toEqual(Buffer.from(await first.arrayBuffer()));
    expect(second.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("serves the SVG from memory too", async () => {
    state.fundraisers = [record({ slug: "cache-check-svg" })];
    const before = drawn.svg;
    await get("/fundraise/cache-check-svg/qr.svg");
    const again = await get("/fundraise/cache-check-svg/qr.svg");
    expect(drawn.svg - before).toBe(1);
    expect(again.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await again.text()).toContain("<svg");
  });

  it("is not there for a fundraiser with no page, or while switched off", async () => {
    state.fundraisers = [record({ public: false })];
    expect((await get("/fundraise/robins-santa-dash/qr.png")).status).toBe(404);
    state.fundraisers = [record()];
    state.fundraisingOn = false;
    expect((await get("/fundraise/robins-santa-dash/qr.png")).status).toBe(404);
  });
});

// TASK-512: NBCC's policy on the logo pack, and the charity statement on the blank sponsor form.
describe("round two, on the public pieces", () => {
  it("the logo pack says how to ask us for anything else, and not to make our logo your own", async () => {
    const { ASK_US } = await import("../../src/fundraising/materials");
    const html = await (await get("/fundraise/logos")).text();
    const box = /<p class="fr-ask-us"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(box.replace(/<[^>]+>/g, "")).toBe(ASK_US);
  });

  it("the logo pack's footer still has the registration statement", async () => {
    const html = await (await get("/fundraise/logos")).text();
    expect(html).toContain("is a Scottish Charitable Incorporated Organisation");
    expect(html).toContain("SC047995");
  });

  it("the blank sponsor form carries the charity statement word for word", async () => {
    const { MATERIALS_STATEMENT } = await import("../../src/legal/registration");
    const html = await (await get("/fundraise/sponsor-form")).text();
    expect(html).toContain(MATERIALS_STATEMENT.replace(/'/g, "&#39;"));
  });
});
