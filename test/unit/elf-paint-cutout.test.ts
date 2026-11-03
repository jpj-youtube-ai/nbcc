import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
// @ts-expect-error a plain JavaScript tool, with no type declarations
import { backgroundOf, bestShift, cropToContent, dropLooseEdges, hatCover, isolate, keepMainParts, keyOut, writeSizes } from "../../scripts/elf-paint/cutout.mjs";

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

  it("leaves no purple rim round the outline, and keeps the reds red", () => {
    // Measured on the real elves, 3 November 2026: the outermost outline pixels came out purple
    // (#5A0B41), a ring that shows on a dark email. The outline is a browny red, so its edge must be too.
    const out = keyOut(rect(rect(blank([214, 22, 185]), 50, 50, 51, 60, [90, 11, 65]), 60, 50, 70, 60, [192, 34, 56]));
    const rim = (50 * W + 50) * 4;
    expect(out.data[rim + 2] - out.data[rim + 1]).toBeLessThan(15);
    const red = (55 * W + 65) * 4;
    expect(out.data[red]).toBeGreaterThan(150);
    expect(out.data[red + 2]).toBeLessThan(60);
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

  it("keeps only what the piece changed, even when the painting on its own spills over the face", () => {
    // Collars that came out over the mouth, 3 November 2026: the painting of the top on its own was
    // a little bigger than the top as worn.
    const master = elf();
    const worn = rect(elf(), 40, 60, 80, 100, [30, 90, 160]); // a blue top over the body's lower part
    // On its own it reaches up over the face and down over the legs, so no sliding can make it fit.
    const alone = rect(blank(), 38, 40, 82, 125, [30, 90, 160]);
    const { layer } = isolate(alone, worn, master, { still: [40, 130, 80, 150] });
    expect(alphaAt(layer, 60, 80)).toBe(255); // the top
    expect(alphaAt(layer, 60, 50)).toBe(0); // the face above it, unchanged by the top
    expect(alphaAt(layer, 50, 115)).toBe(0); // a leg below it, unchanged by the top
    expect([...layer.data.subarray((80 * W + 60) * 4, (80 * W + 60) * 4 + 3)]).toEqual([30, 90, 160]);
  });

  it("keeps a whole outfit as painted, and hides all of the elf except where it shows through", () => {
    // A reindeer's red nose on the hood came out see through where it sat over red hair, and bigger
    // hair poked out round the tree (3 November 2026). An outfit is kept whole, and only its face
    // hole and what the costume leaves bare (legs here) show the elf.
    const master = elf(); // body 40..80 x 40..100, legs below
    const worn = rect(rect(blank(), 30, 20, 90, 100, [120, 70, 40]), 50, 40, 70, 60, [240, 220, 190]); // a suit with a face hole
    rect(worn, 45, 100, 55, 150, [200, 40, 40]);
    rect(worn, 65, 100, 75, 150, [200, 40, 40]); // the legs, still the elf's
    rect(worn, 58, 25, 62, 29, [240, 220, 190]); // a nose the colour of the elf
    const alone = rect(blank(), 30, 20, 90, 100, [120, 70, 40]);
    rect(alone, 50, 40, 70, 60, BG); // its face hole
    rect(alone, 58, 25, 62, 29, [240, 220, 190]);
    const { layer, cover } = isolate(alone, worn, master, { still: [40, 130, 80, 150], outfit: true });
    expect(alphaAt(layer, 60, 27)).toBe(255); // the nose stays, though it matches the elf
    expect(alphaAt(layer, 60, 50)).toBe(0); // the face hole
    expect(alphaAt(cover!, 60, 50)).toBe(0); // the face shows
    expect(alphaAt(cover!, 50, 120)).toBe(0); // so do the legs
    expect(alphaAt(cover!, 35, 30)).toBe(255); // the elf under the suit is hidden
    expect(alphaAt(cover!, 5, 5)).toBe(255); // and any hair beyond it
  });

  it("lines an outfit's face hole up with the elf's own face, and shows the elf only through it", () => {
    // The tree and Nessie's holes came out to one side of the face (3 November 2026).
    const master = elf();
    rect(master, 52, 46, 68, 62, [250, 214, 183]); // the face, in the master's skin
    rect(master, 20, 10, 100, 30, [200, 120, 60]); // and big hair, above it
    const worn = rect(blank(), 30, 20, 90, 100, [40, 120, 40]);
    rect(worn, 60, 42, 80, 62, [250, 214, 183]); // OpenAI painted the face (and hole) 10 to the right
    rect(worn, 45, 100, 55, 150, [200, 40, 40]);
    rect(worn, 65, 100, 75, 150, [200, 40, 40]); // the elf's own legs, where the master has them
    const alone = rect(blank(), 30, 20, 90, 100, [40, 120, 40]);
    rect(alone, 60, 42, 80, 62, BG); // the hole, 10 to the right of the master's face
    const { layer, cover } = isolate(alone, worn, master, { still: [40, 130, 80, 150], outfit: true, face: [40, 30, 90, 80] });
    expect(alphaAt(layer, 55, 52)).toBe(0); // the hole is now over the face
    expect(alphaAt(layer, 75, 52)).toBe(255); // and costume where the hole was
    expect(alphaAt(cover!, 55, 52)).toBe(0); // the face shows
    expect(alphaAt(cover!, 75, 52)).toBe(255); // nothing of the elf beside it
    expect(alphaAt(cover!, 25, 15)).toBe(255); // nor its hair beyond the costume
    expect(alphaAt(cover!, 50, 120)).toBe(0); // its legs still show
  });

  it("marks nothing when the piece hides none of the elf", () => {
    const master = elf();
    const worn = rect(elf(), 40, 10, 80, 40, [30, 90, 160]);
    const alone = rect(blank(), 40, 10, 80, 40, [30, 90, 160]);
    expect(isolate(alone, worn, master, { still: [40, 100, 80, 150] }).cover).toBeNull();
  });
});

