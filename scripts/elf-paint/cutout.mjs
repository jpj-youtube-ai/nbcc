// NBCC Elf Detective School: the painted dress-up elf (docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md).
//
// Turns paintings into layers that line up. Every painting is on flat magenta, which is cut out
// here: OpenAI's model cannot paint on a clear background, and at low quality its magenta is a
// little off (nearer #E000E0), so the background colour is read from the picture's corners.
//
// A piece is painted twice: once worn by the master elf ("worn"), and once on its own in the same
// place ("alone"). The alone painting is the layer, because cutting a piece out by comparing it
// with the elf drags the elf's hair along with it (found in the test of 3 November 2026). OpenAI
// can move a painting by a few pixels, so the alone painting is lined up to the worn one on the
// piece itself, and the worn one to the master on a part of the elf the piece does not touch.
// Where the master is solid but the worn painting is not (an open mitten replaced by one holding a
// torch), the piece hides that part of the elf: that is its "cover".
//
// Pictures here are { data: Uint8ClampedArray (RGBA), width, height }. Unit tested in
// test/unit/elf-paint-cutout.test.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

/** The sizes every layer is saved at: wardrobe tiles, phones, and the server's emails and print. */
export const SIZES = { tile: 0.12, sm: 0.5, lg: 1.0 };

const CLEAR_WITHIN = 60;
const SOLID_BEYOND = 150;

const at = (img, x, y) => (y * img.width + x) * 4;

/** The background colour: the middle value of the four 16 by 16 corners, channel by channel. */
export function backgroundOf(img) {
  const n = Math.min(16, img.width, img.height);
  const values = [[], [], []];
  for (const [ox, oy] of [[0, 0], [img.width - n, 0], [0, img.height - n], [img.width - n, img.height - n]]) {
    for (let y = oy; y < oy + n; y++)
      for (let x = ox; x < ox + n; x++) {
        const i = at(img, x, y);
        for (let c = 0; c < 3; c++) values[c].push(img.data[i + c]);
      }
  }
  return values.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
}

/** The background made clear, with soft edges, and the pink spill taken off the edges. */
export function keyOut(img) {
  const bg = backgroundOf(img);
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    let r = img.data[i];
    const g = img.data[i + 1];
    let b = img.data[i + 2];
    const dist = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
    const alpha = Math.min(1, Math.max(0, (dist - CLEAR_WITHIN) / (SOLID_BEYOND - CLEAR_WITHIN)));
    if (alpha > 0 && alpha < 1) {
      // Magenta is red and blue with no green: what an edge pixel has of red and blue beyond its
      // green is the background showing through. Take that share off.
      const spill = Math.min(r, b) - g;
      if (spill > 0) {
        r -= spill * (1 - alpha);
        b -= spill * (1 - alpha);
      }
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = Math.round(alpha * 255);
  }
  return { data: out, width: img.width, height: img.height };
}

/** The picture moved by (dx, dy), with background colour filling what is uncovered. */
export function moveBy(img, dx, dy) {
  const bg = backgroundOf(img);
  const out = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const sx = x - dx;
      const sy = y - dy;
      const o = at(img, x, y);
      if (sx >= 0 && sy >= 0 && sx < img.width && sy < img.height) out.set(img.data.subarray(at(img, sx, sy), at(img, sx, sy) + 4), o);
      else out.set([bg[0], bg[1], bg[2], 255], o);
    }
  return { data: out, width: img.width, height: img.height };
}

/** How far `mov` is moved from `ref`, judged only at `points` (pixel positions in `mov`). */
function shiftAt(ref, mov, points, span) {
  const bg = backgroundOf(ref);
  const error = (dx, dy, step) => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < points.length; k += step) {
      const [x, y] = points[k];
      const rx = x - dx;
      const ry = y - dy;
      const m = at(mov, x, y);
      const inside = rx >= 0 && ry >= 0 && rx < ref.width && ry < ref.height;
      const r = inside ? at(ref, rx, ry) : -1;
      for (let c = 0; c < 3; c++) {
        const d = mov.data[m + c] - (r < 0 ? bg[c] : ref.data[r + c]);
        sum += d * d;
      }
      n += 1;
    }
    return n ? sum / n : Infinity;
  };
  let best = { dx: 0, dy: 0, e: Infinity };
  for (let dy = -span; dy <= span; dy += 2)
    for (let dx = -span; dx <= span; dx += 2) {
      const e = error(dx, dy, 4);
      if (e < best.e) best = { dx, dy, e };
    }
  const coarse = best;
  best = { dx: coarse.dx, dy: coarse.dy, e: Infinity };
  for (let dy = coarse.dy - 2; dy <= coarse.dy + 2; dy++)
    for (let dx = coarse.dx - 2; dx <= coarse.dx + 2; dx++) {
      const e = error(dx, dy, 1);
      if (e < best.e) best = { dx, dy, e };
    }
  return { dx: best.dx, dy: best.dy };
}

