// Bakes the hero: crops Chrome's 3x screenshot of hero.html to the drawing, and writes the WebP the
// page uses. Also bakes a small NBCC logo WebP from assets/img/nbcc-logo-full.svg.
// Run from the repo root: node tools/ball-bags/bake.cjs
// Everything is written to tools/ball-bags/out/ (git ignored), never over assets/img: look at
// the result, then copy ball-bag-hero.webp and nbcc-logo-192.webp into assets/img by hand.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require(path.resolve("node_modules/sharp"));

const here = path.resolve("tools/ball-bags");
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const shot = path.join(out, "shot.png");

(async () => {
  // The drawing is 400 x 440 at the page's top left; Chrome rendered it at 3x.
  const full = path.join(out, "hero-3x.png");
  await sharp(shot).extract({ left: 0, top: 0, width: 1200, height: 1320 }).png().toFile(full);
  // The page shows it at up to 280 CSS px wide: 2x that, plenty for a phone.
  const hero = path.join(out, "ball-bag-hero.webp");
  await sharp(full).resize({ width: 560 }).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(hero);
  const preview = path.join(out, "hero-check.png");
  await sharp(hero).flatten({ background: "#F8F5EE" }).png().toFile(preview);
  const logo = path.join(out, "nbcc-logo-192.webp");
  await sharp(path.resolve("assets/img/nbcc-logo-full.svg"), { density: 300 })
    .resize({ height: 192 })
    .webp({ quality: 88, alphaQuality: 95, effort: 6 })
    .toFile(logo);
  for (const f of [hero, logo]) {
    const m = await sharp(f).metadata();
    console.log(path.basename(f), m.width + "x" + m.height, (fs.statSync(f).size / 1024).toFixed(1) + "KB");
  }
})();
