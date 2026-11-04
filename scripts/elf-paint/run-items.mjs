// NBCC Elf Detective School: paints the dress-up elf's pieces and outfits as separate items on clear
// backgrounds, fits each onto the canvas, and rewrites the site's list of layers. The second way,
// chosen by Jaimie on 3 November 2026 after the cut out pieces looked bad ("you should have been
// rendering these things as separate items that are on transparent backgrounds").
//
//   node scripts/elf-paint/run-items.mjs <batch> [--only <item id>] [--fit-only]
//
// Batches: hat, face, neck, top, feet, hand, extra, outfits. Needs OPENAI_API_KEY in your own
// environment and the master elf at .elf-paint/raw/master.png. Items are kept in .elf-paint/items/
// (git ignored); an item already painted is never painted again, so a rerun only paints what is
// missing; --only paints one again; --fit-only fits what is painted without asking OpenAI. The
// elves themselves are painted by run.mjs.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { paint, spent } from "./openai.mjs";
import { hatCover, joinCovers, writeSizes } from "./cutout.mjs";
import { alignBlob, CANVAS_H, CANVAS_W, contentBox, fillBox, fitBottomWidth, fitCentred, fitContain, fitHoleOnFloor, heldBehind, isMitten, openFaceHole, regionCover } from "./fit.mjs";
import { LAYER_DIR, buildManifest } from "./manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const RAW = resolve(ROOT, ".elf-paint/raw");
const ITEMS = resolve(ROOT, ".elf-paint/items");
const W = createRequire(import.meta.url)(resolve(ROOT, "assets/js/elf-wardrobe.js"));
const D = JSON.parse(readFileSync(resolve(HERE, "designs.json"), "utf8"));
const I = JSON.parse(readFileSync(resolve(HERE, "items.json"), "utf8"));

export const BATCHES = ["hat", "face", "neck", "top", "feet", "hand", "extra", "outfits"];
const AT_ONCE = 4;
const PAINT_EACH = new Set(["mag"]);
const RECOLOUR_HATS = new Set(["bobble:blue"]);

// Where things are on the master elf (measured on a ruled copy, 3 November 2026).
const HEAD_X = 528;
const EYES = { x: 529, y: 545 };
const NECK = 704;
const MITTEN = { x: 315, y: 1000, h: 115, box: { x: 240, y: 930, w: 155, h: 135 } };
const FACE_MIDDLE = 548;
// Hooded costumes painted on the brother (no bunches to poke out), the rest on the sister.
const BROTHER_HOODS = new Set(["ginger", "tree", "nessie"]);
const HEAD_BOX = [190, 250, 860, 720];
// The elf's face on the canvas (the base elves' skin, measured 4 November 2026).
const FACE_SPAN = { x0: 349, x1: 707, chin: 684 };
// The art's outline colour, and how wide a hood's rim is drawn round its opening.
const OUTLINE = [82, 32, 30];
const RIM = 6;
// A smooth oval round every elf's face, from ear to ear and brow to chin (measured 4 November 2026).
const FACE_OVAL = { cx: 528, cy: 540, rx: 182, ry: 150 };

/** Where `set` is, grown by `r` pixels each way (a square reach). */
function growSet(set, width, height, r) {
  const across = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) { if (set[y * width + x]) last = x; if (x - last <= r) across[y * width + x] = 1; }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) { if (set[y * width + x]) last = x; if (last - x <= r) across[y * width + x] = 1; }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) { if (across[y * width + x]) last = y; if (y - last <= r) out[y * width + x] = 1; }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) { if (across[y * width + x]) last = y; if (last - y <= r) out[y * width + x] = 1; }
  }
  return out;
}

/** The face painted in a costume: the light skin around the middle of the head, with whatever it
 *  encloses (eyes, eyebrows, mouth, cheeks), grown 5 pixels to take its own outline and soft edge. As a mask the
 *  size of the painting, and its box. */
