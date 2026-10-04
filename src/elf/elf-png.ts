import { drawElf, type WardrobeState } from "./wardrobe";

// NBCC Elf Detective School: a detective's elf as a PNG. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 14).
//
// When a detective unlocks an outfit, the next email shows their own elf wearing it. Mail apps do not
// show SVG, so the drawing is turned into a PNG here, at twice the size it is shown so it stays sharp
// on a phone. The look is made safe by drawElf first, so only what the detective has earned is drawn.
//
// sharp is loaded the first time a picture is made, not when the app starts, the same way
// src/fundraising/picture-process.ts loads it, so a problem with its native library can only ever
// fail one picture, never stop the site.
//
// Unit tested in test/unit/elf-png.test.ts.

/** The widest an elf is ever made, in pixels. */
export const ELF_PNG_MAX_WIDTH = 800;
const ELF_PNG_MIN_WIDTH = 40;

type SharpFn = typeof import("sharp")["default"];
let loaded: Promise<SharpFn> | null = null;

function loadSharp(): Promise<SharpFn> {
  if (!loaded) {
    loaded = import("sharp").then((m) => ((m as unknown as { default?: SharpFn }).default ?? m) as SharpFn);
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}

/** The width actually used: a whole number of pixels, kept between 40 and 800. */
export function elfPngWidth(asked: number): number {
  const width = Number.isFinite(asked) ? Math.round(asked) : 320;
  return Math.min(ELF_PNG_MAX_WIDTH, Math.max(ELF_PNG_MIN_WIDTH, width));
}

/** The elf as a PNG on a see through background, `width` pixels wide and 1.3 times as tall. */
export async function elfPng(look: unknown, state: WardrobeState, width = 320): Promise<Buffer> {
  const px = elfPngWidth(width);
  const svg = drawElf(look, state, { size: px, label: false });
  const sharp = await loadSharp();
  return sharp(Buffer.from(svg)).png().toBuffer();
}
