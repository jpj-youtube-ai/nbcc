// NBCC Elf Detective School: the painted dress-up elf (docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md).
//
// Writes assets/js/elf-paint.js, the list of painted layers the site reads: where each sits on the
// 1024 by 1536 canvas, and the part of the elf it hides (its cover). It is read from places.json,
// which cutout.mjs keeps beside the layer files, and lists only layers whose three sizes all exist,
// so a half finished painting can never reach the site. Like the wardrobe, it is one plain script
// for both the browser (window.NBCCElfPaint) and the server (module.exports).
//
// Unit tested in test/unit/elf-paint-manifest.test.ts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const LAYER_DIR = resolve(ROOT, "assets/img/elf");
export const MANIFEST_FILE = resolve(ROOT, "assets/js/elf-paint.js");

/** The canvas, and the part of it every picture shows: 1.3 times as tall as it is wide. */
export const CANVAS = { w: 1024, h: 1536, view: [-79, 0, 1182, 1536] };

const SIZES = ["tile", "sm", "lg"];

function complete(dir, file) {
  return SIZES.every((size) => existsSync(join(dir, size, `${file}.webp`)));
}

export function buildManifest(dir = LAYER_DIR, out = MANIFEST_FILE) {
  const placesFile = join(dir, "places.json");
  const places = existsSync(placesFile) ? JSON.parse(readFileSync(placesFile, "utf8")) : {};
  const layers = {};
  for (const name of Object.keys(places).sort()) {
    const p = places[name];
    if (!complete(dir, name)) continue;
    if (p.cover && !complete(dir, `${name}.cover`)) continue;
    layers[name] = p.cover ? { x: p.x, y: p.y, w: p.w, h: p.h, cover: p.cover } : { x: p.x, y: p.y, w: p.w, h: p.h };
  }
  const manifest = { canvas: CANVAS, layers };
  const body =
    "/* NBCC Elf Detective School: the painted layers of the dress-up elf. Written by\n" +
    " * scripts/elf-paint/manifest.mjs: do not edit by hand. Read by assets/js/elf-wardrobe.js. */\n" +
    "(function () {\n" +
    '  "use strict";\n' +
    `  var PAINT = ${JSON.stringify(manifest)};\n` +
    "  (function freeze(v) { if (v && typeof v === \"object\" && !Object.isFrozen(v)) { Object.freeze(v); for (var k in v) freeze(v[k]); } })(PAINT);\n" +
    '  if (typeof module !== "undefined" && module.exports) module.exports = PAINT;\n' +
    "  else window.NBCCElfPaint = PAINT;\n" +
    "})();\n";
  writeFileSync(out, body);
  return manifest;
}
