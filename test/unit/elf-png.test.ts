import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ELF_PNG_MAX_WIDTH, ELF_PNG_QUEUE_MAX, elfPng, elfPngKey, elfPngWidth, inTurn, stackPng } from "../../src/elf/elf-png";
import { defaultLook, type WardrobeState } from "../../src/elf/wardrobe";

// NBCC Elf Detective School: a detective's elf as a PNG, for emails and Detective HQ, stacked from the
// paper pictures with the real sharp, the way the wardrobe's stage lays them: the scene, the elf or its
// costume, glasses, a bow tie and a friend. Because it makes real pixels, it is also where the places
// on the stage are held.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NONE: WardrobeState = { doors: [] };
const ALL: WardrobeState = { doors: Array.from({ length: 24 }, (_, i) => i + 1) };

/** An elf picture, or a failed test if the queue said it was busy. */
async function png(look: unknown, state: WardrobeState, width?: number): Promise<Buffer> {
  const made = await elfPng(look, state, width);
  if (!made) throw new Error("the picture queue was busy");
  return made;
}

/** The colour at a point given as fractions of the picture's width and height. */
async function at(picture: Buffer, fx: number, fy: number): Promise<number[]> {
  const { data, info } = await sharp(picture).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const x = Math.round(fx * (info.width - 1)), y = Math.round(fy * (info.height - 1));
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

/** How many pixels are not the same in two pictures of one size. */
async function pixelsThatDiffer(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([a, b].map((p) => sharp(p).ensureAlpha().raw().toBuffer()));
  let count = 0;
  for (let i = 0; i < x.length; i += 4) {
    if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) count += 1;
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
  it("is a real PNG of the width asked for, 2 by 3 like the stage", async () => {
    const picture = await png(defaultLook(), NONE, 240);
    expect(picture.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const meta = await sharp(picture).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 240, 360]);
  });

  it("is never see through: the scene fills it, so no mail app can lose the elf against a dark page", async () => {
    const picture = await png(defaultLook(), NONE, 100);
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expect((await at(picture, fx, fy))[3]).toBe(255);
  });

  it("draws only what has been unlocked", async () => {
    const cheeky = await png({ ...defaultLook(), costume: "santa" }, NONE, 120);
    const honest = await png(defaultLook(), NONE, 120);
    expect(cheeky.equals(honest)).toBe(true);
  });

  it("draws the costume chosen, plainly different from the plain elf", async () => {
    const plain = await png(defaultLook(), ALL, 160);
    const tree = await png({ ...defaultLook(), costume: "tree" }, ALL, 160);
    // 160 by 240 is 38,400 pixels: a costume changes far more than a thousand of them.
    expect(await pixelsThatDiffer(plain, tree)).toBeGreaterThan(1000);
  });

  it("stacks the scene, the costume and the friend where the stage puts them", async () => {
    const scene = await png({ ...defaultLook(), scene: "largs" }, ALL, 160);
    const dressed = await png({ ...defaultLook(), scene: "largs", costume: "reindeer", friend: "robin" }, ALL, 160);
    // The elf's middle, and the friend's body just above its feet on the front of the plinth (the
    // places themselves are held exactly below, with made up pictures).
    for (const [fx, fy] of [[0.5, 0.6], [0.63, 0.76]]) expect(await at(dressed, fx, fy), `${fx}, ${fy}`).not.toEqual(await at(scene, fx, fy));
  });

  it("makes a picture once and keeps it, since the same look always gives the same picture", async () => {
    const first = await png({ ...defaultLook(), skin: "s4" }, ALL, 90);
    const again = await png({ ...defaultLook(), skin: "s4" }, ALL, 90);
    expect(again).toBe(first);
    expect(elfPngKey({ ...defaultLook(), skin: "s4" }, ALL, 90)).toBe(elfPngKey({ ...defaultLook(), skin: "s4" }, ALL, 90));
    expect(elfPngKey({ ...defaultLook(), skin: "s4" }, ALL, 90)).not.toBe(elfPngKey({ ...defaultLook(), skin: "s5" }, ALL, 90));
    expect(elfPngKey({ ...defaultLook(), skin: "s4" }, ALL, 90)).not.toBe(elfPngKey({ ...defaultLook(), skin: "s4" }, ALL, 91));
  });

  it("gives the same pictures when several are asked for at once", async () => {
    const looks = ["s1", "s3", "s5"].map((skin) => ({ ...defaultLook(), skin }));
    const together = await Promise.all(looks.map((look) => png(look, ALL, 80)));
    for (const [i, look] of looks.entries()) {
      expect(together[i].equals(await png(look, ALL, 80)), look.skin).toBe(true);
    }
  });
});

