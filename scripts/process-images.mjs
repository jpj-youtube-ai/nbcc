// Image pipeline (TASK-041/TASK-042, REQ-012/015/016/034).
//
// Converts source photos to the canonical specs and writes them to assets/img/:
//   - Team headshots: 4:5, 640x800, q82, PROGRESSIVE JPEG, top-biased crop ->
//     team-<name>.jpg (REQ-016).
//   - Captioned scene photos (different aspect ratios) -> story-tygan.jpg (REQ-015
//     founding headshot) and why-packing.jpg (REQ-012 packing/delivery).
//   - Social share card: 1200x630 PNG -> og-image.png (REQ-034, the SEO og:image).
//
// Image directory convention: the repo keeps all images in **assets/img/** (where
// nbcc-logo.png lives). The spec text says `images/`; we standardise on assets/img/
// and document it (README "Assets"), since that is what the pages and the Dockerfile
// serve.
//
// Source photos go in assets/img/source/<name>.{jpg,jpeg,png,webp}. Until real,
// CONSENTED photos exist, none are present, so this generates spec-correct
// PLACEHOLDERS at the exact dimensions/format — each flagged for swap-in in
// assets/img/CREDITS.md. Re-run with `npm run images` after dropping real photos
// into assets/img/source/.
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "assets/img");
const SRC_DIR = resolve(ROOT, "assets/img/source");

const QUALITY = 82;
const SRC_EXTS = ["jpg", "jpeg", "png", "webp"];

// The ten team members in the about.html grid (REQ-016), in order. 4:5, 640x800.
const TEAM = ["Tygan", "Jodie", "Isabella", "Jaimie", "Dawn", "Jill", "Jon", "Kenny", "Liz", "Vicky"];

// Captioned scene photos (REQ-015 founding headshot, REQ-012 packing/delivery).
const SCENES = [
  { name: "story-tygan", w: 640, h: 800, position: "top", label: "Tygan, 2015", sub: "Founding moment" },
  { name: "why-packing", w: 900, h: 600, position: "centre", label: "Volunteers packing Red Bags", sub: "Elves Workshop" },
];

const OG = { name: "og-image", w: 1200, h: 630 };

const slug = (name) => name.toLowerCase();
const sourceFor = (name) =>
  SRC_EXTS.map((ext) => resolve(SRC_DIR, `${name}.${ext}`)).find(existsSync);

const jpeg = (pipeline) => pipeline.jpeg({ quality: QUALITY, progressive: true, mozjpeg: true });

// A real source photo: cover-crop to the target ratio (position keeps the subject).
const fromSource = (file, w, h, position) =>
  jpeg(sharp(file).resize(w, h, { fit: "cover", position }));

// On-brand portrait placeholder for a team headshot (initial + name).
function headshotPlaceholder(name, index) {
  const tint = index % 2 === 0 ? "#f3e4dd" : "#eaf0e7"; // tan-soft / holly-soft
  const initial = name.slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800">
    <rect width="640" height="800" fill="${tint}"/>
    <circle cx="320" cy="300" r="120" fill="#fffdfa" stroke="#d29c8a" stroke-width="4"/>
    <text x="320" y="300" font-family="Georgia, 'Times New Roman', serif" font-size="150"
          fill="#c02238" text-anchor="middle" dominant-baseline="central">${initial}</text>
    <text x="320" y="520" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700"
          fill="#333333" text-anchor="middle">${name}</text>
    <text x="320" y="575" font-family="Helvetica, Arial, sans-serif" font-size="24"
          fill="#6f6a66" text-anchor="middle">Placeholder photo</text>
  </svg>`;
  return jpeg(sharp(Buffer.from(svg)).resize(640, 800).flatten({ background: tint }));
}

// On-brand scene placeholder (camera mark + caption), any aspect ratio.
function scenePlaceholder({ w, h, label, sub }, index) {
  const tint = index % 2 === 0 ? "#eaf0e7" : "#f3e4dd";
  const cx = w / 2;
  const cy = h / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="${tint}"/>
    <g transform="translate(${cx - 44}, ${cy - 110})" fill="none" stroke="#c02238" stroke-width="5" stroke-linejoin="round">
      <rect x="0" y="16" width="88" height="60" rx="8"/>
      <circle cx="44" cy="46" r="19"/>
      <rect x="30" y="4" width="28" height="14" rx="3"/>
    </g>
    <text x="${cx}" y="${cy + 30}" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700"
          fill="#333333" text-anchor="middle">${label}</text>
    <text x="${cx}" y="${cy + 72}" font-family="Helvetica, Arial, sans-serif" font-size="22"
          fill="#6f6a66" text-anchor="middle">${sub} (placeholder photo)</text>
  </svg>`;
  return jpeg(sharp(Buffer.from(svg)).resize(w, h).flatten({ background: tint }));
}

