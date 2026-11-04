import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { lookPictures, type LookPictures, type WardrobeState } from "./wardrobe";

// NBCC Elf Detective School: a detective's elf as a PNG. The design is
// docs/superpowers/specs/2026-11-04-elf-paper-design.md ("Pictures outside the wardrobe").
//
// Detective HQ shows each detective's elf, and emails and the share card can too. Mail apps do not show
// SVG, so the elf is stacked into a PNG here from the same paper pictures the wardrobe's stage lays
// (assets/img/elf/paper/), in the same places: the scene, the elf or its costume, glasses, a bow tie and
// a friend, like a photo of the stage without its frame. The look is made safe by lookPictures first,
// so only what the detective has unlocked is drawn.
//
// The site runs as one small task, and sharp can use a lot of memory, so this is as careful with it
// as src/fundraising/picture-process.ts is:
//   - sharp is loaded the first time a picture is made, not when the app starts, so a problem with
//     its native library can only ever fail one picture, never stop the site;
//   - its cache is off and it works on one thread;
//   - pictures are made one at a time, and when too many are already waiting the answer is "busy"
//     (null) at once, not a queue that grows until the task runs out of memory.
// The two files each keep their own queue, so one photo and one elf can still be made at the same
// moment. Each finished picture is kept (the most recent ELF_PNG_KEEP), since the same look always
// gives the same picture: a family reloading Detective HQ costs nothing.
//
// Unit tested in test/unit/elf-png.test.ts.

/** The widest an elf is ever made, in pixels. */
export const ELF_PNG_MAX_WIDTH = 800;
const ELF_PNG_MIN_WIDTH = 40;

/** How many pictures may wait behind the one being made. One more is told "busy". */
export const ELF_PNG_QUEUE_MAX = 8;

/** The paper pictures, and where each goes on the stage, as fractions of a stage 2 by 3 (the wardrobe
 *  page lays them the same way). The elf's picture is its whole canvas, and so are the glasses and the
 *  bow tie, so all three line up. The friend is fitted in a square and stands on the front of the plinth. */
const PAPER_DIR = resolve(__dirname, "../../assets/img/elf/paper");
const ELF_BOX = { width: 0.537, left: 0.231, top: 0.33 };
const FRIEND_BOX = { width: 0.21, centre: 0.63, feet: 0.82 };
/** The page colour of the site, behind a scene that cannot be read. */
const CREAM = "#F8F5EE";

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

let running = false;
const waiting: (() => void)[] = [];

/** Runs `work` when it is its turn, in the order asked, or answers `busy` at once when the queue is
 *  full. A piece of work that fails does not stop the ones behind it. */
export function inTurn<T>(work: () => Promise<T>, busy: T): Promise<T> {
  if (running && waiting.length >= ELF_PNG_QUEUE_MAX) return Promise.resolve(busy);
  return new Promise<T>((resolve, reject) => {
    const run = (): void => {
      running = true;
      work()
        .then(resolve, reject)
        .finally(() => {
          const next = waiting.shift();
          if (next) next();
          else running = false;
        });
    };
    if (running) waiting.push(run);
    else run();
  });
}

/** The width actually used: a whole number of pixels, kept between 40 and 800. */
export function elfPngWidth(asked: number): number {
  const width = Number.isFinite(asked) ? Math.round(asked) : 320;
  return Math.min(ELF_PNG_MAX_WIDTH, Math.max(ELF_PNG_MIN_WIDTH, width));
}

/**
 * The elf on its stage as a PNG, `width` pixels wide and half as tall again. Null means busy: too many
 * pictures are already waiting, so ask again shortly. The scene fills it, so it is never see through.
 */
export function elfPng(look: unknown, state: WardrobeState, width = 320): Promise<Buffer | null> {
  const px = elfPngWidth(width);
  const pictures = lookPictures(look, state);
  const key = keyOf(pictures, px);
  const kept = made.get(key);
  if (kept) {
    // Kept most recently used last, so the oldest is the one let go.
    made.delete(key);
    made.set(key, kept);
    return Promise.resolve(kept);
  }
  return inTurn<Buffer | null>(async () => {
    try {
      const picture = await stackPng(pictures, px);
      made.set(key, picture);
      if (made.size > ELF_PNG_KEEP) made.delete(made.keys().next().value as string);
      return picture;
    } catch (err) {
      // A sharp problem fails this one picture, never the site (final review, 3 November 2026).
      console.error("elf picture failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }, null);
}

/** How many finished pictures are kept, the most recently used. A picture of 240 pixels is about
 *  100 KB, so this is a few tens of megabytes at most. */
export const ELF_PNG_KEEP = 300;
const made = new Map<string, Buffer>();

function keyOf(pictures: LookPictures, width: number): string {
  return createHash("sha256").update(JSON.stringify([pictures, width])).digest("base64url").slice(0, 22);
}

/** A short name for the picture a look makes: the same look always has the same name, a different
 *  one a different name. Detective HQ sends it as the picture's ETag. */
export function elfPngKey(look: unknown, state: WardrobeState, width = 320): string {
  return keyOf(lookPictures(look, state), elfPngWidth(width));
}

/**
 * Lays the pictures on a stage `width` pixels wide and half as tall again: the scene, then the elf or
 * costume, the glasses, the bow tie and the friend, each in its place. A picture that cannot be found
 * or read is left out, never a failed picture. `dir` is the folder the pictures are in, for tests.
 */
export async function stackPng(pictures: LookPictures, width: number, dir = PAPER_DIR): Promise<Buffer> {
  const sharp = await loadSharp();
  const height = Math.round(width * 1.5);
  const file = (name: string) => resolve(dir, name);
  // A picture whose file is missing or cannot be read is left out, so one bad file can only cost
  // that picture, never the elf or the site (final review, 3 November 2026).
  const readable = async (name: string | null): Promise<boolean> => {
    if (!name || !existsSync(file(name))) return false;
    try {
      await sharp(file(name)).metadata();
      return true;
    } catch {
      return false;
    }
  };

  const parts: import("sharp").OverlayOptions[] = [];
  if (await readable(pictures.scene)) parts.push({ input: await sharp(file(pictures.scene)).resize(width, height).png().toBuffer(), left: 0, top: 0 });
  const elfWidth = Math.round(width * ELF_BOX.width);
  const elfPlace = { left: Math.round(width * ELF_BOX.left), top: Math.round(height * ELF_BOX.top) };
  for (const name of [pictures.body, pictures.glasses, pictures.bow]) {
    if (await readable(name)) parts.push({ input: await sharp(file(name as string)).resize(elfWidth, Math.round(elfWidth * 1.5)).png().toBuffer(), ...elfPlace });
  }
  if (await readable(pictures.friend)) {
    const box = Math.round(width * FRIEND_BOX.width);
    const { data, info } = await sharp(file(pictures.friend as string)).resize({ width: box, height: box, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    parts.push({ input: data, left: Math.round(width * FRIEND_BOX.centre - info.width / 2), top: Math.round(height * FRIEND_BOX.feet - info.height) });
  }
  return sharp({ create: { width, height, channels: 4, background: CREAM }}).composite(parts).flatten({ background: CREAM }).png().toBuffer();
}