describe("dropping stray marks", () => {
  it("drops a thin stray line that does not touch the elf, and keeps both shoes of a pair", () => {
    const img = keyOut(blank());
    const paint = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([200, 40, 40, 255], (y * W + x) * 4);
    };
    paint(20, 100, 50, 130); // a shoe
    paint(70, 100, 100, 130); // the other shoe
    paint(10, 10, 12, 60); // a stray line, two pixels wide
    const kept = keepMainParts(img);
    expect(alphaAt(kept, 30, 110)).toBe(255);
    expect(alphaAt(kept, 80, 110)).toBe(255);
    expect(alphaAt(kept, 11, 30)).toBe(0);
  });
});

describe("dropping loose edges", () => {
  it("drops a faint line standing apart from the elf, and keeps the soft edge of an outline", () => {
    // A half see through purple stroke OpenAI left beside a brother's hair, 3 November 2026: the
    // colour of a soft edge, but with no solid paint beside it.
    const img = keyOut(blank());
    const put = (x: number, y: number, a: number) => img.data.set([107, 25, 26, a], (y * W + x) * 4);
    for (let y = 40; y < 80; y++) for (let x = 40; x < 60; x++) put(x, y, 255); // an outline, solid
    for (let y = 40; y < 80; y++) put(60, y, 120); // its soft edge
    for (let y = 40; y < 80; y++) put(66, y, 120); // a faint line six pixels away
    const kept = dropLooseEdges(img);
    expect(alphaAt(kept, 50, 50)).toBe(255);
    expect(alphaAt(kept, 60, 50)).toBe(120);
    expect(alphaAt(kept, 66, 50)).toBe(0);
  });
});

describe("a hat hides the hair above its brim", () => {
  it("covers everything above the brim, but not beside the floppy tip", () => {
    // Hair that poked out above a hat fitted on another elf, 3 November 2026.
    const hat = keyOut(blank());
    const put = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hat.data.set([192, 34, 56, 255], (y * W + x) * 4);
    };
    put(20, 10, 80, 40); // the hat and its brim, down to y 40
    put(80, 10, 100, 20); // its floppy tip, out to the side
    const cover = hatCover(hat);
    const at = (x: number, y: number) => cover.data[(y * W + x) * 4 + 3];
    expect(at(30, 2)).toBe(255); // hair above the hat
    expect(at(30, 39)).toBe(255);
    expect(at(30, 45)).toBe(0); // the face below the brim
  });

  it("covers a narrow strip beside the hat above the brim, where hair flicks out, but not the ears below", () => {
    // Flicks of short hair beside the bobble hat and the crown, 3 November 2026.
    const hat = keyOut(blank());
    for (let y = 10; y < 40; y++) for (let x = 60; x < 80; x++) hat.data.set([192, 34, 56, 255], (y * W + x) * 4);
    const cover = hatCover(hat);
    const at = (x: number, y: number) => cover.data[(y * W + x) * 4 + 3];
    expect(at(50, 15)).toBe(255); // ten pixels to the left, high up: hair
    expect(at(50, 38)).toBe(0); // ten pixels to the left, at the brim: an ear
    expect(at(5, 15)).toBe(0); // far to the side: left alone
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
