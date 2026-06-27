// Team headshot pipeline (TASK-041, REQ-016/REQ-034).
//
// Converts source portraits to the canonical team-headshot spec — 4:5,
// 640x800, quality 82, PROGRESSIVE JPEG, with a slightly top-biased crop (faces
// sit in the upper portion of a portrait) — and writes them to
// assets/img/team-<name>.jpg.
//
// Image directory convention: the repo keeps all images in **assets/img/** (where
// nbcc-logo.png already lives). The spec text says `images/`; we standardise on
// assets/img/ and document it (README "Assets"), since that is what the pages and
// the Dockerfile already serve.
//
// Source photos go in assets/img/source/<name>.{jpg,jpeg,png,webp}. Until real,
// CONSENTED photos exist, none are present, so this generates spec-correct
// PLACEHOLDER JPEGs at the exact dimensions/quality — each flagged for swap-in in
// assets/img/CREDITS.md. Re-run with `npm run images` after dropping real photos
// into assets/img/source/.
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "assets/img");
const SRC_DIR = resolve(ROOT, "assets/img/source");

const WIDTH = 640;
const HEIGHT = 800;
const QUALITY = 82;

// The ten team members in the about.html grid (REQ-016), in order.
const TEAM = ["Tygan", "Jodie", "Isabella", "Jaimie", "Dawn", "Jill", "Jon", "Kenny", "Liz", "Vicky"];

const slug = (name) => name.toLowerCase();
const SRC_EXTS = ["jpg", "jpeg", "png", "webp"];

const jpeg = (pipeline) => pipeline.jpeg({ quality: QUALITY, progressive: true, mozjpeg: true });

// A real source portrait: cover-crop to 4:5 with a top bias so faces are kept.
function fromSource(file) {
  return jpeg(sharp(file).resize(WIDTH, HEIGHT, { fit: "cover", position: "top" }));
}

// An on-brand placeholder so the layout is real at the correct size/weight. It is
// deliberately obviously a placeholder ("Placeholder photo") pending a consented
// photo. Brand tints alternate so the grid does not look like one flat block.
function placeholder(name, index) {
  const tint = index % 2 === 0 ? "#f3e4dd" : "#eaf0e7"; // tan-soft / holly-soft
  const initial = name.slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${tint}"/>
    <circle cx="320" cy="300" r="120" fill="#fffdfa" stroke="#d29c8a" stroke-width="4"/>
    <text x="320" y="300" font-family="Georgia, 'Times New Roman', serif" font-size="150"
          fill="#c02238" text-anchor="middle" dominant-baseline="central">${initial}</text>
    <text x="320" y="520" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700"
          fill="#333333" text-anchor="middle">${name}</text>
    <text x="320" y="575" font-family="Helvetica, Arial, sans-serif" font-size="24"
          fill="#6f6a66" text-anchor="middle">Placeholder photo</text>
  </svg>`;
  return jpeg(sharp(Buffer.from(svg)).resize(WIDTH, HEIGHT).flatten({ background: tint }));
}

mkdirSync(OUT_DIR, { recursive: true });

let placeholders = 0;
for (let i = 0; i < TEAM.length; i += 1) {
  const name = TEAM[i];
  const out = resolve(OUT_DIR, `team-${slug(name)}.jpg`);
  const src = SRC_EXTS.map((ext) => resolve(SRC_DIR, `${slug(name)}.${ext}`)).find(existsSync);

  const pipeline = src ? fromSource(src) : placeholder(name, i);
  // eslint-disable-next-line no-await-in-loop
  const info = await pipeline.toFile(out);

  if (src) {
    console.log(`processed ${name}: ${out} (${info.width}x${info.height}, ${info.size} bytes)`);
  } else {
    placeholders += 1;
    console.log(`PLACEHOLDER ${name}: ${out} (CONTENT VERIFICATION — swap in a consented photo)`);
  }
}

console.log(
  `\nDone: ${TEAM.length} headshots at ${WIDTH}x${HEIGHT} q${QUALITY} progressive JPEG` +
    (placeholders ? ` (${placeholders} placeholders — see assets/img/CREDITS.md).` : "."),
);