function faceRegion(img, cut) {
  const W = img.width;
  const H = img.height;
  const at = (x, y) => (y * W + x) * 4;
  let seed = null;
  for (let r = 0; r < 160 && !seed; r += 4)
    for (let dy = -r; dy <= r && !seed; dy += 4)
      for (const dx of [-r, r]) {
        const x = 527 + dx;
        const y = 560 + dy;
        const i = at(x, y);
        if (img.data[i] > 220 && img.data[i + 1] > 170 && img.data[i + 2] > 110 && img.data[i + 2] < 200) {
          seed = [x, y];
          break;
        }
      }
  if (!seed) return null;
  const ref = [0, 1, 2].map((c) => img.data[at(seed[0], seed[1]) + c]);
  const ok = (x, y) => {
    const i = at(x, y);
    return Math.hypot(img.data[i] - ref[0], img.data[i + 1] - ref[1], img.data[i + 2] - ref[2]) < 62;
  };
  const inFace = new Uint8Array(W * H);
  const stack = [seed[0], seed[1]];
  inFace[seed[1] * W + seed[0]] = 1;
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 200 || ny < 250 || nx >= 850 || ny >= 800 || inFace[ny * W + nx] || !ok(nx, ny)) continue;
      inFace[ny * W + nx] = 1;
      stack.push(nx, ny);
    }
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inFace[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  // What the skin encloses (eyes, mouth, cheeks) is face too: everything in its box not reachable
  // from the box's edge without crossing skin.
  const outside = new Uint8Array(W * H);
  const st = [];
  const seedOut = (x, y) => { if (!inFace[y * W + x] && !outside[y * W + x]) { outside[y * W + x] = 1; st.push(x, y); } };
  for (let x = x0; x <= x1; x++) { seedOut(x, y0); seedOut(x, y1); }
  for (let y = y0; y <= y1; y++) { seedOut(x0, y); seedOut(x1, y); }
  while (st.length) {
    const y = st.pop();
    const x = st.pop();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (nx >= x0 && ny >= y0 && nx <= x1 && ny <= y1) seedOut(nx, ny);
  }
  const mask = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inFace[y * W + x] || !outside[y * W + x]) mask.data[at(x, y) + 3] = 255;
  // Grown 5 pixels, to take the face's own outline and soft edge too.
  const grown = new Uint8ClampedArray(mask.data);
  for (let y = y0 - 5; y <= y1 + 5; y++)
    for (let x = x0 - 5; x <= x1 + 5; x++) {
      let hit = false;
      for (let dy = -5; dy <= 5 && !hit; dy++) for (let dx = -5; dx <= 5 && !hit; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && xx >= 0 && yy < H && xx < W && mask.data[at(xx, yy) + 3]) hit = true; }
      if (hit) grown[at(x, y) + 3] = 255;
    }
  return { mask: { data: grown, width: W, height: H }, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const HOOD_FACES = {
  tree: { cx: 522, cy: 596, rx: 150, ry: 112 },
  ginger: { cx: 521, cy: 545, rx: 160, ry: 128 },
  reindeer: { cx: 521, cy: 536, rx: 162, ry: 128 },
  nessie: { cx: 519, cy: 560, rx: 160, ry: 124 },
};
// Where the elf's ears poke out of a hood, on both sides (from the four paintings, 4 November 2026).
const EAR_ZONES = [[195, 440, 320, 590], [735, 440, 860, 590]];
// The elf's face, as an ellipse just outside its outline (measured 4 November 2026).
const FACE_HOLE = { cx: 527, cy: 535, rx: 198, ry: 158, rim: 18 };
const FLOOR = 1345;

const STYLE =
  "in exactly the same art style as the elf in the reference picture: thick browny red outlines, soft painterly shading and gentle texture. " +
  "Paint the item ONLY, on its own: no elf, no person, no face, no skin, no hair, no body, no shadow, no floor, no text. The background is completely transparent. The item fills most of the picture.";

const SLOT_WORDS = {
  hat: "seen from the front and very slightly from ABOVE, as if worn on a head and looked down on a little, so the front of the brim is lower than its back and the opening, lining and inside of the hat cannot be seen at all (no dark or coloured inside showing under the brim); the brim is level across, with nothing hanging below it (any tip or bobble is above it or to the side)",
  face: "seen straight from the front as if worn, with completely clear, see through lenses (the lenses are transparent, showing nothing)",
  neck: "seen from the front as if worn round a neck, the gap where the neck goes left transparent",
  top: "seen from the front exactly as the reference elf wears her top: the same shape and size, sleeves angled down and out like her arms, the neck opening empty, ending at the wrists with no hands or mittens",
  feet: "a pair, seen from the front exactly where the reference elf's feet are, standing with feet together, their tops open and empty",
  hand: "on its own, upright, with NO hand and NO mitten: just the object, its handle at the bottom (for a lantern, its carrying ring at the top), as if about to be held",
  extra: "seen from the front as if worn by the reference elf",
};
const EXTRA_WORDS = { satchel: "worn across the front of the body: only the front of its strap shows, running from the bag at one hip up to the opposite shoulder, where it stops as it goes behind the shoulder; no strap round the neck or the back, no loop" };

function colourWords(c, styleId) {
  const hint = D.colourHints && D.colourHints[`${styleId}:${c.id}`];
  return hint || `${c.name.toLowerCase()} (about ${c.fill})`;
}

/** Every item to paint, in batch order. */
export function itemJobs() {
  const jobs = [];
  for (const style of W.STYLES) {
    const first = style.colours[0];
    style.colours.forEach((c, idx) => {
      // OpenAI's safety check refused the magnifying glass's colour changes (4 November 2026), so
      // each of its colours is painted fresh.
      const i = PAINT_EACH.has(style.id) ? 0 : idx;
      const what = `${D.styles[style.id]}, in ${colourWords(c, style.id)}`;
      jobs.push({
        id: `item-${style.id}-${c.id}`,
        batch: style.slot,
        slot: style.slot,
        style: style.id,
        layer: `piece-${style.id}-${c.id}`,
        size: style.slot === "feet" ? "1536x1024" : "1024x1024",
        // A hat is copied from a painting of the elf wearing it, so it is seen as worn, with no inside
        // showing: painted on its own, OpenAI kept showing the inside (4 November 2026).
        // The blue bobble hat as worn showed its inside, so it is recoloured from the red one instead.
        from: style.slot === "hat" && !RECOLOUR_HATS.has(`${style.id}:${c.id}`) ? `raw:worn-${style.id}-${c.id}` : i === 0 ? "master" : `item-${style.id}-${first.id}`,
        prompt: style.slot === "hat" && !RECOLOUR_HATS.has(`${style.id}:${c.id}`)
          ? `This picture shows an elf wearing a hat. Paint ONLY the hat, exactly as it is worn here: the same shape, colour, design, outline and shading, seen from the front exactly as here, with nothing of the elf (no hair, no ears, no face) and a completely transparent background. Where the elf's head was under the hat, the hat's brim simply ends in a clean edge; no inside of the hat shows.`
          : i === 0
            ? `Paint ${what}, ${SLOT_WORDS[style.slot]}${EXTRA_WORDS[style.id] ? `, ${EXTRA_WORDS[style.id]}` : ""}, ${STYLE}`
            : `This is a painted item on a clear background. Paint exactly the same item again: identical shape, size, position, framing, design, outline and shading. Change only its colour: it is now ${colourWords(c, style.id)}. Keep the background completely transparent.`,
      });
    });
  }
  for (const outfit of W.OUTFITS) {
    const o = I.outfits[outfit.id];
    const words =
      o.kind === "hood"
        ? `Paint a whole costume as worn by the elf in the reference picture, front view, in the same pose and proportions as her, filling her whole body from head to feet: ${o.body}. Where her face goes there is a round hole, a little smaller than her face, that is completely transparent: no face, no skin, no hair in it. ${STYLE}`
        : `Paint a costume from the shoulders down only, as worn by the elf in the reference picture, front view, in the same pose and proportions as her body: ${o.body}. No head, no neck, no hat, nothing above the shoulders. ${STYLE}`;
    jobs.push({ id: `item-outfit-${outfit.id}`, batch: "outfits", slot: "outfit", style: outfit.id, layer: `outfit-${outfit.id}`, size: "1024x1536", from: "master", prompt: words });
    if (o.head)
      jobs.push({ id: `item-outfit-${outfit.id}-head`, batch: "outfits", slot: "outfit-head", style: outfit.id, size: "1024x1024", from: "master", prompt: `Paint ${o.head}, ${SLOT_WORDS.hat}, ${STYLE}` });
  }
  return BATCHES.flatMap((b) => jobs.filter((j) => j.batch === b));
}

const itemFile = (id) => join(ITEMS, `${id}.png`);
const rawFile = (id) => join(RAW, `${id}.png`);

async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

/** The master elf with its magenta background made clear (the master is not itself an item). */
async function masterClear() {
  const m = await load(rawFile("master"));
  const { keyOut } = await import("./cutout.mjs");
  return keyOut(m);
}

const isCream = (r, g, b) => r > 200 && g > 175 && b > 130 && r - b < 90;

function over(a, b) {
  // b drawn over a, both full canvas.
  const out = new Uint8ClampedArray(a.data);
  for (let i = 0; i < out.length; i += 4) {
    const ab = b.data[i + 3] / 255;
    const aa = out[i + 3] / 255;
    const ao = ab + aa * (1 - ab);
    if (ao <= 0) continue;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round((b.data[i + c] * ab + out[i + c] * aa * (1 - ab)) / ao);
    out[i + 3] = Math.round(ao * 255);
  }
  return { data: out, width: a.width, height: a.height };
}

/** Hidden only where it is near what is painted, so nothing far from the item is ever taken away. */
function nearOnly(cover, layer, by) {
  const box = contentBox(layer);
  const out = new Uint8ClampedArray(cover.data);
  for (let y = 0; y < CANVAS_H; y++)
    for (let x = 0; x < CANVAS_W; x++)
      if (x < box.x - by || x >= box.x + box.w + by || y < box.y - by || y >= box.y + box.h + by) out[(y * CANVAS_W + x) * 4 + 3] = 0;
  return { data: out, width: CANVAS_W, height: CANVAS_H };
}

/** Fits one painted item onto the canvas: its layer, and what of the elf it hides (or null). */
export async function fitItem(job, img, master) {
  const f = I.fit;
  if (job.slot === "hat") {
    const r = f.hat[job.style];
    let layer;
    if (r.brimAt) {
      // A Santa hat's pom pom hangs below its brim, so it is sized by its whole width and placed by
      // where its brim ends (the brim's lowest point, a fifth of the way across).
      const b = contentBox(img);
      const col = b.x + Math.round(b.w * 0.2);
      let brim = b.y;
      for (let y = b.y; y < b.y + b.h; y++) if (img.data[(y * img.width + col) * 4 + 3] > 16) brim = y;
      const scale = r.width / b.w;
      layer = await fitContain(img, { width: r.width, height: 9999, centreX: HEAD_X + (r.dx || 0), top: r.bottom - (brim - b.y) * scale });
    } else layer = await fitBottomWidth(img, { width: r.width, bottom: r.bottom, centreX: HEAD_X });
    return { layer, cover: r.pulledOn === false ? null : hatCover(layer, r.brimAt ? r.bottom : undefined) };
  }
  if (job.slot === "face") return { layer: await fitCentred(img, { width: f.face[job.style].width, centreX: EYES.x, centreY: EYES.y }), cover: null };
  if (job.slot === "neck") {
    const r = f.neck[job.style];
    if (r.centreY) return { layer: await fitCentred(img, { width: r.width, centreX: HEAD_X, centreY: r.centreY }), cover: null };
    return { layer: await fitContain(img, { width: r.width, height: r.height ?? 330, centreX: HEAD_X, top: r.top }), cover: null };
  }
  if (job.slot === "top" || job.slot === "feet") {
    const layer = await fillBox(img, f[job.slot][job.style]);
    // The elf's own cream top or socks, where they are near the new one, so none peeks out.
    const cover = nearOnly(regionCover(master, { x: 0, y: job.slot === "top" ? NECK : 1150, w: CANVAS_W, h: CANVAS_H }, isCream, 4), layer, 6);
    return { layer, cover };
  }
  if (job.slot === "hand") {
    // Painted without a mitten, scaled by its height, its handle (a lantern's ring) slid into the elf's
    // own mitten, and taken away inside it: the elf's mitten stays on its arm and grips it (Jaimie,
    // 4 November 2026: the painted mittens did not line up with the arms).
    const r = I.fit.hand[job.style];
    const b = contentBox(img);
    const w = b.w * (r.height / b.h);
    const held = job.style === "lantern" ? "top" : "bottom";
    const placed = await fitCentred(img, { width: w, centreX: MITTEN.x + (r.dx || 0), centreY: held === "top" ? MITTEN.y + r.height / 2 - 20 : MITTEN.y - r.height / 2 + 30 });
    return { layer: heldBehind(placed, regionCover(master, MITTEN.box, isMitten, 0)), cover: null };
  }
  if (job.slot === "extra") {
    const r = f.extra[job.style];
    const layer = r.width ? await fitCentred(img, r) : await fillBox(img, r);
    return { layer, cover: null };
  }
  throw new Error(`No fitting for ${job.slot}.`);
}

/** Fits an outfit: a hooded costume by its face hole, or a body (from the shoulders down) with its
 *  headwear on top. The outfit hides every part of the elf it does not show. */
export async function fitOutfit(outfitId, body, head, master) {
  const o = I.outfits[outfitId];
  if (o.kind === "hood") {
    // The costume painted ON the elf with a snug hood, so only her face shows in it (no hair, no ears:
    // 4 November 2026). Its face is found by its skin, with the eyes and mouth inside it; the costume is
    // scaled so that face is as wide as every elf's face, its bottom on the chin; and the face is taken
    // away, so each elf's own face shows there, framed by the hood's real painted edge. Everything else
    // of the elf is hidden.
    const { keyOut } = await import("./cutout.mjs");
    const worn = await load(rawFile(`snug-outfit-${outfitId}`));
    const cut = keyOut(worn);
    const face = faceRegion(worn, cut);
    if (!face) throw new Error(`No face found in the ${outfitId} painting.`);
    // Across, the face opening is as wide as every elf's face; down, from the chin to the feet, the
    // costume reaches the floor (one scale for both made the tree run off the bottom).
    const scale = (FACE_SPAN.x1 - FACE_SPAN.x0 + 1) / face.w;
    let feet = 0;
    for (let i = 3; i < cut.data.length; i += 4) if (cut.data[i] > 128) feet = Math.floor(i / 4 / cut.width);
    const scaleY = Math.min(scale, (FLOOR - FACE_SPAN.chin) / (feet - (face.y + face.h)));
    const left = (FACE_SPAN.x0 + FACE_SPAN.x1) / 2 - (face.x + face.w / 2) * scale;
    const top = FACE_SPAN.chin - (face.y + face.h) * scaleY;
    const place = async (img) => {
      const big = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
        .resize(Math.round(img.width * scale), Math.round(img.height * scaleY), { fit: "fill", kernel: "lanczos3" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const out = new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4);
      const ox = Math.round(left);
      const oy = Math.round(top);
      for (let y = 0; y < big.info.height; y++) {
        const cy = oy + y;
        if (cy < 0 || cy >= CANVAS_H) continue;
        for (let x = 0; x < big.info.width; x++) {
          const cx = ox + x;
          if (cx < 0 || cx >= CANVAS_W) continue;
          const s = (y * big.info.width + x) * 4;
          out.set(big.data.subarray(s, s + 4), (cy * CANVAS_W + cx) * 4);
        }
      }
      return { data: out, width: CANVAS_W, height: CANVAS_H };
    };
    const layer = await place(cut);
    // Its edge smoothed (blurred, then cut at half way), so it runs cleanly along the hood's inner edge
    // instead of in little steps where the paint was uneven (4 November 2026).
    const smooth = await sharp(Buffer.from(face.mask.data.buffer), { raw: { width: face.mask.width, height: face.mask.height, channels: 4 } })
      .extractChannel(3)
      .blur(10)
      .threshold(128)
      .raw()
      .toBuffer();
    const sm = { data: new Uint8ClampedArray(face.mask.data.length), width: face.mask.width, height: face.mask.height };
    for (let q = 0; q < smooth.length; q++) sm.data[q * 4 + 3] = smooth[q];
    const hole = await place(sm);
    // The opening is never more than every elf's own face (the base elf's face, outline and all), so no
    // forehead, neck, bunch or background shows round it; and a clean rim in the outline colour runs
    // round it, as a hood's painted edge does (ragged pale edges showed: 4 November 2026).
    // The opening: the hood's own face opening, smoothed, kept within a smooth oval round every elf's
    // face (the base elf's face ends at her fringe, so following it notched the top: 4 November 2026).
    const open = new Uint8Array(CANVAS_W * CANVAS_H);
    for (let q = 0; q < open.length; q++) {
      const x = q % CANVAS_W;
      const y = (q - x) / CANVAS_W;
      const inOval = Math.hypot((x - FACE_OVAL.cx) / FACE_OVAL.rx, (y - FACE_OVAL.cy) / FACE_OVAL.ry) < 1 && y <= FACE_SPAN.chin;
      if (hole.data[q * 4 + 3] >= 100 && inOval) open[q] = 1;
    }
    const ring = growSet(open, CANVAS_W, CANVAS_H, RIM);
    const cover = { data: new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4), width: CANVAS_W, height: CANVAS_H };
    for (let q = 0; q < open.length; q++) {
      const i = q * 4;
      if (open[q]) layer.data[i + 3] = 0;
      else {
        cover.data[i + 3] = 255;
        // The rim, and any of the hood's painted face left outside the opening (a pale crescent under
        // the chin), become the hood's edge.
        if (ring[q] || hole.data[i + 3] >= 100) layer.data.set([...OUTLINE, 255], i);
      }
    }
    return { layer, cover };
  }
  let layer = await fillBox(body, { x: 230, y: 690, w: 600, h: 656 });
  // From where the costume starts at the neck down, the costume is all of the elf, so the elf's own
  // neck still shows above a collar; and bunches, which hang beside the neck, are never cut flat
  // (4 November 2026).
  let top = CANVAS_H;
  for (let y = 0; y < CANVAS_H && top === CANVAS_H; y++) for (let x = HEAD_X - 60; x < HEAD_X + 60; x++) if (layer.data[(y * CANVAS_W + x) * 4 + 3] > 128) { top = y; break; }
  const from = Math.max(NECK, top);
  let cover = { data: new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4), width: CANVAS_W, height: CANVAS_H };
  for (let y = from; y < CANVAS_H; y++)
    for (let x = 0; x < CANVAS_W; x++) {
      const bunches = (x < 345 || x > 710) && y < 725;
      if (!bunches) cover.data[(y * CANVAS_W + x) * 4 + 3] = 255;
    }
  if (head) {
    const hf = o.headFit;
    // A bonnet with a ribbon tail or a cap with a tassel is narrow at its bottom edge, so those are
    // sized by their whole width (they came out huge, 4 November 2026).
    let hat;
    if (hf.byWidth) {
      const hb = contentBox(head);
      hat = await fitContain(head, { width: hf.width, height: 9999, centreX: hf.centreX ?? HEAD_X, top: hf.bottom - hb.h * (hf.width / hb.w) });
    } else hat = await fitBottomWidth(head, { width: hf.width, bottom: hf.bottom, centreX: hf.centreX ?? HEAD_X });
    layer = over(layer, hat);
    if (hf.pulledOn) cover = joinCovers(cover, hatCover(hat));
  }
  return { layer, cover };
}

