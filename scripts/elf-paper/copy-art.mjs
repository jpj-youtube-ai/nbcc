// Copies the approved paper pictures for Elf Detective School into the site (assets/img/elf/paper/),
// from the git ignored preview folder where they were cut out and checked (Jaimie approved them on
// 4 November 2026). A local tool, like scripts/elf-paint/: it reads files that are not in the repo,
// so it never runs in CI. Run from the repo root:  node scripts/elf-paper/copy-art.mjs
//
// Pictures already at their size are copied byte for byte, so the site shows exactly what was approved.
// The rest are resized: scenes to the 640 by 960 stage, tiles small enough that one skin's 51 costume
// tiles stay under 600 KB, friends to fit 240 by 240. Each pair of glasses is also fitted to every
// costume (glasses-fit.json says why), so it sits on that costume's eyes.
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FROM = join(ROOT, ".superpowers/sdd/2026-11-03-elf-detective-wave1-sign-up/preview/paper");
const TO = join(ROOT, "assets/img/elf/paper");
const COSTUMES = JSON.parse(readFileSync(join(ROOT, ".elf-paint/deco/paper-costumes.json"), "utf8")).costumes.map((c) => c.id);
const FIT = JSON.parse(readFileSync(join(ROOT, "scripts/elf-paper/glasses-fit.json"), "utf8"));

const SIBLINGS = ["sister", "brother"];
const SKINS = ["s1", "s2", "s3", "s4", "s5"];
const STYLES = ["short", "bunches", "curly"];
const HAIRS = ["dark", "brown", "ginger", "blonde", "black"];
const SCENES = ["workshop", "forest", "loch", "fireside", "rooftops", "ayr", "prestwick", "girvan", "largs", "cumnock", "culzean", "alloway", "troon", "millport", "kilmarnock"];
const FRIENDS = ["robin", "reindeercalf", "penguinchick", "scottiepuppy", "highlandcalf", "snowman"];
const GLASSES = ["specs-black", "specs-gold", "specs-red", "stars-gold", "stars-red", "stars-blue"];
const BOWS = ["bow-red", "bow-green", "bow-gold"];
const DECO = ["present-crimson", "present-holly", "present-cream", "candy-cane", "holly", "bauble", "bow-gold"];
const ICONS = ["costume", "scene", "friend", "frame", "glasses", "paint", "lock", "surprise", "camera", "bell"];
const W = 640, H = 960;

let made = 0, bytes = 0;
function out(name) {
  const path = join(TO, name);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}
function counted(path) {
  made += 1;
  bytes += statSync(path).size;
}
function copy(from, name) {
  const path = out(name);
  copyFileSync(join(FROM, from), path);
  counted(path);
}
async function write(pipeline, name) {
  const path = out(name);
  await pipeline.toFile(path);
  counted(path);
}

// A glasses layer moved and sized to a costume's eyes: scaled about the plain elf's eye midpoint, then
// moved by the costume's offset, on the same 640 by 960 canvas.
const MID = [(FIT.eyes[0][0] + FIT.eyes[1][0]) / 2, (FIT.eyes[0][1] + FIT.eyes[1][1]) / 2];
async function fittedGlasses(layer, { x, y, scale }) {
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const sized = await sharp(layer).resize(w, h).png().toBuffer();
  const left = Math.round(MID[0] + x - MID[0] * scale), top = Math.round(MID[1] + y - MID[1] * scale);
  // Only the part of the sized layer that lands on the canvas.
  const fromX = Math.max(0, -left), fromY = Math.max(0, -top);
  const width = Math.min(w - fromX, W - Math.max(0, left)), height = Math.min(h - fromY, H - Math.max(0, top));
  const part = await sharp(sized).extract({ left: fromX, top: fromY, width, height }).png().toBuffer();
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: part, left: Math.max(0, left), top: Math.max(0, top) }])
    .webp({ quality: 82, alphaQuality: 90 });
}

for (const sib of SIBLINGS) for (const skin of SKINS) for (const style of STYLES) for (const hair of HAIRS) {
  const name = `elf-${sib}-${skin}-${style}-${hair}.webp`;
  copy(`elves/${name}`, `elves/${name}`);
}
for (const id of COSTUMES) for (const skin of SKINS) {
  copy(`costumes/${id}-${skin}.webp`, `costumes/${id}-${skin}.webp`);
  await write(sharp(join(FROM, `costumes/tile-${id}-${skin}.webp`)).resize({ height: 300 }).webp({ quality: 70, alphaQuality: 80 }), `tiles/costumes/${id}-${skin}.webp`);
}
for (const [id, from] of [["village", "stage.webp"], ...SCENES.map((s) => [s, `scene-${s}.webp`])]) {
  await write(sharp(join(FROM, from)).resize(W, H).webp({ quality: 80 }), `scenes/${id}.webp`);
  await write(sharp(join(FROM, from)).resize(160, 240).webp({ quality: 75 }), `tiles/scenes/${id}.webp`);
}
// The advent calendar's board needs no painting of its own: Jaimie (5 November 2026) chose NBCC's
// solid rich maroon in place of the rooftops across its doors.
for (const id of [...GLASSES, ...BOWS]) copy(`pieces/${id}.webp`, `pieces/${id}.webp`);
for (const g of GLASSES) {
  const layer = readFileSync(join(FROM, `pieces/${g}.webp`));
  for (const c of COSTUMES) await write(await fittedGlasses(layer, FIT.fit[c]), `pieces/${g}--${c}.webp`);
}
for (const id of FRIENDS) await write(sharp(join(FROM, `friend-${id}.webp`)).resize({ width: 240, height: 240, fit: "inside" }).webp({ quality: 82, alphaQuality: 90 }), `friends/${id}.webp`);
for (const name of DECO) copy(`${name}.webp`, `deco/${name}.webp`);
for (const name of ICONS) copy(`icon-${name}.webp`, `icons/icon-${name}.webp`);
for (const name of ["grain", "grain-light"]) copy(`${name}.webp`, `ui/${name}.webp`);

console.log(`made ${made} pictures, ${(bytes / 1024 / 1024).toFixed(1)} MB, in assets/img/elf/paper`);
