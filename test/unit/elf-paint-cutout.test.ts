import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
// @ts-expect-error a plain JavaScript tool, with no type declarations
import { backgroundOf, bestShift, cropToContent, isolate, keyOut, writeSizes } from "../../scripts/elf-paint/cutout.mjs";

// NBCC Elf Detective School: the painted dress-up elf (plan Task 2). Turning a painting on flat
// magenta into a layer that lines up with every other: the background cut out with soft edges, the
// pink taken off the edges, a painting that OpenAI moved by a few pixels put back, the piece lifted
// on its own, and the part of the elf it hides marked. All on small made up pictures.

type Rgba = { data: Uint8ClampedArray; width: number; height: number };

const W = 120;
const H = 160;
const BG: [number, number, number] = [224, 0, 224];
const LINE: [number, number, number] = [107, 25, 26];

function blank(bg: [number, number, number] = BG): Rgba {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...bg, 255], i * 4);
  return { data, width: W, height: H };
}

function rect(img: Rgba, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): Rgba {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([...rgb, 255], (y * img.width + x) * 4);
  return img;
}

const alphaAt = (img: Rgba, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
const solid = (img: Rgba) => {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 128) n += 1;
  return n;
};

/** A made up elf: a body, two legs and a right mitten, each a block of colour. */
function elf(): Rgba {
  const img = blank();
  rect(img, 40, 40, 80, 100, [240, 220, 190]); // body
  rect(img, 45, 100, 55, 150, [200, 40, 40]); // legs
  rect(img, 65, 100, 75, 150, [200, 40, 40]);
  rect(img, 82, 80, 92, 92, [180, 20, 30]); // right mitten
  return img;
}

function moved(img: Rgba, dx: number, dy: number): Rgba {
  const out = blank();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < W && sy < H) out.data.set(img.data.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4);
    }
  return out;
}

describe("cutting out the background", () => {
  it("finds an off magenta background from the corners", () => {
    expect(backgroundOf(blank())).toEqual(BG);
  });

  it("makes the background clear and keeps a dark outline solid", () => {
    const out = keyOut(rect(blank(), 50, 50, 60, 60, LINE));
    expect(alphaAt(out, 2, 2)).toBe(0);
    expect(alphaAt(out, 55, 55)).toBe(255);
  });

  it("keeps the elf's red solid on the reddish magenta OpenAI paints at low quality", () => {
    // Measured on a real painting, 3 November 2026: background #D616B9, the tights' red #C02238.
    const out = keyOut(rect(blank([214, 22, 185]), 50, 50, 60, 60, [192, 34, 56]));
    expect(alphaAt(out, 2, 2)).toBe(0);
    expect(alphaAt(out, 55, 55)).toBe(255);
  });

  it("takes the pink off a half covered edge pixel", () => {
    // Half way between the outline and the background: pink, and too red and blue for its green.
    const mix: [number, number, number] = [Math.round((LINE[0] + BG[0]) / 2), Math.round((LINE[1] + BG[1]) / 2), Math.round((LINE[2] + BG[2]) / 2)];
    const out = keyOut(rect(blank(), 50, 50, 51, 51, mix));
    const i = (50 * W + 50) * 4;
    expect(out.data[i + 3]).toBeGreaterThan(0);
    expect(out.data[i + 3]).toBeLessThan(255);
    expect(out.data[i + 2]).toBeLessThan(mix[2]);
  });
});

describe("lining up a painting OpenAI moved", () => {
  it("finds a picture moved by (-2, 4)", () => {
    const a = elf();
    expect(bestShift(a, moved(a, -2, 4), [30, 30, 100, 150])).toEqual({ dx: -2, dy: 4 });
  });
});

describe("lifting a piece off", () => {
  it("lifts only the piece, lined up, and marks the part of the elf it hides", () => {
    const master = elf();
    // Painted on the master: a hat on top, and the mitten gone (a gadget would take its place).
    // OpenAI moved the whole painting by (2, -2).
    const wornRaw = rect(elf(), 40, 10, 80, 40, [30, 90, 160]);
    rect(wornRaw, 82, 80, 92, 92, BG);
    const worn = moved(wornRaw, 2, -2);
    // The hat on its own, painted where the master has it but moved by (1, 1).
    const alone = moved(rect(blank(), 40, 10, 80, 40, [30, 90, 160]), 1, 1);
    const { layer, cover } = isolate(alone, worn, master, { still: [40, 100, 80, 150] });
    expect(solid(layer)).toBe(40 * 30);
    expect(alphaAt(layer, 41, 11)).toBe(255);
    expect(alphaAt(layer, 41, 9)).toBe(0);
    expect(cover).not.toBeNull();
    expect(solid(cover!)).toBe(10 * 12);
    expect(alphaAt(cover!, 85, 85)).toBe(255);
  });

  it("marks nothing when the piece hides none of the elf", () => {
    const master = elf();
    const worn = rect(elf(), 40, 10, 80, 40, [30, 90, 160]);
    const alone = rect(blank(), 40, 10, 80, 40, [30, 90, 160]);
    expect(isolate(alone, worn, master, { still: [40, 100, 80, 150] }).cover).toBeNull();
  });
});

describe("cropping and saving", () => {
  it("crops to what is painted and says where it was", () => {
    const { img, x, y } = cropToContent(keyOut(rect(blank(), 30, 20, 50, 60, LINE)));
    expect([x, y, img.width, img.height]).toEqual([30, 20, 20, 40]);
  });

  it("writes three sizes and records the layer's place, and its cover's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "elf-cut-"));
    const layer = keyOut(rect(blank(), 20, 20, 120, 120, LINE));
    const cover = keyOut(rect(blank(), 0, 0, 50, 50, LINE));
    await writeSizes(dir, "piece-test-red", layer, cover);
    const widths = await Promise.all(["tile", "sm", "lg"].map(async (s) => (await sharp(join(dir, s, "piece-test-red.webp")).metadata()).width));
    expect(widths).toEqual([12, 50, 100]);
    expect((await sharp(join(dir, "lg", "piece-test-red.cover.webp")).metadata()).width).toBe(50);
    const places = JSON.parse(readFileSync(join(dir, "places.json"), "utf8"));
    expect(places["piece-test-red"]).toEqual({ x: 20, y: 20, w: 100, h: 100, cover: { x: 0, y: 0, w: 50, h: 50 } });
  });
});