describe("the places on the stage", () => {
  // Made up pictures, written as real files: a holly scene, an elf that fills its whole canvas in
  // cream, glasses as a blue band across the eyes, a bow tie as a gold square at the collar, and a
  // purple friend, so each one's place on the stage can be read back from the pixels.
  const dir = mkdtempSync(join(tmpdir(), "elf-png-paper-"));
  const solid = (w: number, h: number, colour: string) => sharp({ create: { width: w, height: h, channels: 4, background: colour } }).webp({ lossless: true }).toBuffer();
  const onCanvas = async (box: { left: number; top: number; width: number; height: number }, colour: string) =>
    sharp({ create: { width: 640, height: 960, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await solid(box.width, box.height, colour), left: box.left, top: box.top }])
      .webp({ lossless: true })
      .toBuffer();
  const PICTURES = { scene: "scene.webp", body: "body.webp", glasses: "glasses.webp", bow: "bow.webp", friend: "friend.webp" };

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "scene.webp"), await solid(640, 960, "#1A531A"));
    writeFileSync(join(dir, "body.webp"), await solid(640, 960, "#F2E6CF"));
    writeFileSync(join(dir, "glasses.webp"), await onCanvas({ left: 240, top: 320, width: 160, height: 30 }, "#2F5D8C"));
    writeFileSync(join(dir, "bow.webp"), await onCanvas({ left: 290, top: 480, width: 60, height: 40 }, "#D9A93E"));
    writeFileSync(join(dir, "friend.webp"), await solid(200, 200, "#7A3E8C"));
  });

  it("lays the elf 53.7% of the stage wide, 23.1% in and 33% down, over the scene", async () => {
    const picture = await stackPng({ ...PICTURES, glasses: null, bow: null, friend: null }, 400, dir);
    expect((await at(picture, 0.1, 0.1)).slice(0, 3)).toEqual([0x1a, 0x53, 0x1a]);
    expect((await at(picture, 0.5, 0.6)).slice(0, 3)).toEqual([0xf2, 0xe6, 0xcf]);
    // Just inside and just outside each edge of the elf's place.
    expect((await at(picture, 0.24, 0.6)).slice(0, 3)).toEqual([0xf2, 0xe6, 0xcf]);
    expect((await at(picture, 0.22, 0.6)).slice(0, 3)).toEqual([0x1a, 0x53, 0x1a]);
    expect((await at(picture, 0.5, 0.34)).slice(0, 3)).toEqual([0xf2, 0xe6, 0xcf]);
    expect((await at(picture, 0.5, 0.32)).slice(0, 3)).toEqual([0x1a, 0x53, 0x1a]);
  });

  it("puts the glasses and the bow tie on the elf's own canvas, so they line up with it", async () => {
    const picture = await stackPng({ ...PICTURES, friend: null }, 400, dir);
    // The middle of the glasses band (canvas 320, 335) and of the bow tie (canvas 320, 500).
    const onStage = (x: number, y: number) => [0.231 + (x / 640) * 0.537, 0.33 + (y / 960) * 0.537] as const;
    expect((await at(picture, ...onStage(320, 335))).slice(0, 3)).toEqual([0x2f, 0x5d, 0x8c]);
    expect((await at(picture, ...onStage(320, 500))).slice(0, 3)).toEqual([0xd9, 0xa9, 0x3e]);
  });

  it("sits the friend in a square 21% of the stage wide, centred 63% in, its feet at 82% down, over the elf", async () => {
    const picture = await stackPng(PICTURES, 400, dir);
    expect((await at(picture, 0.63, 0.81)).slice(0, 3)).toEqual([0x7a, 0x3e, 0x8c]);
    expect((await at(picture, 0.63, 0.83)).slice(0, 3)).toEqual([0xf2, 0xe6, 0xcf]);
    expect((await at(picture, 0.53, 0.7)).slice(0, 3)).toEqual([0x7a, 0x3e, 0x8c]);
    expect((await at(picture, 0.51, 0.7)).slice(0, 3)).toEqual([0xf2, 0xe6, 0xcf]);
  });

  it("leaves out a picture that is not there, and still makes the picture", async () => {
    const picture = await stackPng({ ...PICTURES, friend: "not-there.webp" }, 200, dir);
    expect((await sharp(picture).metadata()).width).toBe(200);
  });

  it("makes a picture rather than failing when a picture file is broken", async () => {
    writeFileSync(join(dir, "broken.webp"), "not a picture");
    await expect(stackPng({ ...PICTURES, body: "broken.webp" }, 200, dir)).resolves.toBeInstanceOf(Buffer);
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
