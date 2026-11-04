// NBCC Elf Detective School: the painted dress-up elf, second way.
//
// Jaimie, 3 November 2026: "you should have been rendering these things as separate items that are on
// transparent backgrounds". Cutting pieces out of paintings of the elf wearing them left pale, broken
// and doubled edges. So every piece and outfit is now painted ON ITS OWN, on a clear background
// (OpenAI's gpt-image-1.5 can do that), and this file fits it onto the 1024 by 1536 canvas where it
// belongs on the elf: a hat by the width of its brim, sat on the brow; glasses centred on the eyes;
// a gadget by the mitten that holds it, put on the elf's own mitten; a top or a pair of shoes
// stretched to the box the elf's own top or socks fill; a hooded costume by its face hole. Nothing is
// ever cut out of a painting of the elf, so every edge is the edge OpenAI painted.
//
// Pictures here are { data: Uint8ClampedArray (RGBA), width, height }. Unit tested in
// test/unit/elf-paint-fit.test.ts.
import sharp from "sharp";

export const CANVAS_W = 1024;
export const CANVAS_H = 1536;

const at = (img, x, y) => (y * img.width + x) * 4;

/** The box round everything painted (more than faintly) in a clear picture, or null. */
export function contentBox(img, threshold = 16) {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[at(img, x, y) + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The part of `img` inside `box`, resized to w by h with a good filter. */
async function scaled(img, box, w, h) {
  const out = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(out.data.buffer, out.data.byteOffset, out.data.byteLength), width: out.info.width, height: out.info.height };
}

/** A clear canvas with `piece` drawn on it, its top left at (x, y); whatever falls off is dropped. */
function onCanvas(piece, x, y) {
  const out = { data: new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4), width: CANVAS_W, height: CANVAS_H };
  const left = Math.round(x);
  const top = Math.round(y);
  for (let py = 0; py < piece.height; py++) {
    const cy = top + py;
    if (cy < 0 || cy >= CANVAS_H) continue;
    for (let px = 0; px < piece.width; px++) {
      const cx = left + px;
      if (cx < 0 || cx >= CANVAS_W) continue;
      out.data.set(piece.data.subarray((py * piece.width + px) * 4, (py * piece.width + px) * 4 + 4), (cy * CANVAS_W + cx) * 4);
    }
  }
  return out;
}

/** Stretched to fill `target` ({ x, y, w, h }) exactly: tops, shoes and outfit bodies. */
export async function fillBox(img, target) {
  const b = contentBox(img);
  return onCanvas(await scaled(img, b, target.w, target.h), target.x, target.y);
}

/** A hat: scaled so its brim (the bottom `band` of it) is `width` wide, centred on `centreX`, with
 *  its lowest point on `bottom`. A floppy tip off to one side does not count toward the width. */