// Branded social share card placeholder (1200x630 PNG).
function ogPlaceholder({ w, h }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#800000"/>
    <rect width="${w}" height="14" fill="#c02238"/>
    <rect y="${h - 14}" width="${w}" height="14" fill="#1a531a"/>
    <text x="${w / 2}" y="250" font-family="Georgia, 'Times New Roman', serif" font-size="160" font-weight="700"
          fill="#f8f5ee" text-anchor="middle">NBCC</text>
    <text x="${w / 2}" y="345" font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="700"
          fill="#f8f5ee" text-anchor="middle">Night Before Christmas Campaign</text>
    <text x="${w / 2}" y="415" font-family="Helvetica, Arial, sans-serif" font-size="32"
          fill="#f3e4dd" text-anchor="middle">Comfort, dignity and joy at Christmas</text>
    <text x="${w / 2}" y="560" font-family="Helvetica, Arial, sans-serif" font-size="24"
          fill="#d29c8a" text-anchor="middle">Registered Scottish charity SC047995</text>
  </svg>`;
  return sharp(Buffer.from(svg)).resize(w, h).png();
}

mkdirSync(OUT_DIR, { recursive: true });
let placeholders = 0;

// --- Team headshots (REQ-016) ---
for (let i = 0; i < TEAM.length; i += 1) {
  const name = TEAM[i];
  const out = resolve(OUT_DIR, `team-${slug(name)}.jpg`);
  const src = sourceFor(`team-${slug(name)}`) || sourceFor(slug(name));
  const pipeline = src ? fromSource(src, 640, 800, "top") : headshotPlaceholder(name, i);
  // eslint-disable-next-line no-await-in-loop
  await pipeline.toFile(out);
  if (src) {
    console.log(`processed ${name}: ${out}`);
  } else {
    placeholders += 1;
    console.log(`PLACEHOLDER ${name}: ${out} (CONTENT VERIFICATION — swap in a consented photo)`);
  }
}

// --- Captioned scene photos (REQ-015 / REQ-012) ---
for (let i = 0; i < SCENES.length; i += 1) {
  const scene = SCENES[i];
  const out = resolve(OUT_DIR, `${scene.name}.jpg`);
  const src = sourceFor(scene.name);
  const pipeline = src
    ? fromSource(src, scene.w, scene.h, scene.position)
    : scenePlaceholder(scene, i);
  // eslint-disable-next-line no-await-in-loop
  const info = await pipeline.toFile(out);
  if (src) {
    console.log(`processed ${scene.name}: ${out} (${info.width}x${info.height})`);
  } else {
    placeholders += 1;
    console.log(`PLACEHOLDER ${scene.name}: ${out} (CONTENT VERIFICATION — swap in a consented photo)`);
  }
}

// --- Social share card (REQ-034) ---
{
  const out = resolve(OUT_DIR, `${OG.name}.png`);
  const src = sourceFor(OG.name);
  const pipeline = src
    ? sharp(src).resize(OG.w, OG.h, { fit: "cover", position: "centre" }).png()
    : ogPlaceholder(OG);
  await pipeline.toFile(out);
  if (src) {
    console.log(`processed og-image: ${out}`);
  } else {
    placeholders += 1;
    console.log(`PLACEHOLDER og-image: ${out} (CONTENT VERIFICATION — swap in a designed share card)`);
  }
}

console.log(
  `\nDone: ${TEAM.length} headshots + ${SCENES.length} scenes + share card` +
    (placeholders ? ` (${placeholders} placeholders — see assets/img/CREDITS.md).` : "."),
);
