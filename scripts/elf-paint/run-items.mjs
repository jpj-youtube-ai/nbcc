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
import { alignBlob, CANVAS_H, CANVAS_W, contentBox, fillBox, fitBottomWidth, fitCentred, fitContain, fitHoleOnFloor, holeBox, isMitten, regionCover } from "./fit.mjs";
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

// Where things are on the master elf (measured on a ruled copy, 3 November 2026).
const HEAD_X = 528;
const EYES = { x: 529, y: 545 };
const NECK = 704;
const MITTEN = { x: 315, y: 1000, h: 115, box: { x: 240, y: 930, w: 155, h: 135 } };
const FACE_MIDDLE = 548;
const FLOOR = 1345;

const STYLE =
  "in exactly the same art style as the elf in the reference picture: thick browny red outlines, soft painterly shading and gentle texture. " +
  "Paint the item ONLY, on its own: no elf, no person, no face, no skin, no hair, no body, no shadow, no floor, no text. The background is completely transparent. The item fills most of the picture.";

const SLOT_WORDS = {
  hat: "seen straight from the front at eye level as if worn on a head, so only its outside shows and never the inside of it; its brim or bottom edge is level and straight across, with nothing hanging below the brim (any tip or bobble is above it or to the side, higher than the brim)",
  face: "seen straight from the front as if worn, with completely clear, see through lenses (the lenses are transparent, showing nothing)",
  neck: "seen from the front as if worn round a neck, the gap where the neck goes left transparent",
  top: "seen from the front exactly as the reference elf wears her top: the same shape and size, sleeves angled down and out like her arms, the neck opening empty, ending at the wrists with no hands or mittens",
  feet: "a pair, seen from the front exactly where the reference elf's feet are, standing with feet together, their tops open and empty",
  hand: "held upright by its handle in ONE red knitted mitten exactly like the reference elf's mittens, the mitten at the very bottom of the picture with its thumb wrapped round the handle and its cream cuff showing; paint the mitten too and nothing else",
  extra: "seen from the front as if worn by the reference elf",
};
const EXTRA_WORDS = { satchel: "worn across the body: its strap runs from one shoulder down to the other hip, and the bag sits at that hip" };

function colourWords(c, styleId) {
  const hint = D.colourHints && D.colourHints[`${styleId}:${c.id}`];
  return hint || `${c.name.toLowerCase()} (about ${c.fill})`;
}

/** Every item to paint, in batch order. */
export function itemJobs() {
  const jobs = [];
  for (const style of W.STYLES) {
    const first = style.colours[0];
    style.colours.forEach((c, i) => {
      const what = `${D.styles[style.id]}, in ${colourWords(c, style.id)}`;
      jobs.push({
        id: `item-${style.id}-${c.id}`,
        batch: style.slot,
        slot: style.slot,
        style: style.id,
        layer: `piece-${style.id}-${c.id}`,
        size: style.slot === "feet" ? "1536x1024" : "1024x1024",
        from: i === 0 ? "master" : `item-${style.id}-${first.id}`,
        prompt:
          i === 0
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
    const layer = await fitBottomWidth(img, { width: r.width, bottom: r.bottom, centreX: HEAD_X });
    return { layer, cover: r.pulledOn === false ? null : hatCover(layer) };
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
    const layer = await alignBlob(img, { centreX: MITTEN.x, centreY: MITTEN.y, height: MITTEN.h, band: 0.3 });
    return { layer, cover: regionCover(master, MITTEN.box, isMitten, 3) };
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
    const layer = await fitHoleOnFloor(body, { centreX: EYES.x, centreY: FACE_MIDDLE, floor: FLOOR });
    const hole = holeBox(layer);
    const cover = { data: new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4), width: CANVAS_W, height: CANVAS_H };
    for (let y = 0; y < CANVAS_H; y++)
      for (let x = 0; x < CANVAS_W; x++) {
        const inHole = hole && x >= hole.x && x < hole.x + hole.w && y >= hole.y && y < hole.y + hole.h && layer.data[(y * CANVAS_W + x) * 4 + 3] < 128;
        if (!inHole) cover.data[(y * CANVAS_W + x) * 4 + 3] = 255;
      }
    return { layer, cover };
  }
  let layer = await fillBox(body, { x: 230, y: 690, w: 600, h: 656 });
  // Below the neck, the costume is all of the elf.
  let cover = { data: new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4), width: CANVAS_W, height: CANVAS_H };
  for (let y = NECK; y < CANVAS_H; y++) for (let x = 0; x < CANVAS_W; x++) cover.data[(y * CANVAS_W + x) * 4 + 3] = 255;
  if (head) {
    const hf = o.headFit;
    const hat = await fitBottomWidth(head, { width: hf.width, bottom: hf.bottom, centreX: hf.centreX ?? HEAD_X });
    layer = over(layer, hat);
    if (hf.pulledOn) cover = joinCovers(cover, hatCover(hat));
  }
  return { layer, cover };
}

async function paintAll(jobs, quality) {
  mkdirSync(ITEMS, { recursive: true });
  let left = jobs.filter((j) => !existsSync(itemFile(j.id)));
  while (left.length) {
    const ready = left.filter((j) => j.from === "master" || existsSync(itemFile(j.from)));
    if (!ready.length) throw new Error(`Cannot paint ${left.map((j) => j.id).join(", ")}: their first colour is missing.`);
    for (let i = 0; i < ready.length; i += AT_ONCE) {
      await Promise.all(
        ready.slice(i, i + AT_ONCE).map(async (j) => {
          const src = j.from === "master" ? rawFile("master") : itemFile(j.from);
          await paint({ prompt: j.prompt, images: [src], out: itemFile(j.id), quality, item: true, size: j.size });
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
