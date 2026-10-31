import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

// TASK-575: the site's own icon. A browser tab shows the elf (the word NBCC cannot be read at 16
// pixels), and a phone's home screen shows the whole logo on white, named "NBCC". Before this the
// site had no favicon, no home screen icon and no manifest, so a saved page showed a blank or a
// screenshot.

vi.mock("../../src/db/ball", () => ({
  getSettings: async () => {
    throw new Error("no database in unit tests");
  },
}));
vi.mock("../../src/db/events", () => ({ getEventsSettings: async () => ({ pageOn: false }) }));
vi.mock("../../src/db/fundraisers", () => ({ fundraisingIsOn: async () => false }));
vi.mock("../../src/db/site-pages", () => ({
  resolveAlias: async () => null,
  getSeoOverrides: async () => new Map(),
}));

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel));

// Every page the image ships, read from the Dockerfile's COPY line, so a new page cannot be added
// without its icon. The three Festive Ball pages wait until after the Ball (nothing Ball related
// changes before 8 November 2026); the root icons still reach them, because browsers and iPhones
// ask for /favicon.ico and /apple-touch-icon.png by themselves.
const BALL_PAGES = ["ball.html", "ball-terms.html", "ball-donate.html"];
function shippedPages(): string[] {
  const line = read("Dockerfile")
    .toString()
    .split(/\r?\n/)
    .find((l) => l.startsWith("COPY index.html"));
  if (!line) throw new Error("Dockerfile COPY line for the pages not found");
  return line.split(/\s+/).filter((w) => w.endsWith(".html"));
}

// Under /assets/, like everything else a page loads (the Red Bag pages' tests hold that rule).
const HEAD_TAGS = [
  '<link rel="icon" href="/assets/icons/favicon.ico" />',
  '<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png" />',
  '<link rel="manifest" href="/assets/icons/site.webmanifest" />',
  '<meta name="apple-mobile-web-app-title" content="NBCC" />',
];

describe("every page names the site's icons in its head (TASK-575)", () => {
  const pages = shippedPages().filter((p) => !BALL_PAGES.includes(p));

  it("finds the pages to check", () => {
    expect(pages.length).toBeGreaterThan(20);
    expect(pages).toContain("index.html");
    expect(pages).toContain("donate.html");
  });

  it.each(pages)("%s", (page) => {
    const html = read(page).toString();
    const head = html.slice(0, html.indexOf("</head>"));
    for (const tag of HEAD_TAGS) expect(head, `${page} is missing ${tag}`).toContain(tag);
  });

  it("leaves the Festive Ball pages as they are until after the Ball", () => {
    for (const page of BALL_PAGES) expect(read(page).toString()).not.toContain('rel="manifest"');
  });
});

// An ICO file is a small directory of images; each entry gives its width (0 means 256).
function icoSizes(buf: Buffer): number[] {
  expect(buf.readUInt16LE(0)).toBe(0);
  expect(buf.readUInt16LE(2)).toBe(1);
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => buf[6 + i * 16] || 256);
}

describe("the icon files (TASK-575)", () => {
  it("favicon.ico holds the elf at 16, 32 and 48 pixels", () => {
    expect(icoSizes(read("assets/icons/favicon.ico")).sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });

  it.each([
    ["assets/icons/apple-touch-icon.png", 180],
    ["assets/icons/icon-192.png", 192],
    ["assets/icons/icon-512.png", 512],
    ["assets/icons/icon-maskable-512.png", 512],
  ])("%s is %ipx square and solid (an iPhone turns see-through corners black)", async (file, size) => {
    const meta = await sharp(read(file)).metadata();
    expect(meta.width).toBe(size);
    expect(meta.height).toBe(size);
    const { data, info } = await sharp(read(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minAlpha = 255;
    for (let i = info.channels - 1; i < data.length; i += info.channels) minAlpha = Math.min(minAlpha, data[i]);
    expect(minAlpha).toBe(255);
  });

  it("the home screen icons have a white background, the logo in the middle", async () => {
    const { data, info } = await sharp(read("assets/icons/apple-touch-icon.png")).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    expect(px(2, 2)).toEqual([255, 255, 255]);
    expect(px(177, 177)).toEqual([255, 255, 255]);
    const centre = px(90, 90);
    expect(centre).not.toEqual([255, 255, 255]);
  });

  it("the manifest names the site NBCC, opens like a bookmark and lists icons that exist", async () => {
    const manifest = JSON.parse(read("assets/icons/site.webmanifest").toString());
    expect(manifest.short_name).toBe("NBCC");
    expect(manifest.name).toBe("Night Before Christmas Campaign");
    // "browser" keeps it a shortcut that opens in the normal browser, never an app window.
    expect(manifest.display).toBe("browser");
    // No start address: a shortcut opens the page it was saved from, as a bookmark does. With one,
    // Android opens that address instead, whichever page was saved (Donate, the admin...).
    expect(manifest).not.toHaveProperty("start_url");
    expect(manifest.scope).toBe("/");
    const purposes: string[] = [];
    for (const icon of manifest.icons) {
      const file = "assets/icons/" + String(icon.src).replace(/^\/assets\/icons\//, "");
      expect(String(icon.src).startsWith("/assets/icons/")).toBe(true);
      const meta = await sharp(read(file)).metadata();
      expect(`${meta.width}x${meta.height}`).toBe(icon.sizes);
      expect(icon.type).toBe("image/png");
      purposes.push(icon.purpose ?? "any");
    }
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(purposes).toContain("maskable");
  });
});

describe("the site answers at the addresses browsers ask for by themselves (TASK-575)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(createSiteRouter(ROOT));
    server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it.each([
    ["/favicon.ico", "image/x-icon", "assets/icons/favicon.ico"],
    ["/apple-touch-icon.png", "image/png", "assets/icons/apple-touch-icon.png"],
    ["/apple-touch-icon-precomposed.png", "image/png", "assets/icons/apple-touch-icon.png"],
    ["/assets/icons/site.webmanifest", "application/manifest+json", "assets/icons/site.webmanifest"],
  ])("%s", async (path, type, file) => {
    const res = await fetch(base + path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(type);
    expect(Buffer.from(await res.arrayBuffer()).equals(read(file))).toBe(true);
  });

  it("answers a HEAD request with the headers only", async () => {
    const res = await fetch(base + "/favicon.ico", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/x-icon");
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});
