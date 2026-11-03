import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ELF_PNG_MAX_WIDTH, ELF_PNG_QUEUE_MAX, elfPng, elfPngWidth, inTurn, stackPng } from "../../src/elf/elf-png";
import { OUTFITS, defaultLook, type WardrobeState } from "../../src/elf/wardrobe";

const PAINT = createRequire(import.meta.url)("../../assets/js/elf-paint.js") as { layers: Record<string, unknown> };

// NBCC Elf Detective School: a detective's elf as a PNG, for emails and Detective HQ, stacked from
// the painted layers with the real sharp. Because it makes real pixels, it is also where the things
// only an eye would notice are held: that the hair colour shows, that the face shows on the darkest
// skin, that a held gadget hides the open mitten, that every outfit looks different.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EVERYTHING = { doorsDone: 24, goldSeal: true, wonRace: true };

/** An elf picture, or a failed test if the queue said it was busy. */
async function png(look: unknown, state: WardrobeState, width?: number, background?: "clear" | "cream"): Promise<Buffer> {
  const made = await elfPng(look, state, width, background);
  if (!made) throw new Error("the picture queue was busy");
  return made;
}

const pixels = (picture: Buffer | string): Promise<Buffer> =>
  sharp(typeof picture === "string" ? Buffer.from(picture) : picture).ensureAlpha().raw().toBuffer();

/** How many pixels are not the same in two pictures of one size. */
async function pixelsThatDiffer(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([pixels(a), pixels(b)]);
  let count = 0;
  for (let i = 0; i < x.length; i += 4) {
    if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) count += 1;
  }
  return count;
}

describe("the width of the picture", () => {
  it("is a whole number of pixels between 40 and 800", () => {
    expect(elfPngWidth(320)).toBe(320);
    expect(elfPngWidth(319.6)).toBe(320);
    expect(elfPngWidth(1)).toBe(40);
    expect(elfPngWidth(5000)).toBe(ELF_PNG_MAX_WIDTH);
    expect(elfPngWidth(Number.NaN)).toBe(320);
  });
});

