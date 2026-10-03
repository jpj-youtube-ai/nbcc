import type { Sharp } from "sharp";
import type { PictureKind } from "./pictures";
import { MAX_IMAGE_BYTES } from "../newsletter/image-validation";

// Profile pictures (Jaimie, 2026-10-03): every picture an organiser sends is made again here before
// it is stored. The browser has already made it smaller (and cropped a profile photo square, where
// they dragged it), but nothing the browser sends is trusted:
//
//   - opened only if it is a real JPEG, PNG or WebP of a sensible size: at most 3 million pixels
//     (the browser sends 1600 pixels at most, 2.6 million), so a small file that opens into a huge
//     picture cannot run the service (one 512 MB task) out of memory; anything damaged or cut short
//     is refused rather than guessed at;
//   - turned the right way up (phones store some photos on their side, with a note saying so);
//   - made smaller: a profile photo 400 pixels square from its middle, a main photo within 1600
//     pixels on its longest side, never made bigger;
//   - saved again as a fresh JPEG, with a white background behind anything see through. Nothing
//     from the camera is copied across: not where it was taken, not the phone, not the time. A busy
//     picture over the 2 MB limit is saved again at a lower quality, and refused if even that is over.
//
// One picture is made at a time in this process, with a few more waiting their turn; past that the
// answer is "busy" at once, rather than a queue that grows until the task runs out of memory.
//
// sharp is loaded the first time a picture is made, not when the app starts, so a problem with its
// native library can only ever fail an upload, never stop the site.
//
// Unit tested with real pictures in test/unit/fundraising-picture-process.test.ts.

export const PROFILE_PX = 400;
export const MAIN_MAX_PX = 1600;
/** Pictures waiting their turn while one is being made. */
export const QUEUE_MAX = 3;
const MAX_INPUT_PIXELS = 3_000_000;
const QUALITIES = [82, 70, 58];
const FORMATS = new Set(["jpeg", "png", "webp"]);

export type Processed =
  | { ok: true; mime: "image/jpeg"; bytes: Buffer; width: number; height: number }
  | { ok: false; reason: "unreadable" | "size" | "busy" };

type SharpFn = typeof import("sharp")["default"];
let loaded: Promise<SharpFn> | null = null;
function loadSharp(): Promise<SharpFn> {
  if (!loaded) {
    loaded = import("sharp").then((m) => {
      const sharp = ((m as unknown as { default?: SharpFn }).default ?? m) as SharpFn;
      // Nothing kept between pictures, and libvips' own threads kept to one.
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

// --- one at a time --------------------------------------------------------------------------------
let running = false;
const waiting: Array<() => void> = [];

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else running = false;
}

/** Runs `work` when it is its turn, or answers busy at once when the queue is full. */
function inTurn<T>(work: () => Promise<T>, busy: T): Promise<T> {
  if (running && waiting.length >= QUEUE_MAX) return Promise.resolve(busy);
  const turn = running ? new Promise<void>((go) => waiting.push(go)) : Promise.resolve();
  running = true;
  return turn.then(() => work()).finally(release);
}

export function processPicture(kind: PictureKind, input: Buffer, opts: { maxBytes?: number } = {}): Promise<Processed> {
  return inTurn(() => make(kind, input, opts.maxBytes ?? MAX_IMAGE_BYTES), { ok: false, reason: "busy" } as Processed);
}

async function make(kind: PictureKind, input: Buffer, maxBytes: number): Promise<Processed> {
  let sharp: SharpFn;
  try {
    sharp = await loadSharp();
  } catch (err) {
    console.error("picture processing unavailable:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "unreadable" };
  }
  try {
    const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" } as const;
    const meta = await sharp(input, options).metadata();
    if (!meta.format || !FORMATS.has(meta.format) || !meta.width || !meta.height) return { ok: false, reason: "unreadable" };
    if (meta.width * meta.height > MAX_INPUT_PIXELS) return { ok: false, reason: "unreadable" };
    for (const quality of QUALITIES) {
      const img = sharp(input, options).rotate();
      let sized: Sharp;
      if (kind === "profile") {
        // Square, and never bigger than the picture's own shorter side.
        const side = Math.min(PROFILE_PX, meta.width, meta.height);
        sized = img.resize(side, side, { fit: "cover", position: "centre" });
      } else {
        sized = img.resize(MAIN_MAX_PX, MAIN_MAX_PX, { fit: "inside", withoutEnlargement: true });
      }
      const { data, info } = await sized.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      if (data.length <= maxBytes) return { ok: true, mime: "image/jpeg", bytes: data, width: info.width, height: info.height };
    }
    return { ok: false, reason: "size" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
