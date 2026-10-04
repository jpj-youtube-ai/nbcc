import { drawElf, type WardrobeState } from "./wardrobe";

// NBCC Elf Detective School: a detective's elf as a PNG. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 14).
//
// When a detective unlocks an outfit, the next email shows their own elf wearing it. Mail apps do not
// show SVG, so the drawing is turned into a PNG here, at twice the size it is shown so it stays sharp
// on a phone. The look is made safe by drawElf first, so only what the detective has earned is drawn.
//
// The site runs as one small task, and sharp can use a lot of memory, so this is as careful with it
// as src/fundraising/picture-process.ts is:
//   - sharp is loaded the first time a picture is made, not when the app starts, so a problem with
//     its native library can only ever fail one picture, never stop the site;
//   - its cache is off and it works on one thread;
//   - pictures are made one at a time, in the order they were asked for.
// The two files each keep their own queue, so one photo and one elf can still be made at the same
// moment. Whoever first sends these pictures in bulk should give the two a single queue, and keep
// each picture once it is made: the same look always gives the same picture.
//
// Unit tested in test/unit/elf-png.test.ts.

/** The widest an elf is ever made, in pixels. */
export const ELF_PNG_MAX_WIDTH = 800;
const ELF_PNG_MIN_WIDTH = 40;

type SharpFn = typeof import("sharp")["default"];
let loaded: Promise<SharpFn> | null = null;

function loadSharp(): Promise<SharpFn> {
  if (!loaded) {
    loaded = import("sharp").then((m) => {
      const sharp = ((m as unknown as { default?: SharpFn }).default ?? m) as SharpFn;
      sharp.cache(false);
      sharp.concurrency(1);
      return sharp;
    });
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}

let last: Promise<unknown> = Promise.resolve();

/** Runs `work` once everything asked for before it has finished, whether that worked or failed. */
export function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const mine = last.then(work, work);
  last = mine.catch(() => undefined);
  return mine;
}

/** The width actually used: a whole number of pixels, kept between 40 and 800. */
export function elfPngWidth(asked: number): number {
  const width = Number.isFinite(asked) ? Math.round(asked) : 320;
  return Math.min(ELF_PNG_MAX_WIDTH, Math.max(ELF_PNG_MIN_WIDTH, width));
}

/** The elf as a PNG on a see through background, `width` pixels wide and 1.3 times as tall. */
export function elfPng(look: unknown, state: WardrobeState, width = 320): Promise<Buffer> {
  const px = elfPngWidth(width);
  const svg = drawElf(look, state, { size: px, label: false });
  return inTurn(async () => {
    const sharp = await loadSharp();
    return sharp(Buffer.from(svg)).png().toBuffer();
  });
}