export async function fitBottomWidth(img, { width, bottom, centreX, band = 0.12 }) {
  const b = contentBox(img);
  const from = Math.floor(b.y + b.h * (1 - band));
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let y = from; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++)
      if (img.data[at(img, x, y) + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
  const scale = width / (x1 - x0 + 1);
  const piece = await scaled(img, b, b.w * scale, b.h * scale);
  return onCanvas(piece, centreX - ((x0 + x1 + 1) / 2 - b.x) * scale, bottom - piece.height);
}

/** Scaled to `width` and centred on (centreX, centreY): glasses, a badge, a bow tie. */
export async function fitCentred(img, { width, centreX, centreY }) {
  const b = contentBox(img);
  const scale = width / b.w;
  const piece = await scaled(img, b, b.w * scale, b.h * scale);
  return onCanvas(piece, centreX - piece.width / 2, centreY - piece.height / 2);
}

/** Pixels of the red knitted mitten a gadget is held in. */
export function isMitten(r, g, b) {
  return r > 140 && g < 100 && b < 100 && r > g * 1.8;
}

/** A gadget: scaled so the mitten holding it is `height` tall, with that mitten's middle put on
 *  (centreX, centreY), where the elf's own open mitten is. */
export async function alignBlob(img, { centreX, centreY, height, pick = isMitten, band = 1 }) {
  const b = contentBox(img);
  let n = 0;
  let sx = 0;
  let sy = 0;
  let top = Infinity;
  let bottom = -Infinity;
  // Only the bottom `band` of the item is looked at: a gadget is held at its bottom, and may itself
  // be red (a red torch, 4 November 2026).
  for (let y = Math.floor(b.y + b.h * (1 - band)); y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = at(img, x, y);
      if (img.data[i + 3] > 200 && pick(img.data[i], img.data[i + 1], img.data[i + 2])) {
        n++;
        sx += x;
        sy += y;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  if (!n) throw new Error("No mitten found in the gadget's painting.");
  const scale = height / (bottom - top + 1);
  const piece = await scaled(img, b, b.w * scale, b.h * scale);
  return onCanvas(piece, centreX - (sx / n + 0.5 - b.x) * scale, centreY - (sy / n + 0.5 - b.y) * scale);
}

/** Scaled to fit within `width` and `height` (whichever is tighter), centred on `centreX`, with its
 *  top on `top`: a scarf, whose ends can hang long. */
export async function fitContain(img, { width, height, centreX, top }) {
  const b = contentBox(img);
  const scale = Math.min(width / b.w, height / b.h);
  const piece = await scaled(img, b, b.w * scale, b.h * scale);
  return onCanvas(piece, centreX - piece.width / 2, top);
}

/** The clear hole inside a costume (clear pixels that cannot reach the edge of what is painted
 *  without crossing paint): its box, or null when there is none. */
export function holeBox(img) {
  const b = contentBox(img);
  if (!b) return null;
  const w = b.w;
  const h = b.h;
  const clear = (x, y) => img.data[at(img, b.x + x, b.y + y) + 3] < 128;
  const outside = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => {
    if (clear(x, y) && !outside[y * w + x]) {
      outside[y * w + x] = 1;
      stack.push(x, y);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (x + 1 < w) seed(x + 1, y);
    if (x > 0) seed(x - 1, y);
    if (y + 1 < h) seed(x, y + 1);
    if (y > 0) seed(x, y - 1);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (clear(x, y) && !outside[y * w + x]) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return n > 50 ? { x: b.x + x0, y: b.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
}

/** A hooded costume: scaled so its face hole is `width` wide, the hole centred on `centreX` with
 *  its bottom on the `chin`. */
export async function fitHole(img, { centreX, chin, width }) {
  const b = contentBox(img);
  const hole = holeBox(img);
  if (!hole) throw new Error("No face hole found in the costume's painting.");
  const scale = width / hole.w;
  const piece = await scaled(img, b, b.w * scale, b.h * scale);
  return onCanvas(piece, centreX - (hole.x + hole.w / 2 - b.x) * scale, chin - (hole.y + hole.h - b.y) * scale);
}

/** A hooded costume, stood on the floor: scaled so that, with its feet on `floor`, the middle of its
 *  face hole is at `centreY`, and moved across so that middle is at `centreX`. However big OpenAI
 *  paints the hole, the costume is then the elf's own size (the first trial was far too big). */
export async function fitHoleOnFloor(img, { centreX, centreY, floor }) {
  const b = contentBox(img);
  const hole = holeBox(img);
  if (!hole) throw new Error("No face hole found in the costume's painting.");
  const fromHoleToFeet = b.y + b.h - (hole.y + hole.h / 2);
  const scale = (floor - centreY) / fromHoleToFeet;
  const piece = await scaled(img, b, b.w * scale, b.h * scale);
  return onCanvas(piece, centreX - (hole.x + hole.w / 2 - b.x) * scale, floor - piece.height);
}

/** Grown by `r` pixels each way: where any pixel within `r` is set. `set` is one byte per pixel. */
function grow(set, width, height, r) {
  if (!r) return set;
  const across = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) {
      if (set[y * width + x]) last = x;
      if (x - last <= r) across[y * width + x] = 1;
    }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (set[y * width + x]) last = x;
      if (last - x <= r) across[y * width + x] = 1;
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) {
      if (across[y * width + x]) last = y;
      if (y - last <= r) out[y * width + x] = 1;
    }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (across[y * width + x]) last = y;
      if (last - y <= r) out[y * width + x] = 1;
    }
  }
  return out;
}

function asCover(set, width, height) {
  const out = { data: new Uint8ClampedArray(width * height * 4), width, height };
  for (let p = 0; p < set.length; p++) if (set[p]) out.data[p * 4 + 3] = 255;
  return out;
}

/** A cover hiding all of the elf except where `keep` is solid (a face hole, a bare head). */
export function coverOutside(keep) {
  const set = new Uint8Array(keep.width * keep.height);
  for (let p = 0; p < set.length; p++) set[p] = keep.data[p * 4 + 3] >= 128 ? 0 : 1;
  return asCover(set, keep.width, keep.height);
}

/** A cover hiding the part of the master elf inside `box` whose colour passes `pick` (the open
 *  mitten a gadget replaces, the cream top a top replaces), grown by `by` pixels. */
export function regionCover(master, box, pick, by = 0) {
  const set = new Uint8Array(master.width * master.height);
  for (let y = Math.max(0, box.y); y < Math.min(master.height, box.y + box.h); y++)
    for (let x = Math.max(0, box.x); x < Math.min(master.width, box.x + box.w); x++) {
      const i = at(master, x, y);
      if (master.data[i + 3] > 0 && pick(master.data[i], master.data[i + 1], master.data[i + 2])) set[y * master.width + x] = 1;
    }
  return asCover(grow(set, master.width, master.height, by), master.width, master.height);
}
