import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAIN_MAX_PX, PROFILE_PX, QUEUE_MAX, processPicture } from "../../src/fundraising/picture-process";

// Profile pictures (Jaimie, 2026-10-03): every picture an organiser sends is made again on the
// server before it is stored: turned the right way up, made smaller, and saved as a fresh JPEG, so
// nothing from the camera survives (the place it was taken, the phone, the time). Real pictures,
// made here with sharp; nothing about anyone real.

async function photo(width: number, height: number, opts: { format?: "jpeg" | "png" | "webp"; orientation?: number; gps?: boolean; alpha?: boolean } = {}) {
  let img = sharp({
    create: { width, height, channels: opts.alpha ? 4 : 3, background: opts.alpha ? { r: 200, g: 30, b: 30, alpha: 0.5 } : { r: 200, g: 30, b: 30 } },
  });
  if (opts.gps || opts.orientation) {
    img = img.withMetadata({
      orientation: opts.orientation,
      exif: opts.gps ? { IFD0: { Make: "ExamplePhone", Model: "Model 1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "55/1 27/1 0/1" } } : undefined,
    });
  }
  const format = opts.format ?? "jpeg";
  return img.toFormat(format).toBuffer();
}

describe("making a picture again on the server", () => {
  it("drops everything the camera wrote, including where it was taken", async () => {
    const input = await photo(800, 600, { gps: true });
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processPicture("main", input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(out.bytes.includes(Buffer.from("ExamplePhone"))).toBe(false);
  });

  it(`makes a profile photo exactly ${PROFILE_PX} pixels square, from its middle`, async () => {
    const out = await processPicture("profile", await photo(900, 600));
    expect(out).toMatchObject({ ok: true, mime: "image/jpeg", width: PROFILE_PX, height: PROFILE_PX });
    if (!out.ok) return;
    const meta = await sharp(out.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", PROFILE_PX, PROFILE_PX]);
  });

  it(`fits a main photo within ${MAIN_MAX_PX} pixels, keeping its shape`, async () => {
    const out = await processPicture("main", await photo(2400, 1200));
    expect(out).toMatchObject({ ok: true, width: MAIN_MAX_PX, height: 800 });
  });

  it("never makes a small picture bigger", async () => {
    expect(await processPicture("main", await photo(640, 480))).toMatchObject({ ok: true, width: 640, height: 480 });
    expect(await processPicture("profile", await photo(200, 300))).toMatchObject({ ok: true, width: 200, height: 200 });
  });

  it("turns a phone photo the right way up before it forgets which way that was", async () => {
    // Orientation 6: the camera was turned, so the picture is stored on its side.
    const out = await processPicture("main", await photo(600, 400, { orientation: 6 }));
    expect(out).toMatchObject({ ok: true, width: 400, height: 600 });
  });

  it("takes a PNG or WebP, and a see through PNG gets a white background", async () => {
    const png = await processPicture("profile", await photo(300, 300, { format: "png", alpha: true }));
    expect(png).toMatchObject({ ok: true, mime: "image/jpeg" });
    if (png.ok) expect((await sharp(png.bytes).metadata()).hasAlpha).toBe(false);
    expect(await processPicture("main", await photo(300, 200, { format: "webp" }))).toMatchObject({ ok: true, mime: "image/jpeg" });
  });

  it("refuses something that only starts like a picture", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("not really a photo at all")]);
    expect(await processPicture("main", fake)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("refuses a picture cut short, rather than guessing the rest", async () => {
    const whole = await photo(800, 600);
    expect(await processPicture("main", whole.subarray(0, Math.floor(whole.length * 0.6)))).toEqual({ ok: false, reason: "unreadable" });
  });

  it("refuses a picture of a kind it does not take, such as a GIF", async () => {
    const gif = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#c02238" } }).gif().toBuffer();
    expect(await processPicture("profile", gif)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("refuses a picture bigger than the browser ever sends, before it is opened", async () => {
    // The browser sends 1600 pixels at most (2.6 million); 2000 x 2000 is 4 million. And 9000 x 9000
    // is 81 million: a small file that would run the server out of memory.
    const big = await photo(2000, 2000);
    expect(await processPicture("main", big)).toEqual({ ok: false, reason: "unreadable" });
    const huge = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(await processPicture("main", huge)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("saves a busy picture at a lower quality when it would be over the limit, and refuses it if even that is", async () => {
    const noise = await sharp(Buffer.from(Array.from({ length: 600 * 600 * 3 }, (_, i) => (i * 2654435761) % 251)), {
      raw: { width: 600, height: 600, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const first = await processPicture("main", noise);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const limit = Math.floor(first.bytes.length * 0.8);
    const smaller = await processPicture("main", noise, { maxBytes: limit });
    expect(smaller.ok).toBe(true);
    if (smaller.ok) expect(smaller.bytes.length).toBeLessThanOrEqual(limit);
    expect(await processPicture("main", noise, { maxBytes: 1000 })).toEqual({ ok: false, reason: "size" });
  });

  it("makes one picture at a time, a few waiting, and says it is busy past that", async () => {
    const input = await photo(1200, 900);
    const all = await Promise.all(Array.from({ length: 6 }, () => processPicture("main", input)));
    expect(all.filter((r) => r.ok)).toHaveLength(1 + QUEUE_MAX);
    expect(all.filter((r) => !r.ok && r.reason === "busy")).toHaveLength(6 - 1 - QUEUE_MAX);
    // Once they are done, there is room again.
    expect((await processPicture("main", input)).ok).toBe(true);
  });

  it("works on the NBCC elf, a real PNG from the site", async () => {
    const out = await processPicture("profile", readFileSync(resolve(__dirname, "../../assets/img/nbcc-elf.png")));
    expect(out).toMatchObject({ ok: true, width: PROFILE_PX, height: PROFILE_PX });
  });
});

describe("sharp ships in the running service", () => {
  // The runtime image installs with `npm ci --omit=dev`, so a picture library left as a dev
  // dependency would be missing in production, and every upload would fail there and only there.
  it("is a runtime dependency, in package.json and the lock file", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8"));
    expect(pkg.dependencies.sharp).toBeDefined();
    expect(pkg.devDependencies.sharp).toBeUndefined();
    const lock = JSON.parse(readFileSync(resolve(__dirname, "../../package-lock.json"), "utf8"));
    expect(lock.packages["node_modules/sharp"].dev).toBeUndefined();
    expect(lock.packages["node_modules/@img/sharp-linux-x64"].dev).toBeUndefined();
    expect(lock.packages["node_modules/@img/sharp-libvips-linux-x64"].dev).toBeUndefined();
  });
});