/** How far `b` is moved from `a`, judged inside box [x0, y0, x1, y1]. */
export function bestShift(a, b, box, span = 24) {
  const points = [];
  const [x0, y0, x1, y1] = box;
  for (let y = Math.max(0, y0); y < Math.min(b.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(b.width, x1); x++) points.push([x, y]);
  return shiftAt(a, b, points, span);
}

/**
 * The layer for a piece, on the master's canvas, and the part of the elf it hides (or null).
 * `opts.still` is a box the piece does not touch, used to line the worn painting up with the master.
 */
export function isolate(alone, worn, master, opts = {}) {
  const still = opts.still || [300, 1000, 720, 1400];
  const span = opts.span || 24;

  // The worn painting, put back where the master is.
  const w = bestShift(master, worn, still, span);
  const wornBack = moveBy(worn, -w.dx, -w.dy);

  // The piece on its own, lined up with the worn painting on the piece's own pixels.
  const aloneCut = keyOut(alone);
  const points = [];
  for (let y = 0; y < alone.height; y++) for (let x = 0; x < alone.width; x++) if (aloneCut.data[at(alone, x, y) + 3] === 255) points.push([x, y]);
  const a = shiftAt(wornBack, alone, points, span);
  const layer = keyOut(moveBy(alone, -a.dx, -a.dy));

  // What of the elf the piece hides: solid in the master, clear once the piece is worn.
  const masterCut = keyOut(master);
  const wornCut = keyOut(wornBack);
  const cover = new Uint8ClampedArray(master.data.length);
  let hidden = 0;
  for (let i = 3; i < cover.length; i += 4) {
    if (masterCut.data[i] > 128 && wornCut.data[i] < 128) {
      cover[i] = 255;
      hidden += 1;
    }
  }
  return { layer, cover: hidden ? { data: cover, width: master.width, height: master.height } : null };
}

/** The picture cut down to what is painted, and where that was. */
export function cropToContent(img) {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[at(img, x, y) + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { img: { data: new Uint8ClampedArray(4), width: 1, height: 1 }, x: 0, y: 0 };
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) data.set(img.data.subarray(at(img, x0, y0 + y), at(img, x0 + width, y0 + y)), y * width * 4);
  return { img: { data, width, height }, x: x0, y: y0 };
}

async function writeOne(dir, file, img) {
  for (const [size, scale] of Object.entries(SIZES)) {
    mkdirSync(join(dir, size), { recursive: true });
    await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
      .resize(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)))
      .webp({ quality: 82, alphaQuality: 90 })
      .toFile(join(dir, size, `${file}.webp`));
  }
}

/**
 * Saves a layer (and its cover, if any) at every size under `dir`, and records where each sits on
 * the canvas in `dir`/places.json. A cover is saved black, with its clearness as the mask.
 */
export async function writeSizes(dir, name, layer, cover = null) {
  const crop = cropToContent(layer);
  await writeOne(dir, name, crop.img);
  const place = { x: crop.x, y: crop.y, w: crop.img.width, h: crop.img.height };
  if (cover) {
    const c = cropToContent(cover);
    for (let i = 0; i < c.img.data.length; i += 4) c.img.data.fill(0, i, i + 3);
    await writeOne(dir, `${name}.cover`, c.img);
    place.cover = { x: c.x, y: c.y, w: c.img.width, h: c.img.height };
  }
  const file = join(dir, "places.json");
  const places = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  places[name] = place;
  const sorted = Object.fromEntries(Object.keys(places).sort().map((k) => [k, places[k]]));
  writeFileSync(file, JSON.stringify(sorted, null, 1) + "\n");
  return place;
}
