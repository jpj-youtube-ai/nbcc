// NBCC Elf Detective School: paints one batch of the dress-up elf, cuts out its layers, and rewrites
// the site's list of layers. Run on your own computer, with OPENAI_API_KEY set in your own
// environment (never in the repo or CI):
//
//   npm run elf:paint -- <batch> [--only <job id>] [--quality high] [--cut-only]
//
// Batches, in order: elves, starter, hat, top, feet, neck, face, hand, extra, outfits. The master
// elf must be at .elf-paint/raw/master.png first. A painting already in .elf-paint/raw/ is never
// painted again, so a rerun only paints what is missing; --only paints one job again. --cut-only
// cuts out what is already painted without asking OpenAI for anything.
//
// The design is docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { BATCHES, allJobs } from "./jobs.mjs";
import { paint, spent } from "./openai.mjs";
import { bestShift, dropLooseEdges, hatCover, isolate, joinCovers, keepMainParts, keyOut, moveBy, writeSizes } from "./cutout.mjs";
import { LAYER_DIR, buildManifest } from "./manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RAW = resolve(ROOT, ".elf-paint/raw");
const AT_ONCE = 4;
const LEGS = [380, 1050, 640, 1350];

const raw = (id) => join(RAW, `${id}.png`);

async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

/** Paints the jobs in waves: each wave is every job whose picture to edit already exists. */
async function paintAll(jobs, quality) {
  let left = jobs.filter((j) => !existsSync(raw(j.id)));
  while (left.length) {
    const ready = left.filter((j) => existsSync(raw(j.from)));
    if (!ready.length) throw new Error(`Cannot paint ${left.map((j) => j.id).join(", ")}: they need ${[...new Set(left.map((j) => j.from))].join(", ")} first.`);
    for (let i = 0; i < ready.length; i += AT_ONCE) {
      await Promise.all(
        ready.slice(i, i + AT_ONCE).map(async (j) => {
          const tmp = raw(`${j.id}.tmp`);
          await paint({ prompt: j.prompt, images: [raw(j.from)], out: tmp, quality });
          // Saved with a clear channel, which OpenAI's edits expect of the pictures it is given.
          await sharp(tmp).ensureAlpha().png().toFile(raw(j.id));
          rmSync(tmp);
          console.log(`painted ${j.id} (spent so far $${spent().toFixed(2)})`);
        }),
      );
    }
    left = left.filter((j) => !existsSync(raw(j.id)));
  }
}

async function cut(jobs) {
  const master = await load(raw("master"));
  for (const j of jobs) {
    if (!existsSync(raw(j.id))) continue;
    if (j.kind === "elf") {
      // An elf is a layer itself, put back where the master is.
      const elf = await load(raw(j.id));
      const { dx, dy } = bestShift(master, elf, LEGS);
      const back = moveBy(elf, -dx, -dy);
      await writeSizes(LAYER_DIR, j.layer, keepMainParts(dropLooseEdges(keyOut(back))));
    } else if (j.kind === "alone") {
      const base = await load(raw(j.base));
      const { layer, cover } = isolate(await load(raw(j.id)), await load(raw(j.from)), base, { still: j.still });
      const clean = keepMainParts(dropLooseEdges(layer));
      // A hat also hides whatever of any elf is above its brim, so no hairstyle pokes out of it. Not
      // a paper crown: it sits on top of the hair, and hair between its points looks right.
      const pulledOn = j.slot === "hat" && !j.layer.startsWith("piece-crown-");
      const hides = pulledOn ? joinCovers(cover && keepMainParts(cover), hatCover(clean)) : cover && keepMainParts(cover);
      await writeSizes(LAYER_DIR, j.layer, clean, hides);
    } else continue;
    console.log(`cut ${j.layer}`);
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
  if (!existsSync(raw("master"))) {
    console.error(`Put the approved master elf at ${raw("master")} first.`);
    process.exit(2);
  }
  mkdirSync(RAW, { recursive: true });
  const only = flag("--only");
  let jobs = allJobs().filter((j) => j.batch === batch);
  if (typeof only === "string") {
    jobs = jobs.filter((j) => j.id === only);
    if (existsSync(raw(only))) rmSync(raw(only));
  }
  if (!flag("--cut-only")) await paintAll(jobs, flag("--quality") === "high" ? "high" : "low");
  await cut(jobs);
  console.log(`done: ${batch}. Spent so far $${spent().toFixed(2)}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
