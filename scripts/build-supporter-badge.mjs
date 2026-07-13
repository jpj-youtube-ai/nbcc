// Build the STATIC supporter badge asset: assets/img/nbcc-supporter-badge.svg.
//
// TASK-211 (business-supporter certificate + badge delivery). The badge is the SAME for every
// supporter, so it ships as one committed static SVG (not a per-business render). This is the
// approved "Option B" emblem (see the scratchpad make-badge.js mockup): a framed cream card with a
// double maroon border, "We proudly support" in Playfair italic maroon, the real NBCC logo mark, and
// "Night Before Christmas Campaign" in Poppins maroon.
//
// It is generated (not hand-written) so the giant blobs never bloat a source file: the two brand
// fonts (assets/fonts/*.woff2) are base64-inlined as @font-face and the NBCC logo mark is nested
// wholesale from assets/img/nbcc-logo-white.svg (its <defs>/<use> vector paths, so it stays razor
// sharp at any size). The result is a fully standalone, valid SVG a business can drop onto any site.
//
// Regenerate with:  node scripts/build-supporter-badge.mjs
//
// NOTE: no dashes appear in any human-readable copy (task constraint). The minus signs inside the
// logo path data are numeric coordinates, not text.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const b64 = (rel) => readFileSync(resolve(ROOT, rel)).toString("base64");
const playfair = b64("assets/fonts/playfair-display-700-latin.woff2");
const poppins = b64("assets/fonts/poppins-400-latin.woff2");

// Brand colours (task): maroon frame + wordmarks, a crimson accent on the divider.
const MAROON = "#7a1420";
const CRIMSON = "#C02238";

// Nest the NBCC logo mark: keep its <defs>/<use> vector structure verbatim, only rewrite the root
// <svg> opening tag so it becomes a positioned, scaled nested viewport inside the badge. It carries
// its own xmlns + xmlns:xlink so the internal `xlink:href` <use> references resolve.
const LOGO_BOX = { x: 84, y: 80, w: 132, h: 128 }; // centred on x=150; ~1.03 aspect matches the logo viewBox
let logo = readFileSync(resolve(ROOT, "assets/img/nbcc-logo-white.svg"), "utf8").trim();
logo = logo.replace(
  /<svg\b[^>]*>/,
  `<svg x="${LOGO_BOX.x}" y="${LOGO_BOX.y}" width="${LOGO_BOX.w}" height="${LOGO_BOX.h}" ` +
    `viewBox="397 42 1071 1038" preserveAspectRatio="xMidYMid meet" ` +
    `xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 300 340" width="300" height="340" role="img" aria-label="We proudly support the Night Before Christmas Campaign">
<title>We proudly support the Night Before Christmas Campaign</title>
<desc>Supporter badge for the Night Before Christmas Campaign, Scottish Charity No. SC047995.</desc>
<style>
@font-face{font-family:"NBCC Playfair";font-style:normal;font-weight:700;src:url(data:font/woff2;base64,${playfair}) format("woff2")}
@font-face{font-family:"NBCC Poppins";font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${poppins}) format("woff2")}
.eyebrow{font-family:"NBCC Playfair","Playfair Display",Georgia,"Times New Roman",serif;font-style:italic;font-weight:700;font-size:25px;fill:${MAROON}}
.campaign{font-family:"NBCC Poppins","Poppins",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-weight:600;font-size:15px;letter-spacing:.3px;fill:${MAROON}}
</style>
<rect x="8" y="8" width="284" height="324" rx="24" ry="24" fill="#fdfbf6" stroke="${MAROON}" stroke-width="4"/>
<rect x="16" y="16" width="268" height="308" rx="17" ry="17" fill="none" stroke="${MAROON}" stroke-opacity="0.32" stroke-width="2"/>
<text class="eyebrow" x="150" y="62" text-anchor="middle">We proudly support</text>
${logo}
<line x1="116" y1="238" x2="184" y2="238" stroke="${MAROON}" stroke-opacity="0.3" stroke-width="1.6"/>
<rect x="146" y="234" width="8" height="8" transform="rotate(45 150 238)" fill="${CRIMSON}"/>
<text class="campaign" x="150" y="276" text-anchor="middle">Night Before Christmas</text>
<text class="campaign" x="150" y="298" text-anchor="middle">Campaign</text>
</svg>
`;

const OUT = resolve(ROOT, "assets/img/nbcc-supporter-badge.svg");
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${svg.length} bytes | fonts ${playfair.length + poppins.length} b64 chars)`);
