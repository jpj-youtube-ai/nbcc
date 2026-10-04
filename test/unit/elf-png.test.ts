import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { ELF_PNG_MAX_WIDTH, ELF_PNG_QUEUE_MAX, elfPng, elfPngWidth, inTurn } from "../../src/elf/elf-png";
import { HAIR_STYLES, OUTFITS, STYLES, defaultLook, drawPiece, type WardrobeState } from "../../src/elf/wardrobe";

// NBCC Elf Detective School: a detective's elf as a PNG, for emails. Made with the real sharp, so
// this proves the drawing is one sharp can read, patterns and all. Because it draws real pixels, it
// is also where the things only an eye would notice are held: that the hair colour shows, that
// every piece draws something, that two tartans can be told apart.

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

/** How many pixels of a drawing have something on them, and the average colour of those. */
async function drawn(svg: string): Promise<{ count: number; colour: number[] }> {
  const data = await pixels(svg);
  const sum = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    count += 1;
    for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  }
  return { count, colour: sum.map((s) => s / Math.max(count, 1)) };
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
  it("shows the hair colour under every hat and in every hair style", async () => {
    // A hat is always worn. If it hid the hair, choosing a hair colour would seem to do nothing.
    const hats = STYLES.filter((s) => s.slot === "hat");
    for (const hairStyle of HAIR_STYLES) {
      for (const hat of hats) {
        const look = defaultLook();
        look.hairStyle = hairStyle.id;
        look.pieces.hat = [hat.id, hat.colours[0].id];
        const dark = await png({ ...look, hair: "dark" }, EVERYTHING, 200);
        const blonde = await png({ ...look, hair: "blonde" }, EVERYTHING, 200);
        // 200 by 260 is 52,000 pixels: 300 of them is a patch of hair anyone can see.
        expect(await pixelsThatDiffer(dark, blonde), `${hairStyle.id} hair under the ${hat.id} hat`).toBeGreaterThan(300);
      }
    }
  });

  it("draws something for every piece in every colour, and as much in one colour as in another", async () => {
    // A colour whose pattern is missing draws as a hole. A piece that draws nothing draws nothing.
    for (const style of STYLES) {
      const counts: number[] = [];
      for (const colour of style.colours) counts.push((await drawn(drawPiece(style.id, colour.id, 80))).count);
      const most = Math.max(...counts);
      expect(most, style.id).toBeGreaterThan(100);
      for (const [i, count] of counts.entries()) {
        expect(count, `${style.id} ${style.colours[i].id}`).toBeGreaterThan(most * 0.8);
      }
    }
  });

  it("draws every outfit as a picture that is plainly a different costume", async () => {
    const plain = await png(defaultLook(), EVERYTHING, 200);
    for (const outfit of OUTFITS) {
      const worn = await png({ ...defaultLook(), outfit: outfit.id }, EVERYTHING, 200);
      expect(await pixelsThatDiffer(plain, worn), outfit.id).toBeGreaterThan(outfit.id === "workshop" ? 800 : 3000);
    }
  });

  it("makes the red tartan and the green tartan easy to tell apart", async () => {
    const red = (await drawn(drawPiece("tartan", "red", 80))).colour;
    const green = (await drawn(drawPiece("tartan", "green", 80))).colour;
    expect(Math.hypot(...red.map((v, i) => v - green[i]))).toBeGreaterThan(60);
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
