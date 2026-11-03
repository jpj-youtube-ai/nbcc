import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { assetHeaders } from "../../src/routes/site";

// The Get involved film is a 13 MB file among assets that are otherwise a few KB each. These check
// that it really is served the way a film needs: in pieces (a browser asks for a byte range and
// plays as it arrives, and an iPhone will not play at all without that), as the right kind of file,
// and kept by the browser for a week so nobody downloads it twice. And that it gets into the image.

const ROOT = resolve(__dirname, "../..");
const FILM = "/assets/video/get-involved-film.mp4";
const POSTER = "/assets/video/get-involved-film-poster.jpg";
const THUMB = "/assets/video/get-involved-film-thumb.jpg";
const CAPTIONS = "/assets/video/get-involved-film.en.vtt";

let server: Server;
let origin = "";

beforeAll(async () => {
  const app = express();
  // Exactly the line src/routes/site.ts mounts.
  app.use("/assets", express.static(resolve(ROOT, "assets"), { setHeaders: assetHeaders }));
  await new Promise<void>((done) => {
    server = app.listen(0, "127.0.0.1", () => done());
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => void server.close(() => done())));

describe("the film's files", () => {
  it("are in the repo, at a sensible weight", () => {
    const size = (p: string) => statSync(resolve(ROOT, p.slice(1))).size;
    expect(size(FILM)).toBeGreaterThan(1024 * 1024);
    expect(size(FILM)).toBeLessThan(20 * 1024 * 1024);
    expect(size(POSTER)).toBeLessThan(150 * 1024);
    expect(size(THUMB)).toBeLessThan(10 * 1024);
    expect(existsSync(resolve(ROOT, CAPTIONS.slice(1)))).toBe(true);
  });

  it("the film starts playing before it has all arrived (its index is at the front)", () => {
    // Walk the file's top level boxes: "moov" (the index) must come before "mdat" (the pictures).
    const file = readFileSync(resolve(ROOT, FILM.slice(1)));
    const order: string[] = [];
    for (let at = 0; at + 8 <= file.length; ) {
      let size = file.readUInt32BE(at);
      order.push(file.toString("latin1", at + 4, at + 8));
      if (size === 1) size = Number(file.readBigUInt64BE(at + 8));
      if (size < 8) break;
      at += size;
    }
    expect(order).toContain("moov");
    expect(order).toContain("mdat");
    expect(order.indexOf("moov")).toBeLessThan(order.indexOf("mdat"));
  });

  it("the site router serves assets with these headers", () => {
    const src = readFileSync(resolve(ROOT, "src/routes/site.ts"), "utf8");
    expect(src).toMatch(/express\.static\(join\(siteRoot, "assets"\), \{ setHeaders: assetHeaders \}\)/);
  });
});

describe("serving the film", () => {
  it("serves it as video, kept for a week, and says it can be asked for in pieces", async () => {
    const res = await fetch(origin + FILM, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("public, max-age=604800");
    expect(Number(res.headers.get("content-length"))).toBe(statSync(resolve(ROOT, FILM.slice(1))).size);
    expect(res.headers.get("etag")).toBeTruthy();
  });

  it("answers a request for a piece with just that piece", async () => {
    const res = await fetch(origin + FILM, { headers: { Range: "bytes=0-1023" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toMatch(/^bytes 0-1023\/\d+$/);
    expect((await res.arrayBuffer()).byteLength).toBe(1024);
  });

  it("serves the still, the small picture and the captions as what they are", async () => {
    const poster = await fetch(origin + POSTER, { method: "HEAD" });
    expect(poster.status).toBe(200);
    expect(poster.headers.get("content-type")).toBe("image/jpeg");
    expect(poster.headers.get("cache-control")).toBe("public, max-age=604800");

    const thumb = await fetch(origin + THUMB, { method: "HEAD" });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/jpeg");

    const captions = await fetch(origin + CAPTIONS);
    expect(captions.status).toBe(200);
    expect(captions.headers.get("content-type")).toMatch(/^text\/vtt/);
    expect((await captions.text()).startsWith("WEBVTT")).toBe(true);
  });

  it("leaves every other asset exactly as it was served before", async () => {
    const res = await fetch(origin + "/assets/css/events.css", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0");
  });
});

describe("the image", () => {
  it("copies the whole assets folder, film included, and nothing leaves it out", () => {
    const dockerfile = readFileSync(resolve(ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^COPY assets \.\/assets$/m);
    const ignore = readFileSync(resolve(ROOT, ".dockerignore"), "utf8");
    expect(ignore).not.toMatch(/assets|\.mp4|\.vtt|video/);
  });
});
