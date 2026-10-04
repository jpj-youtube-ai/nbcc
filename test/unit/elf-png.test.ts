import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { ELF_PNG_MAX_WIDTH, elfPng, elfPngWidth, inTurn } from "../../src/elf/elf-png";
import { HAIR_STYLES, STYLES, defaultLook } from "../../src/elf/wardrobe";

// NBCC Elf Detective School: a detective's elf as a PNG, for emails. Made with the real sharp, so
// this proves the drawing is one sharp can read, patterns and all. Because it draws real pixels, it
// is also where the things only an eye would notice are held: that the hair colour shows.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EVERYTHING = { doorsDone: 24, goldSeal: true, wonRace: true };

/** How many pixels are not the same in two pictures of one size. */
async function pixelsThatDiffer(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([a, b].map((png) => sharp(png).ensureAlpha().raw().toBuffer()));
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
    const png = await elfPng(defaultLook(), { doorsDone: 0 }, 200);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(260);
  });

  it("has a see through background", async () => {
    const png = await elfPng(defaultLook(), { doorsDone: 0 }, 100);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(data[3]).toBe(0); // the top left corner is outside the backdrop circle
  });

  it("draws an outfit with a tartan pattern, which sharp must be able to read", async () => {
    const piper = await elfPng({ ...defaultLook(), outfit: "piper" }, EVERYTHING, 200);
    const plain = await elfPng(defaultLook(), EVERYTHING, 200);
    expect(piper.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(piper.equals(plain)).toBe(false);
  });

  it("draws only what has been earned", async () => {
    const cheeky = await elfPng({ ...defaultLook(), outfit: "nessie" }, { doorsDone: 24 }, 120);
    const honest = await elfPng(defaultLook(), { doorsDone: 24 }, 120);
    expect(cheeky.equals(honest)).toBe(true);
  });

  it("gives the same pictures when several are asked for at once", async () => {
    const looks = ["s1", "s3", "s5"].map((skin) => ({ ...defaultLook(), skin }));
    const together = await Promise.all(looks.map((look) => elfPng(look, EVERYTHING, 80)));
    for (const [i, look] of looks.entries()) {
      expect(together[i].equals(await elfPng(look, EVERYTHING, 80)), look.skin).toBe(true);
    }
  });
});

describe("what a child would see", () => {
  it("shows the hair colour under every hat and in every hair style", async () => {
    // A hat is always worn. If it hid the hair, choosing a hair colour would seem to do nothing.
    const hats = STYLES.filter((s) => s.slot === "hat");
    for (const hairStyle of HAIR_STYLES) {
      for (const hat of hats) {
        const look = defaultLook();
        look.hairStyle = hairStyle.id;
        look.pieces.hat = [hat.id, hat.colours[0].id];
        const dark = await elfPng({ ...look, hair: "dark" }, EVERYTHING, 200);
        const blonde = await elfPng({ ...look, hair: "blonde" }, EVERYTHING, 200);
        // 200 by 260 is 52,000 pixels: 300 of them is a patch of hair anyone can see.
        expect(await pixelsThatDiffer(dark, blonde), `${hairStyle.id} hair under the ${hat.id} hat`).toBeGreaterThan(300);
      }
    }
  });
});

describe("making pictures one at a time", () => {
  it("never runs two pieces of work at once, and keeps them in the order asked", async () => {
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const work = (n: number) => async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((done) => setTimeout(done, 5));
      order.push(n);
      running -= 1;
      return n;
    };
    const results = await Promise.all([1, 2, 3, 4].map((n) => inTurn(work(n))));
    expect(results).toEqual([1, 2, 3, 4]);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(most).toBe(1);
  });

  it("carries on after one piece of work fails", async () => {
    const failed = inTurn(async () => {
      throw new Error("no picture");
    });
    const next = inTurn(async () => "made");
    await expect(failed).rejects.toThrow("no picture");
    await expect(next).resolves.toBe("made");
  });
});
