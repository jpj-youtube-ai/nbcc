#!/usr/bin/env node
// Makes the site's icons (TASK-575) from assets/img/nbcc-logo.png, into assets/icons/:
//
//   favicon.ico            the browser tab: the elf alone at 16, 32 and 48px (the word NBCC under
//                          it cannot be read that small), on a see-through background
//   apple-touch-icon.png   an iPhone's home screen, 180px
//   icon-192.png           an Android home screen, 192px and 512px
//   icon-512.png
//   icon-maskable-512.png  the same with more room round it, for Android's round and squircle masks
//
// The home screen ones are the whole logo on solid white: an iPhone fills see-through corners
// with black. Run it again only if the logo changes:  node scripts/make-site-icons.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGO = join(ROOT, "assets/img/nbcc-logo.png");
const OUT = join(ROOT, "assets/icons");
// The elf sits above the line at y=372 of the 560px logo; the lettering is below it.
const ELF_BOTTOM = 372;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

async function trimmed(input) {
  return sharp(input).trim({ threshold: 0 }).png().toBuffer();
}

// The picture fitted inside a square, `pad` of the side left clear on every edge.
async function square(picture, size, pad, background) {
  const inner = Math.round(size * (1 - 2 * pad));
  const fitted = await sharp(picture)
    .resize(inner, inner, { fit: "contain", background: CLEAR, kernel: "lanczos3" })
    .png()
    .toBuffer();
  const out = sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: fitted, gravity: "centre" }]);
  // Solid icons are flattened so no pixel is left even slightly see-through.
  return (background.alpha === 1 ? out.flatten({ background: WHITE }) : out).png({ compressionLevel: 9 }).toBuffer();
}

// An ICO file: a 6 byte header, a 16 byte entry per image, then the PNGs themselves.
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const logo = await trimmed(LOGO);
const { width } = await sharp(LOGO).metadata();
const elf = await trimmed(await sharp(LOGO).extract({ left: 0, top: 0, width, height: ELF_BOTTOM }).png().toBuffer());

mkdirSync(OUT, { recursive: true });
const tab = [];
for (const size of [16, 32, 48]) tab.push({ size, data: await square(elf, size, 0, CLEAR) });
writeFileSync(join(OUT, "favicon.ico"), ico(tab));
writeFileSync(join(OUT, "apple-touch-icon.png"), await square(logo, 180, 0.08, WHITE));
writeFileSync(join(OUT, "icon-192.png"), await square(logo, 192, 0.08, WHITE));
writeFileSync(join(OUT, "icon-512.png"), await square(logo, 512, 0.08, WHITE));
// Android may cut the icon to a circle 80% across: the logo must fit inside it, corners and all.
writeFileSync(join(OUT, "icon-maskable-512.png"), await square(logo, 512, 0.2, WHITE));
console.log("icons written to assets/icons/");
