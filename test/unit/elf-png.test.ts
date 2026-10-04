import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { ELF_PNG_MAX_WIDTH, elfPng, elfPngWidth } from "../../src/elf/elf-png";
import { defaultLook } from "../../src/elf/wardrobe";

// NBCC Elf Detective School: a detective's elf as a PNG, for emails. Made with the real sharp, so
// this proves the drawing is one sharp can read, patterns and all.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EVERYTHING = { doorsDone: 24, goldSeal: true, wonRace: true };

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
});
