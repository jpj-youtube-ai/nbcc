import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { layersFor, type PaintLayer, type WardrobeState } from "./wardrobe";

// NBCC Elf Detective School: a detective's elf as a PNG. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 14).
//
// When a detective unlocks an outfit, the next email shows their own elf wearing it, and Detective HQ
// shows each detective's elf. Mail apps do not show SVG, and an SVG in an <img> cannot load the
// painted layers it names, so the elf is stacked into a PNG here from the large painted layers
// (assets/img/elf/lg/, design docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md), in
// the same order and with the same covers as the browser. The look is made safe by layersFor first,
// so only what the detective has earned is drawn.
//
// The site runs as one small task, and sharp can use a lot of memory, so this is as careful with it
// as src/fundraising/picture-process.ts is:
//   - sharp is loaded the first time a picture is made, not when the app starts, so a problem with
//     its native library can only ever fail one picture, never stop the site;
//   - its cache is off and it works on one thread;
//   - pictures are made one at a time, and when too many are already waiting the answer is "busy"
//     (null) at once, not a queue that grows until the task runs out of memory.
// The two files each keep their own queue, so one photo and one elf can still be made at the same
// moment. Whoever first serves these pictures should give the two a single queue, and keep each
// picture once it is made: the same look always gives the same picture, and there are not many.
//
// Unit tested in test/unit/elf-png.test.ts.

/** The widest an elf is ever made, in pixels. */
export const ELF_PNG_MAX_WIDTH = 800;
const ELF_PNG_MIN_WIDTH = 40;

/** How many pictures may wait behind the one being made. One more is told "busy". */
export const ELF_PNG_QUEUE_MAX = 8;

/** The page colour of the site, for a picture that must not be see through. */
const CREAM = "#F8F5EE";

/** The large painted layers, and the part of the canvas every picture shows (1.3 times as tall as wide). */
const LAYER_DIR = resolve(__dirname, "../../assets/img/elf/lg");
const VIEW = { left: -79, width: 1182, height: 1536 };
const BACKDROP =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW.width}" height="${VIEW.height}">` +
  `<circle cx="${512 - VIEW.left}" cy="820" r="560" fill="#EAF0E7"/><ellipse cx="${512 - VIEW.left}" cy="1345" rx="330" ry="34" fill="#DCCFB9"/></svg>`;

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
 * The elf as a PNG, `width` pixels wide and 1.3 times as tall. Null means busy: too many pictures
 * are already waiting, so ask again shortly.
 *
 * The background is see through unless `background` is "cream". Ask for cream in an email: some mail
 * apps turn the page dark, and a see through picture then loses anything dark in it, such as the
 * snowman's hat.
 */
export function elfPng(
  look: unknown,
  state: WardrobeState,
  width = 320,
  background: "clear" | "cream" = "clear",
): Promise<Buffer | null> {
  const px = elfPngWidth(width);
  const layers = layersFor(look, state);
  return inTurn<Buffer | null>(() => stackPng(layers, px, background, true), null);
}

/**
 * Stacks painted layers into a PNG `width` pixels wide and 1.3 times as tall: the backdrop (unless
 * false), the elf with what its pieces hide taken away, then each piece. A layer whose picture cannot
 * be found is left out, never a failed picture. `dir` is the folder of layer files, for tests.
 */
export async function stackPng(layers: PaintLayer[], width: number, background: "clear" | "cream", backdrop: boolean, dir = LAYER_DIR): Promise<Buffer> {
  const sharp = await loadSharp();
  const file = (name: string) => resolve(dir, `${name}.webp`);
  const found = layers.filter((l) => existsSync(file(l.name)));
  const place = (box: { x: number; y: number }) => ({ left: box.x - VIEW.left, top: box.y });
  const blank = () => sharp({ create: { width: VIEW.width, height: VIEW.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });

  // The elf first, on its own, with every cover taken out of it.
  const [first, ...rest] = found;
  const isElf = !!first && first.name.startsWith("elf-");
  const pieces = isElf ? rest : found;
  const under: import("sharp").OverlayOptions[] = [];
  if (isElf) {
    under.push({ input: file(first.name), ...place(first) });
    for (const l of pieces) if (l.cover && existsSync(file(`${l.name}.cover`))) under.push({ input: file(`${l.name}.cover`), ...place(l.cover), blend: "dest-out" });
  }
  const elf = await blank().composite(under).png().toBuffer();

  const over: import("sharp").OverlayOptions[] = [];
  if (backdrop) over.push({ input: Buffer.from(BACKDROP), left: 0, top: 0 });
  over.push({ input: elf, left: 0, top: 0 });
  for (const l of pieces) over.push({ input: file(l.name), ...place(l) });
  const stacked = await blank().composite(over).png().toBuffer();

  const sized = sharp(stacked).resize(width, Math.round(width * 1.3));
  return (background === "cream" ? sized.flatten({ background: CREAM }) : sized).png().toBuffer();
}