/** Only the patches of `set` at least `min` pixels big (8-connected). */
function keepBig(set, width, height, min) {
  const label = new Int32Array(width * height).fill(-1);
  const out = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  for (let s = 0; s < set.length; s++) {
    if (!set[s] || label[s] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = s;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (set[n] && label[n] === -1) {
            label[n] = s;
            queue[tail++] = n;
          }
        }
    }
    if (tail >= min) for (let k = 0; k < tail; k++) out[queue[k]] = 1;
  }
  return out;
}

async function paintAll(jobs, quality) {
  mkdirSync(ITEMS, { recursive: true });
  let left = jobs.filter((j) => !existsSync(itemFile(j.id)));
  while (left.length) {
    const src = (j) => (j.from === "master" ? rawFile("master") : j.from.startsWith("raw:") ? rawFile(j.from.slice(4)) : itemFile(j.from));
    const ready = left.filter((j) => existsSync(src(j)));
    if (!ready.length) throw new Error(`Cannot paint ${left.map((j) => j.id).join(", ")}: their first colour is missing.`);
    for (let i = 0; i < ready.length; i += AT_ONCE) {
      await Promise.all(
        ready.slice(i, i + AT_ONCE).map(async (j) => {
          await paint({ prompt: j.prompt, images: [src(j)], out: itemFile(j.id), quality, item: true, size: j.size });
          console.log(`painted ${j.id} (spent so far $${spent().toFixed(2)})`);
        }),
      );
    }
    left = left.filter((j) => !existsSync(itemFile(j.id)));
  }
}

