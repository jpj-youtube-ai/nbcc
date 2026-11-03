// NBCC Elf Detective School: the sheets Jaimie checks, one batch at a time, before its layers are
// kept. Every piece is shown worn by three different elves, always including dark skin and curly
// hair, the hardest fits (design: docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md).
//
//   npm run elf:sheet -- <batch>     writes .elf-paint/sheets/<batch>*.png
//
// It stacks the small layer files exactly as the site does: the elf, with what the piece hides
// taken away, then the piece. (src/elf/elf-png.ts does the same on the server, from the large
// files. The two are kept small and alike rather than shared, because one is a plain tool and the
// other is the site's own code.)
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { BATCHES, allJobs } from "./jobs.mjs";
import { CANVAS, LAYER_DIR } from "./manifest.mjs";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, ".elf-paint/sheets");
const require = createRequire(import.meta.url);
const W = require(resolve(ROOT, "assets/js/elf-wardrobe.js"));

const SCALE = 0.5;
const VIEW_W = Math.round(CANVAS.view[2] * SCALE);
const VIEW_H = Math.round(CANVAS.view[3] * SCALE);
const CELL_W = 300;
const CELL_H = Math.round(CELL_W * 1.3);
const LABEL = 34;
const CREAM = "#F8F5EE";
const SHOWN_ON = ["elf-s1-bunches-ginger", "elf-s5-curly-black", "elf-s3-short-blonde"];

const places = () => JSON.parse(require("node:fs").readFileSync(join(LAYER_DIR, "places.json"), "utf8"));

function placed(file, box) {
  return { input: file, left: Math.round((box.x - CANVAS.view[0]) * SCALE), top: Math.round(box.y * SCALE) };
}

/** One elf wearing `pieces` (layer names), as a PNG of one cell. */
async function cell(elf, pieces, label) {
  const p = places();
  const have = (name) => p[name] && existsSync(join(LAYER_DIR, "sm", `${name}.webp`));
  const parts = [];
  if (have(elf)) parts.push(placed(join(LAYER_DIR, "sm", `${elf}.webp`), p[elf]));
  for (const piece of pieces) if (p[piece] && p[piece].cover) parts.push({ ...placed(join(LAYER_DIR, "sm", `${piece}.cover.webp`), p[piece].cover), blend: "dest-out" });
  let picture = await sharp({ create: { width: VIEW_W, height: VIEW_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts).png().toBuffer();
  const on = pieces.filter(have).map((piece) => placed(join(LAYER_DIR, "sm", `${piece}.webp`), p[piece]));
  picture = await sharp(picture).composite(on).flatten({ background: CREAM }).resize(CELL_W, CELL_H).png().toBuffer();
  const words = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL_W}" height="${LABEL}"><rect width="100%" height="100%" fill="#FFFFFF"/><text x="8" y="23" font-family="Verdana, Arial, sans-serif" font-size="15" fill="#3A2416">${label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
  return sharp({ create: { width: CELL_W, height: CELL_H + LABEL, channels: 3, background: "#FFFFFF" } })
    .composite([{ input: picture, top: 0, left: 0 }, { input: Buffer.from(words), top: CELL_H, left: 0 }])
    .png()
    .toBuffer();
}

async function grid(cells, columns, file) {
  const rows = Math.ceil(cells.length / columns);
  const gap = 12;
  await sharp({ create: { width: columns * (CELL_W + gap) + gap, height: rows * (CELL_H + LABEL + gap) + gap, channels: 3, background: "#DDD6C8" } })
    .composite(cells.map((input, i) => ({ input, left: gap + (i % columns) * (CELL_W + gap), top: gap + Math.floor(i / columns) * (CELL_H + LABEL + gap) })))
    .png()
    .toFile(file);
  console.log(`sheet ${file}`);
}

async function main() {
  const batch = process.argv[2];
  if (!BATCHES.includes(batch)) {
    console.error(`Say which batch: ${BATCHES.join(", ")}`);
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  if (batch === "elves") {
    for (const skin of W.SKIN_TONES) {
      const cells = [];
      for (const style of W.HAIR_STYLES) for (const hair of W.HAIR_COLOURS) cells.push(await cell(`elf-${skin.id}-${style.id}-${hair.id}`, [], `${skin.id}, ${style.name}, ${hair.name}`));
      await grid(cells, W.HAIR_COLOURS.length, join(OUT, `elves-${skin.id}.png`));
    }
    return;
  }
  const layers = allJobs().filter((j) => j.batch === batch && j.kind === "alone").map((j) => j.layer);
  const cells = [];
  for (const layer of layers) for (const elf of SHOWN_ON) cells.push(await cell(elf, [layer], `${layer.replace(/^(piece|outfit)-/, "")} on ${elf.slice(4)}`));
  // Long batches are split so each sheet stays readable on a phone: four pieces to a sheet.
  for (let i = 0, n = 1; i < cells.length; i += 12, n++) await grid(cells.slice(i, i + 12), SHOWN_ON.length, join(OUT, `${batch}-${n}.png`));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
