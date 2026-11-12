// Build the admin's home-screen icons: assets/admin-icons/*.png.
//
// The admin is pinned to staff phones as its own app ("NBCC Admin"), so it needs an icon that is
// NOT the public site's. Jaimie chose the dark-background logo — the full-colour elf with its white
// outline and NBCC in white — sitting on brand maroon #800000, with the whole logo rather than the
// elf alone: at the ~60px an iPhone actually draws, the wordmark still reads as NBCC and dropping it
// gains only a slightly larger elf.
//
// Three things here are not arbitrary and will break the icon if changed:
//
//   * density 150. The source viewBox is 1500 units, so sharp rasterises it at 150 DPI to
//     ~8300px square. Raising it to 300 overflows sharp's own pixel limit and throws.
//   * No alpha. iOS fills a transparent home-screen icon with BLACK, not with the page colour, so
//     every PNG is flattened onto opaque maroon.
//   * The maskable one is inset further (60% against 80%). Android crops a maskable icon to a
//     circle; at 80% the wordmark loses its outer letters.
//
// Regenerate with:  node scripts/make-admin-icons.mjs

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = resolve(ROOT, "assets/admin-icons");
const MAROON = { r: 0x80, g: 0x00, b: 0x00, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const logo = readFileSync(resolve(DIR, "nbcc-logo-dark-bg.svg"));

/** The logo, centred on opaque maroon, at `size` square with `inset` of it given to the artwork. */
async function tile(size, inset) {
  const art = Math.round(size * inset);
  const drawn = await sharp(logo, { density: 150 })
    .resize(art, art, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
  const offset = Math.round((size - art) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: MAROON } })
    .composite([{ input: drawn, top: offset, left: offset }])
    .flatten({ background: MAROON })
    // flatten() merges the artwork's alpha onto maroon but leaves a (now fully opaque) alpha
    // channel on the output. iOS looks at the channel, not at its values, so it has to go.
    .removeAlpha()
    .png();
}

const ICONS = [
  ["apple-touch-icon.png", 180, 0.8],
  ["icon-192.png", 192, 0.8],
  ["icon-512.png", 512, 0.8],
  ["icon-maskable-512.png", 512, 0.6],
];

for (const [name, size, inset] of ICONS) {
  await (await tile(size, inset)).toFile(resolve(DIR, name));
  console.log(`wrote ${name} (${size}px, logo at ${Math.round(inset * 100)}%)`);
}