async function fitAll(jobs) {
  const master = await masterClear();
  for (const j of jobs) {
    if (j.slot === "outfit-head" || !existsSync(itemFile(j.id))) continue;
    let fitted;
    if (j.slot === "outfit") {
      const headId = `${j.id}-head`;
      fitted = await fitOutfit(j.style, await load(itemFile(j.id)), existsSync(itemFile(headId)) ? await load(itemFile(headId)) : null, master);
    } else fitted = await fitItem(j, await load(itemFile(j.id)), master);
    await writeSizes(LAYER_DIR, j.layer, fitted.layer, fitted.cover);
    console.log(`fitted ${j.layer}`);
  }
  buildManifest();
}

async function main() {
  const args = process.argv.slice(2);
  const batch = args[0];
  const flag = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? null : args[i + 1] || true;
  };
  if (!BATCHES.includes(batch)) {
    console.error(`Say which batch: ${BATCHES.join(", ")}`);
    process.exit(2);
  }
  if (!existsSync(rawFile("master"))) {
    console.error(`Put the approved master elf at ${rawFile("master")} first.`);
    process.exit(2);
  }
  let jobs = itemJobs().filter((j) => j.batch === batch);
  const only = flag("--only");
  if (typeof only === "string") {
    jobs = jobs.filter((j) => j.id === only || j.id === `${only}-head`);
    if (!jobs.length) {
      console.error(`There is no item called ${only} in the ${batch} batch.`);
      process.exit(2);
    }
    // Kept aside while it is painted again, and put back if that fails (never when only fitting).
    if (!flag("--fit-only")) for (const j of jobs) if (existsSync(itemFile(j.id))) renameSync(itemFile(j.id), itemFile(`${j.id}.old`));
  }
  if (!flag("--fit-only")) {
    try {
      await paintAll(jobs, flag("--quality") === "high" ? "high" : "low");
    } finally {
      for (const j of jobs) {
        const old = itemFile(`${j.id}.old`);
        if (existsSync(old)) existsSync(itemFile(j.id)) ? rmSync(old) : renameSync(old, itemFile(j.id));
      }
    }
  }
  await fitAll(jobs);
  console.log(`done: ${batch}. Spent so far $${spent().toFixed(2)}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