describe("an elf as a PNG", () => {
  it("is a real PNG of the size asked for, 1.3 times as tall as it is wide", async () => {
    const picture = await png(defaultLook(), { doorsDone: 0 }, 200);
    expect(picture.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const meta = await sharp(picture).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(260);
  });

  it("has a see through background unless it is asked for cream", async () => {
    const clear = await pixels(await png(defaultLook(), { doorsDone: 0 }, 100));
    expect(clear[3]).toBe(0); // the top left corner is outside the backdrop circle
    const cream = await pixels(await png(defaultLook(), { doorsDone: 0 }, 100, "cream"));
    expect([cream[0], cream[1], cream[2], cream[3]]).toEqual([0xf8, 0xf5, 0xee, 255]);
  });

  it("draws only what has been earned", async () => {
    const cheeky = await png({ ...defaultLook(), outfit: "nessie" }, { doorsDone: 24 }, 120);
    const honest = await png(defaultLook(), { doorsDone: 24 }, 120);
    expect(cheeky.equals(honest)).toBe(true);
  });

  it("gives the same pictures when several are asked for at once", async () => {
    const looks = ["s1", "s3", "s5"].map((skin) => ({ ...defaultLook(), skin }));
    const together = await Promise.all(looks.map((look) => png(look, EVERYTHING, 80)));
    for (const [i, look] of looks.entries()) {
      expect(together[i].equals(await png(look, EVERYTHING, 80)), look.skin).toBe(true);
    }
  });
});

describe("what a child would see", () => {
  // Made up layers, written as real files: an elf with an open red mitten, and a torch whose
  // painting no longer has that mitten (its cover marks it), so the server's stacking is held to
  // the same rules as the browser's.
  const dir = mkdtempSync(join(tmpdir(), "elf-png-layers-"));
  const block = (w: number, h: number, colour: string) => sharp({ create: { width: w, height: h, channels: 4, background: colour } }).webp({ lossless: true }).toBuffer();
  const ELF = { name: "elf-test", x: 300, y: 300, w: 400, h: 900, cover: null };
  const MITTEN = { x: 760, y: 900, w: 60, h: 60 };
  const TORCH = { name: "piece-test-torch", x: 820, y: 850, w: 40, h: 160, cover: MITTEN };

  beforeAll(async () => {
    mkdirSync(join(dir, "lg"));
    // The elf's body in cream, with its open mitten in red beside it, painted as one layer.
    const body = await sharp({ create: { width: 520, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await block(400, 900, "#F2E6CF"), left: 0, top: 0 }, { input: await block(60, 60, "#C02238"), left: 460, top: 600 }])
      .webp({ lossless: true })
      .toFile(join(dir, "lg", "elf-test.webp"));
    void body;
    writeFileSync(join(dir, "lg", "piece-test-torch.webp"), await block(40, 160, "#2F5D8C"));
    writeFileSync(join(dir, "lg", "piece-test-torch.cover.webp"), await block(60, 60, "#000000"));
  });

  /** The colour at a canvas point, in a 1182 wide picture. */
  async function at(picture: Buffer, x: number, y: number): Promise<number[]> {
    const { data, info } = await sharp(picture).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + (x + 79)) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }

  it("puts each layer in its place on the canvas, bottom to top", async () => {
    const picture = await stackPng([{ ...ELF, w: 520 }, TORCH], 1182, "clear", false, join(dir, "lg"));
    expect((await at(picture, 350, 500)).slice(0, 3)).toEqual([0xf2, 0xe6, 0xcf]);
    expect((await at(picture, 830, 900)).slice(0, 3)).toEqual([0x2f, 0x5d, 0x8c]);
    expect((await at(picture, 100, 100))[3]).toBe(0);
  });

  it("hides the elf's own mitten when a gadget is held, and only then", async () => {
    const holding = await stackPng([{ ...ELF, w: 520 }, TORCH], 1182, "clear", false, join(dir, "lg"));
    expect((await at(holding, 780, 920))[3]).toBe(0);
    const empty = await stackPng([{ ...ELF, w: 520 }], 1182, "clear", false, join(dir, "lg"));
    expect((await at(empty, 780, 920)).slice(0, 3)).toEqual([0xc0, 0x22, 0x38]);
  });

  it("leaves out a layer whose picture cannot be read, and still makes the picture", async () => {
    const picture = await stackPng([{ ...ELF, w: 520 }, { ...TORCH, name: "piece-not-there", cover: null }], 200, "cream", true, join(dir, "lg"));
    expect((await sharp(picture).metadata()).width).toBe(200);
  });

  // The real paintings: these hold once the elves are painted (plan Task 8).
  const real = (name: string) => name in (PAINT.layers as Record<string, unknown>);

  it.runIf(real("elf-sister-s2-short-dark") && real("elf-sister-s2-short-blonde"))("shows the hair colour chosen", async () => {
    const dark = await png({ ...defaultLook(), hair: "dark" }, EVERYTHING, 200);
    const blonde = await png({ ...defaultLook(), hair: "blonde" }, EVERYTHING, 200);
    // 200 by 260 is 52,000 pixels: 300 of them is a patch of hair anyone can see.
    expect(await pixelsThatDiffer(dark, blonde)).toBeGreaterThan(300);
  });

  it.runIf(real("elf-sister-s5-short-brown"))("keeps the face showing on the darkest skin", async () => {
    // Plain round eyes on the darkest skin: the eyes must be clearly darker than the skin round them.
    // The strip is the row of the eyes on the painted canvas (checked by eye, 3 November 2026).
    const face = await png({ ...defaultLook(), skin: "s5" }, EVERYTHING, 1182);
    const p = PAINT.layers["elf-sister-s5-short-brown"] as { x: number; y: number; w: number };
    const eyeRow = await sharp(face).extract({ left: p.x + 79 + Math.round(p.w * 0.3), top: 525, width: Math.round(p.w * 0.4), height: 60 }).greyscale().raw().toBuffer();
    const sorted = [...eyeRow].sort((a, b) => a - b);
    const darkest = sorted[Math.floor(sorted.length * 0.02)];
    const typical = sorted[Math.floor(sorted.length * 0.5)];
    expect(typical - darkest).toBeGreaterThan(40);
  });

  it.runIf(OUTFITS.every((o) => real(`outfit-${o.id}`)))("makes every outfit plainly different from the plain elf", async () => {
    const plain = await png(defaultLook(), EVERYTHING, 200);
    for (const outfit of OUTFITS) {
      const worn = await png({ ...defaultLook(), outfit: outfit.id }, EVERYTHING, 200);
      expect(await pixelsThatDiffer(plain, worn), outfit.id).toBeGreaterThan(3000);
    }
  });
});

describe("making pictures one at a time", () => {
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

  it("never runs two pieces of work at once, and keeps them in the order asked", async () => {
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const work = (n: number) => async () => {
      running += 1;
      most = Math.max(most, running);
      await pause(5);
      order.push(n);
      running -= 1;
      return n;
    };
    const results = await Promise.all([1, 2, 3, 4].map((n) => inTurn(work(n), -1)));
    expect(results).toEqual([1, 2, 3, 4]);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(most).toBe(1);
  });

  it("carries on after one piece of work fails", async () => {
    const failed = inTurn(async () => {
      throw new Error("no picture");
    }, "busy");
    const next = inTurn(async () => "made", "busy");
    await expect(failed).rejects.toThrow("no picture");
    await expect(next).resolves.toBe("made");
  });

  it("answers busy at once when too many are already waiting, so the queue cannot grow without end", async () => {
    const slow = async () => {
      await pause(15);
      return "made";
    };
    const accepted = Array.from({ length: ELF_PNG_QUEUE_MAX + 1 }, () => inTurn(slow, "busy"));
    const turnedAway = await inTurn(slow, "busy");
    expect(turnedAway).toBe("busy");
    expect(await Promise.all(accepted)).toEqual(accepted.map(() => "made"));
    expect(await inTurn(slow, "busy")).toBe("made");
  });
});
