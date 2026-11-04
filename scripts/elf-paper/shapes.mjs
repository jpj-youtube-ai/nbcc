// Draws the torn paper shapes of the approved paper look (mockup 6, Jaimie, 4 November 2026) as small
// SVG files: the torn edge strips the stylesheet tiles round cards, tiles and notes, and the torn
// buttons, chips, labels, notes, tag and tape. The drawing code is mockup 6's own, with its seeded
// random numbers, drawn in its order, so every tear is the one Jaimie approved and the same on every
// visit. The mockup inlined them as data addresses; the site serves them as files.
// Run from the repo root:  node scripts/elf-paper/shapes.mjs [folder]   (default assets/img/elf/paper/ui)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(process.argv[2] || join(ROOT, "assets/img/elf/paper/ui"));
const HEX = { crimson: "#C02238", maroon: "#800000", holly: "#1A531A", hollyDark: "#0F3A0F", gold: "#D9A93E", tan: "#D29C8A", card: "#FFFDFA", tanSoft: "#F3E4DD", white: "#FFFFFF" };

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const f1 = (n) => Number(n.toFixed(1));
const SVG = 'xmlns="http://www.w3.org/2000/svg"';

// How far a torn edge strays from a straight line along its length: a slow wave, a wandering middle,
// fine fibres, and now and then a deeper nick. Periodic ones end where they start, so tiles join.
function tornOffsets(len, amp, step, periodic) {
  const n = Math.max(4, Math.round(len / step));
  const k1 = 1 + Math.floor(rnd() * 2), k2 = 3 + Math.floor(rnd() * 4), p1 = rnd() * 6.283, p2 = rnd() * 6.283;
  const out = [];
  let walk = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    walk = walk * 0.7 + (rnd() - 0.5) * 0.9;
    let v = Math.sin(t * 6.283 * k1 + p1) * 0.3 + Math.sin(t * 6.283 * k2 + p2) * 0.18 + walk * 0.45 + (rnd() - 0.5) * 0.38;
    if (rnd() < 0.05) v += rnd() < 0.5 ? -0.6 : 0.6;
    out.push(Math.max(-1, Math.min(1, v)) * amp);
  }
  if (periodic) {
    const m = Math.round(n * 0.15);
    for (let j = 0; j <= m; j++) { const i = n - m + j, w = j / m; out[i] = out[i] * (1 - w) + out[0] * w; }
  }
  return out;
}
// One side of a torn mask, as a tile: opaque on the inside of the torn line.
function edgeTile(len, band, amp, side) {
  const o = tornOffsets(len, amp, 3, true), n = o.length - 1, mid = band / 2;
  const at = (i) => f1((i / n) * len);
  let d;
  if (side === "top") d = `M0 ${band}` + o.map((v, i) => `L${at(i)} ${f1(mid + v)}`).join("") + `L${len} ${band}Z`;
  else if (side === "bottom") d = "M0 0" + o.map((v, i) => `L${at(i)} ${f1(mid + v)}`).join("") + `L${len} 0Z`;
  else if (side === "left") d = `M${band} 0` + o.map((v, i) => `L${f1(mid + v)} ${at(i)}`).join("") + `L${band} ${len}Z`;
  else d = "M0 0" + o.map((v, i) => `L${f1(mid + v)} ${at(i)}`).join("") + `L0 ${len}Z`;
  const across = side === "top" || side === "bottom";
  const w = across ? len : band, h = across ? band : len;
  return `<svg ${SVG} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}
// A torn outline through the given corners (clockwise): each side torn, tapering into the corners.
function tornPoly(corners, amp, step = 3.2) {
  const pts = [];
  for (let k = 0; k < corners.length; k++) {
    const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % corners.length];
    const len = Math.hypot(bx - ax, by - ay) || 1, nx = (by - ay) / len, ny = -(bx - ax) / len;
    const off = tornOffsets(len, amp, step, false);
    for (let i = 0; i < off.length - 1; i++) {
      const t = i / (off.length - 1), taper = Math.min(1, t * 6, (1 - t) * 6);
      pts.push([ax + (bx - ax) * t + nx * off[i] * taper, ay + (by - ay) * t + ny * off[i] * taper]);
    }
  }
  return "M" + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join("L") + "Z";
}
// A box with its corners snipped off, a little out of true.
function snipped(W, H, inset, c, jitter) {
  const j = () => (rnd() - 0.5) * jitter;
  const x0 = inset + j(), x1 = W - inset + j(), y0 = inset + j(), y1 = H - inset + j();
  return [[x0 + c, y0], [x1 - c, y0 + j() * 0.3], [x1, y0 + c], [x1 + j() * 0.3, y1 - c], [x1 - c, y1], [x0 + c, y1 + j() * 0.3], [x0, y1 - c], [x0 + j() * 0.3, y0 + c]];
}
// A piece of torn coloured paper as one picture: a soft fringe and the white core of the tear round
// the colour, with a faint tooth on strong colours only. Laid on stretched.
function paperShape(W, H, { fill, rim = HEX.card, amp = 2.4, inset = 5, snip = 4, line = "", stripes = false, tooth = ![HEX.card, HEX.tanSoft, HEX.gold, HEX.tan].includes(fill) }) {
  const defs = [];
  let paint = fill;
  if (stripes) {
    defs.push(`<pattern id="s" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="18" fill="${HEX.crimson}"/><rect x="9" width="9" height="18" fill="${HEX.card}"/></pattern>`);
    paint = "url(#s)";
  }
  if (tooth) defs.push(`<filter id="t" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${Math.floor(rnd() * 90)}"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.2 0 0 0 -0.065"/><feComposite in2="SourceGraphic" operator="in"/></filter>`);
  const face = tornPoly(snipped(W, H, inset, snip, amp * 0.6), amp * 0.9);
  let body = "";
  if (rim) body += `<path fill="${rim}" fill-opacity="0.5" d="${tornPoly(snipped(W, H, inset * 0.3, snip, amp * 0.6), amp * 1.1)}"/><path fill="${rim}" d="${tornPoly(snipped(W, H, inset * 0.6, snip, amp * 0.6), amp)}"/>`;
  body += `<path fill="${paint}" d="${face}"${line ? ` stroke="${line}" stroke-opacity="0.6" stroke-width="1" vector-effect="non-scaling-stroke"` : ""}/>`;
  if (tooth) body += `<path fill="#000" filter="url(#t)" d="${face}"/>`;
  return `<svg ${SVG} viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${defs.length ? "<defs>" + defs.join("") + "</defs>" : ""}${body}</svg>`;
}
// A circle cut by hand.
function blob(cx, cy, r, amp, n = 72) {
  const p1 = rnd() * 6.283, p2 = rnd() * 6.283;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283, rr = r + Math.sin(a * 3 + p1) * amp * 0.4 + Math.sin(a * 7 + p2) * amp * 0.25 + (rnd() - 0.5) * amp * 0.6;
    d += (i ? "L" : "M") + f1(cx + rr * Math.cos(a)) + " " + f1(cy + rr * Math.sin(a));
  }
  return d + "Z";
}

const files = {};
const masks = {};
const SIDES = ["top", "bottom", "left", "right"];
// A mask that tears all four edges of a box of any size: a torn strip repeated along each side (the
// stylesheet fills the middle). Each side's strip is a different length, so no two sides line up.
function tearMask(name, band, amp, lengths) {
  SIDES.forEach((side, i) => { files[`${name}-${side}.svg`] = edgeTile(lengths[i], band, amp, side); });
  masks[name] = { band, lengths, sides: SIDES };
}
// Only the top edge torn, as a sheet torn off a pad.
function tearTopOnly(name, band, amp, len) {
  files[`${name}.svg`] = edgeTile(len, band, amp, "top");
  masks[name] = { band, lengths: [len], sides: ["top"] };
}
const shape = (name, W, H, opts) => { files[`${name}.svg`] = paperShape(W, H, opts); };

// In mockup 6's order, so the seeded numbers fall the same way.
tearMask("tear-card-a", 12, 4.2, [263, 241, 227, 251]);
tearMask("tear-card-b", 12, 4.6, [251, 233, 239, 229]);
tearMask("tear-card-c", 11, 3.8, [241, 257, 233, 247]);
tearMask("tear-tile-a", 8, 2.8, [173, 191, 157, 181]);
tearMask("tear-tile-b", 8, 3, [181, 167, 163, 177]);
tearMask("tear-fine-a", 6, 2, [131, 149, 127, 139]);
tearMask("tear-fine-b", 6, 2.2, [139, 127, 143, 133]);
tearTopOnly("tear-top", 14, 5, 233);
files["blob-a.svg"] = `<svg ${SVG} viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${blob(50, 50, 46, 3)}"/></svg>`;
for (const [size, W, H] of [["s", 150, 52], ["m", 230, 56], ["l", 420, 60]]) {
  shape(`btn-${size}-crimson`, W, H, { fill: HEX.crimson });
  shape(`btn-${size}-holly`, W, H, { fill: HEX.holly });
  shape(`btn-${size}-cream`, W, H, { fill: HEX.card, rim: HEX.white, line: HEX.tan });
  shape(`btn-${size}-maroon`, W, H, { fill: HEX.maroon, rim: "", tooth: false });
  shape(`btn-${size}-hollydark`, W, H, { fill: HEX.hollyDark, rim: "", tooth: false });
  shape(`btn-${size}-tan`, W, H, { fill: HEX.tan, rim: "", tooth: false });
}
shape("btn-m-cane", 236, 64, { stripes: true, amp: 2.8, inset: 4 });
for (const [name, fill] of [["holly", HEX.holly], ["tan", HEX.tan], ["gold", HEX.gold], ["crimson", HEX.crimson]]) shape(`chip-${name}`, 110, 34, { fill, amp: 1.8, inset: 4, snip: 3 });
shape("chip-cream", 110, 34, { fill: HEX.card, rim: HEX.white, line: HEX.tan, amp: 1.8, inset: 4, snip: 3 });
shape("label-holly", 260, 42, { fill: HEX.holly, amp: 2.4, inset: 4 });
shape("note-cream", 360, 90, { fill: HEX.card, rim: HEX.white, line: HEX.tan, amp: 3, inset: 6 });
shape("note-kraft", 520, 90, { fill: HEX.tanSoft, rim: HEX.card, amp: 3, inset: 6 });
shape("note-holly", 200, 52, { fill: HEX.holly, amp: 2.4, inset: 4 });
shape("tag-cream", 150, 44, { fill: HEX.card, rim: HEX.white, line: HEX.tan, amp: 1.8, inset: 4, snip: 10 });
files["tape.svg"] = `<svg ${SVG} viewBox="0 0 90 24" preserveAspectRatio="none"><path fill="${HEX.tan}" fill-opacity="0.58" d="${tornPoly([[4, 3], [86, 2], [87, 21], [3, 22]], 1.6, 2)}"/></svg>`;

mkdirSync(OUT, { recursive: true });
for (const [name, svg] of Object.entries(files)) writeFileSync(join(OUT, name), svg);
const about = "The torn paper shapes, drawn by scripts/elf-paper/shapes.mjs. masks: the torn edge strips, each side's strip tiled along that side of a box (width by height: length by band across, band by length down); the stylesheet fills the middle.";
writeFileSync(join(OUT, "shapes.json"), JSON.stringify({ _about: about, masks, files: Object.keys(files) }, null, 1) + "\n");
console.log(`drew ${Object.keys(files).length} shapes in ${OUT}`);
