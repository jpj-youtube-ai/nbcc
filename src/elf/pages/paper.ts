import { escapeHtml } from "../../events/render";

// NBCC Elf Detective School: the paper look's pieces, drawn on the server as small pieces of SVG
// (docs/superpowers/specs/2026-11-04-elf-paper-design.md, "The paper look"). Everything looks cut from
// coloured card: torn edges that show the white core of the tear, layered sheets, soft shadows between
// them, light from the top left. The drawing code is mockup 6's own (approved by Jaimie on 4 November
// 2026: "Yes, this is it"). The torn shapes the stylesheet lays over boxes are files instead
// (scripts/elf-paper/shapes.mjs); these are the pieces that carry words or need the page's colours.
//
// Each piece is drawn from numbers that look random but come from a fixed seed, so it is the same on
// every visit and in every test. Colours come from the stylesheet (assets/css/elf.css) through class
// names, never from text written into the markup. Every drawing is hidden from screen readers; only
// the words of a strip are read.
//
// Pure. Unit tested in test/unit/elf-paper.test.ts.

const PAPER = "/assets/img/elf/paper/";
/** The white core of a tear: card, a shade off white. */
const CARD = "#FFFDFA";

export type PaperColour = "crimson" | "holly" | "gold" | "tan";
const COLOURS: readonly PaperColour[] = ["crimson", "holly", "gold", "tan"];
const colourOf = (c: unknown, fallback: PaperColour): PaperColour => (COLOURS.includes(c as PaperColour) ? (c as PaperColour) : fallback);

type Rnd = () => number;
type Pt = [number, number];

/** Numbers that look random but are the same every time from the same seed. */
function seeded(seed: number): Rnd {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** A seed made from words, so each kind of piece tears in its own way. */
function seedOf(words: string): number {
  let h = 2166136261;
  for (let i = 0; i < words.length; i++) {
    h ^= words.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 2147483646) + 1;
}

const f1 = (n: number): number => Number(n.toFixed(1));

// ---- torn paper, as mockup 6 draws it ----

// How far a torn edge strays from a straight line along its length: a slow wave, a wandering middle,
// fine fibres, and now and then a deeper nick.
function tornOffsets(rnd: Rnd, len: number, amp: number, step: number): number[] {
  const n = Math.max(4, Math.round(len / step));
  const k1 = 1 + Math.floor(rnd() * 2), k2 = 3 + Math.floor(rnd() * 4), p1 = rnd() * 6.283, p2 = rnd() * 6.283;
  const out: number[] = [];
  let walk = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    walk = walk * 0.7 + (rnd() - 0.5) * 0.9;
    let v = Math.sin(t * 6.283 * k1 + p1) * 0.3 + Math.sin(t * 6.283 * k2 + p2) * 0.18 + walk * 0.45 + (rnd() - 0.5) * 0.38;
    if (rnd() < 0.05) v += rnd() < 0.5 ? -0.6 : 0.6;
    out.push(Math.max(-1, Math.min(1, v)) * amp);
  }
  return out;
}

// A torn outline through the given corners (clockwise): each side torn, tapering into the corners.
function tornPoly(rnd: Rnd, corners: Pt[], amp: number, step = 3.2): string {
  const pts: Pt[] = [];
  for (let k = 0; k < corners.length; k++) {
    const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % corners.length];
    const len = Math.hypot(bx - ax, by - ay) || 1, nx = (by - ay) / len, ny = -(bx - ax) / len;
    const off = tornOffsets(rnd, len, amp, step);
    for (let i = 0; i < off.length - 1; i++) {
      const t = i / (off.length - 1), taper = Math.min(1, t * 6, (1 - t) * 6);
      pts.push([ax + (bx - ax) * t + nx * off[i] * taper, ay + (by - ay) * t + ny * off[i] * taper]);
    }
  }
  return "M" + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join("L") + "Z";
}

// A box with its corners snipped off, a little out of true.
function snipped(rnd: Rnd, W: number, H: number, inset: number, c: number, jitter: number): Pt[] {
  const j = (): number => (rnd() - 0.5) * jitter;
  const x0 = inset + j(), x1 = W - inset + j(), y0 = inset + j(), y1 = H - inset + j();
  return [[x0 + c, y0], [x1 - c, y0 + j() * 0.3], [x1, y0 + c], [x1 + j() * 0.3, y1 - c], [x1 - c, y1], [x0 + c, y1 + j() * 0.3], [x0, y1 - c], [x0 + j() * 0.3, y0 + c]];
}

// A circle cut by hand.
function blob(rnd: Rnd, cx: number, cy: number, r: number, amp: number, n = 72): string {
  const p1 = rnd() * 6.283, p2 = rnd() * 6.283;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283, rr = r + Math.sin(a * 3 + p1) * amp * 0.4 + Math.sin(a * 7 + p2) * amp * 0.25 + (rnd() - 0.5) * amp * 0.6;
    d += (i ? "L" : "M") + f1(cx + rr * Math.cos(a)) + " " + f1(cy + rr * Math.sin(a));
  }
  return d + "Z";
}

// A scalloped edge, for a rosette.
function scallop(n: number, R: number, cx: number, cy: number, turn = 0): string {
  const step = (Math.PI * 2) / n, rb = R * Math.sin(step / 2) * 1.12;
  let d = "";
  for (let i = 0; i <= n; i++) {
    const a = i * step - Math.PI / 2 + turn, x = f1(cx + R * Math.cos(a)), y = f1(cy + R * Math.sin(a));
    d += i === 0 ? `M${x} ${y}` : `A${f1(rb)} ${f1(rb)} 0 0 1 ${x} ${y}`;
  }
  return d + "Z";
}

function grow(corners: Pt[], d: number): Pt[] {
  const cx = corners.reduce((s, p) => s + p[0], 0) / corners.length, cy = corners.reduce((s, p) => s + p[1], 0) / corners.length;
  return corners.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * d, y + ((y - cy) / l) * d];
  });
}

function tornRun(rnd: Rnd, x0: number, x1: number, y: number, amp: number, step = 7): Pt[] {
  const n = Math.max(2, Math.round(Math.abs(x1 - x0) / step));
  const p1 = rnd() * 6.28, p2 = rnd() * 6.28;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([f1(x0 + (x1 - x0) * t), f1(y + Math.sin(t * 7 + p1) * amp * 0.35 + Math.sin(t * 19 + p2) * amp * 0.18 + (rnd() - 0.5) * amp * 0.8)]);
  }
  return pts;
}

function tornSide(rnd: Rnd, y0: number, y1: number, x: number, amp: number, step = 6): Pt[] {
  const n = Math.max(2, Math.round(Math.abs(y1 - y0) / step));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push([f1(x + (rnd() - 0.5) * amp + Math.sin(i * 1.7) * amp * 0.3), f1(y0 + ((y1 - y0) * i) / n)]);
  return pts;
}

const line = (pts: Pt[]): string => pts.map(([x, y]) => `L${x} ${y}`).join("");
const tornBand = (rnd: Rnd, W: number, base: number, amp: number): string => `M0 0H${W}V${base}` + line(tornRun(rnd, W, 0, base, amp)) + "Z";

function tornStrip(rnd: Rnd, W: number, H: number, a: number): string {
  const top = tornRun(rnd, a, W - a, a, a * 0.7, 9), right = tornSide(rnd, a, H - a, W - a, a * 1.6), bottom = tornRun(rnd, W - a, a, H - a, a * 0.7, 9), left = tornSide(rnd, H - a, a, a, a * 1.6);
  return `M${top[0][0]} ${top[0][1]}` + line(top.slice(1)) + line(right) + line(bottom) + line(left) + "Z";
}

function smooth(pts: Pt[]): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// ---- the pieces every page wears ----

let bands = "";
/** The torn bands under the bar: holly over crimson, each torn along its foot and showing the white
 *  core of the tear. Drawn wide and cut to the screen, not squashed, so the teeth stay one size. */
export function tornBands(): string {
  if (bands) return bands;
  const rnd = seeded(seedOf("the torn bands"));
  bands =
    `<div class="elf-bands" aria-hidden="true"><svg viewBox="0 0 2400 40" preserveAspectRatio="xMidYMin slice" focusable="false">` +
    `<path fill="${CARD}" d="${tornBand(rnd, 2400, 31, 7)}"/><path class="elf-fill-crimson" d="${tornBand(rnd, 2400, 28, 7)}"/>` +
    `<path fill="${CARD}" d="${tornBand(rnd, 2400, 18, 6)}"/><path class="elf-fill-holly" d="${tornBand(rnd, 2400, 15.5, 6)}"/></svg></div>`;
  return bands;
}

const HW = 1600, HH = 260;
const hill = (pts: Pt[]): string => smooth(pts) + `V${HH + 10}H${pts[0][0]}Z`;
const L1: Pt[] = [[-30, 118], [150, 74], [330, 112], [520, 62], [700, 104], [880, 58], [1060, 100], [1240, 64], [1420, 106], [1630, 72]];
const L2: Pt[] = [[-30, 172], [180, 142], [400, 176], [640, 136], [860, 170], [1080, 138], [1300, 174], [1500, 142], [1630, 162]];
const L3: Pt[] = [[-30, 220], [260, 200], [540, 226], [820, 202], [1100, 228], [1380, 204], [1630, 218]];

function yAt(pts: Pt[], x: number): number {
  for (let i = 0; i < pts.length - 1; i++) {
    if (x >= pts[i][0] && x <= pts[i + 1][0]) {
      const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    }
  }
  return pts[pts.length - 1][1];
}

// A cut paper tree: each tier a lit half and a shaded half, the light from the top left.
function treeHalves(x: number, base: number, h: number): { lit: string; shade: string } {
  const tiers: [number, number, number][] = [[0, 1, 0.5], [0.3, 0.8, 0.4], [0.56, 0.58, 0.32]];
  let lit = "", shade = "";
  for (const [lift, wide, tall] of tiers) {
    const top = base - h * (lift + tall + 0.12), foot = base - h * lift, half = (h * wide) / 2.3;
    lit += `M${f1(x)} ${f1(top)}L${f1(x - half)} ${f1(foot)}L${f1(x)} ${f1(foot - h * 0.04)}Z`;
    shade += `M${f1(x)} ${f1(top)}L${f1(x + half)} ${f1(foot)}L${f1(x)} ${f1(foot - h * 0.04)}Z`;
  }
  return { lit, shade };
}

function star(x: number, y: number, r: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2, k = i % 2 ? r * 0.45 : r;
    d += `${i ? "L" : "M"}${f1(x + k * Math.cos(a))} ${f1(y + k * Math.sin(a))}`;
  }
  return `<path class="elf-fill-gold" d="${d}Z"/>`;
}

let hills = "";
/** The cut paper hills above the footer: holly hills with cream paper trees and gold stars, then
 *  crimson and maroon hills in front, running into the maroon footer, with the paper grain on them. */
export function paperHills(): string {
  if (hills) return hills;
  const trees = [[120, 70], [270, 96], [455, 80], [610, 104], [760, 76], [990, 100], [1150, 84], [1330, 98], [1500, 78]].map(([x, h]) => treeHalves(x, yAt(L2, x) + 24, h));
  const lit = trees.map((t) => t.lit).join(""), shade = trees.map((t) => t.shade).join("");
  const stars = [[330, 52, 8], [700, 44, 9], [1060, 50, 8], [1420, 54, 7], [240, 34, 5], [610, 30, 5.5], [960, 32, 5], [1300, 34, 5.5]].map(([x, y, r]) => star(x, y, r)).join("");
  hills =
    `<div class="elf-hills" aria-hidden="true"><svg viewBox="0 0 ${HW} ${HH}" preserveAspectRatio="xMidYMax slice" focusable="false">` +
    `<defs><filter id="elf-hills-lift" x="-5%" y="-30%" width="110%" height="160%"><feDropShadow dx="0" dy="-2" stdDeviation="3.2" flood-color="#3A0000" flood-opacity="0.4"/></filter>` +
    `<pattern id="elf-hills-grain" patternUnits="userSpaceOnUse" width="384" height="384"><image href="${PAPER}ui/grain.webp" width="384" height="384"/></pattern>` +
    `<clipPath id="elf-hills-clip"><path d="${hill(L1)}"/><path d="${lit}${shade}"/></clipPath></defs>` +
    stars +
    `<path class="elf-fill-holly" d="${hill(L1)}"/>` +
    `<g filter="url(#elf-hills-lift)"><path fill="${CARD}" d="${lit}"/><path class="elf-fill-tan" d="${shade}"/></g>` +
    `<path class="elf-fill-crimson" filter="url(#elf-hills-lift)" d="${hill(L2)}"/>` +
    `<path class="elf-fill-maroon" filter="url(#elf-hills-lift)" d="${hill(L3)}"/>` +
    `<rect class="elf-hills__grain" width="${HW}" height="${HH + 10}" fill="url(#elf-hills-grain)" clip-path="url(#elf-hills-clip)"/></svg></div>`;
  return hills;
}

/** How many paper stars and snowflakes drift down a page. Each one's place, size and speed are in the
 *  stylesheet, so nothing is written into the markup; they drift only for a visitor who has not asked
 *  for less motion. */
export const SKY_FLAKES = 18;

/** A few paper stars and snowflakes drifting down behind the page. */
export function paperSky(): string {
  const flakes = Array.from({ length: SKY_FLAKES }, (_, i) => (i % 4 === 0 ? '<i class="elf-sky__star"></i>' : "<i></i>")).join("");
  return `<div class="elf-sky" aria-hidden="true">${flakes}</div>`;
}

/** The soft shadow the paper pieces drawn into a page share (light from the top left). Once a page. */
export function paperSprite(): string {
  return (
    `<svg class="elf-sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>` +
    `<filter id="elf-paper-lift" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0.6" dy="1.6" stdDeviation="1.3" flood-color="#3A0000" flood-opacity="0.35"/></filter></defs></svg>`
  );
}

// ---- pieces a page lays out ----

const safeClass = (value: string): string => value.replace(/[^a-z0-9_ -]/g, "").trim();

/** A scrap of torn coloured paper, tucked behind something. `className` places it. */
export function scrap(colour: PaperColour, size: "s" | "m" = "m", className = ""): string {
  const c = colourOf(colour, "tan");
  const [W, H] = size === "s" ? [90, 50] : [120, 64];
  const extra = safeClass(className);
  const rnd = seeded(seedOf(`a scrap ${c} ${size} ${extra}`));
  const j = (v: number): number => (rnd() - 0.5) * v;
  const corners: Pt[] = [[10 + j(14), 8 + j(10)], [W - 10 + j(14), 6 + j(10)], [W - 8 + j(10), H - 10 + j(12)], [12 + j(12), H - 7 + j(10)]];
  return (
    `<span class="elf-scrap elf-scrap--${size === "s" ? "s" : "m"}${extra ? ` ${extra}` : ""}" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" focusable="false">` +
    `<path fill="${CARD}" fill-opacity="0.55" d="${tornPoly(rnd, grow(corners, 3.2), 3.4)}"/><path fill="${CARD}" d="${tornPoly(rnd, grow(corners, 1.6), 3)}"/>` +
    `<path class="elf-fill-${c}" d="${tornPoly(rnd, corners, 2.8)}"/></svg></span>`
  );
}

// A torn strip: with a rim, coloured paper showing the white of the tear; without, plain card.
function strip(seed: string, W: number, H: number, cls: string, rim: boolean, amp: number): string {
  const rnd = seeded(seedOf(seed));
  const corners = (inset: number): Pt[] => snipped(rnd, W, H, inset, 3, amp * 0.8);
  return (
    `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">` +
    (rim ? `<path fill="${CARD}" fill-opacity="0.55" d="${tornPoly(rnd, corners(1.5), amp * 1.1)}"/><path fill="${CARD}" d="${tornPoly(rnd, corners(3), amp)}"/>` : "") +
    `<path class="${rim ? "elf-strip__colour" : "elf-strip__card"}" d="${tornPoly(rnd, corners(rim ? 5.5 : 3), amp * 0.9)}"/></svg>`
  );
}

let titleSheets = "";
// The title's two sheets: torn colour behind, torn card in front. One drawing for every title.
function titleBacking(): string {
  if (titleSheets) return titleSheets;
  const rnd = seeded(seedOf("the title strip"));
  titleSheets =
    `<svg class="elf-title__back" viewBox="0 0 600 130" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path fill="${CARD}" d="${tornStrip(rnd, 600, 130, 7)}"/><path class="elf-strip__colour" d="${tornStrip(rnd, 600, 130, 9)}"/></svg>` +
    `<svg class="elf-title__front" viewBox="0 0 600 130" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="elf-strip__card" d="${tornStrip(rnd, 600, 130, 6)}"/></svg>`;
  return titleSheets;
}

const deco = (name: string, cls: string, w: number, h: number): string =>
  `<img class="elf-deco ${cls}" src="${PAPER}deco/${name}.webp" width="${w}" height="${h}" alt="" decoding="async" />`;

const idOf = (id: string | undefined): string => (id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) ? ` id="${id}"` : "");

/** A page's title on a torn strip of card laid over a torn strip of colour, with scraps of torn paper
 *  behind and the painted candy cane and holly, as mockup 6's title. */
export function titleStrip(o: { text: string; tag?: "h1" | "h2"; back?: PaperColour; decor?: "cane-holly" | "holly" | "none"; id?: string }): string {
  const tag = o.tag === "h2" ? "h2" : "h1";
  const back = colourOf(o.back, "holly");
  const decor = o.decor ?? "cane-holly";
  return (
    `<div class="elf-title elf-strip--${back}">` +
    scrap("gold", "m", "elf-scrap--title-a") +
    scrap("crimson", "s", "elf-scrap--title-b") +
    titleBacking() +
    (decor === "cane-holly" ? deco("candy-cane", "elf-deco--cane", 279, 480) : "") +
    (decor !== "none" ? deco("holly", "elf-deco--holly", 480, 461) : "") +
    `<${tag} class="elf-title__text"${idOf(o.id)}>${escapeHtml(o.text)}</${tag}>` +
    `</div>`
  );
}

/** A section's heading on a smaller torn strip, laid the same way. */
export function headingStrip(o: { text: string; tag: "h2" | "h3"; back: PaperColour; id?: string }): string {
  const tag = o.tag === "h3" ? "h3" : "h2";
  const back = colourOf(o.back, "crimson");
  return (
    `<${tag} class="elf-strip elf-strip--${back}"${idOf(o.id)}>` +
    strip(`a heading strip ${back}`, 340, 80, "elf-strip__back", true, 4) +
    strip(`a heading strip ${back} front`, 340, 80, "elf-strip__front", false, 3.4) +
    `<span class="elf-strip__text">${escapeHtml(o.text)}</span></${tag}>`
  );
}

/** A scalloped paper rosette, for a number or a count: an under layer, a ring, a cream mount and a
 *  coloured centre, each its own piece of paper with a little shadow, and ribbon tails when asked.
 *  Its colours come from --elf-rosette-under, --elf-rosette-ring and --elf-rosette-disc. */
export function rosette(o: { className: string; petals?: number; tails?: boolean }): string {
  const petals = Math.max(8, Math.min(24, Math.round(Number(o.petals) || 16)));
  const r = o.tails ? 45 : 44;
  const rnd = seeded(seedOf(`a rosette ${petals}`));
  const tails = o.tails
    ? `<path class="elf-fill-maroon" filter="url(#elf-paper-lift)" d="M37 72L24 103L32 99L36 106L48 76Z"/><path class="elf-fill-crimson" filter="url(#elf-paper-lift)" d="M63 72L76 103L68 99L64 106L52 76Z"/>`
    : "";
  return (
    `<svg class="elf-rosette ${safeClass(o.className)}" viewBox="0 0 100 ${o.tails ? 108 : 100}" aria-hidden="true" focusable="false">${tails}` +
    `<path class="elf-rosette__under" filter="url(#elf-paper-lift)" d="${scallop(petals, r, 50, 50, Math.PI / petals)}"/>` +
    `<path class="elf-rosette__ring" filter="url(#elf-paper-lift)" d="${scallop(petals, r - 4, 50, 50)}"/>` +
    `<path fill="${CARD}" d="${blob(rnd, 50, 50, r - 11, 1.4)}"/>` +
    `<path class="elf-rosette__disc" filter="url(#elf-paper-lift)" d="${blob(rnd, 50, 50, r - 14, 1.5)}"/>` +
    `<circle cx="50" cy="50" r="${r - 19}" fill="none" stroke="rgba(248,245,238,0.7)" stroke-width="1.4" stroke-dasharray="3.2 2.6"/></svg>`
  );
}

export type TagColour = "crimson" | "holly" | "tan" | "card" | "gold";
const TAG_COLOURS: readonly TagColour[] = ["crimson", "holly", "tan", "card", "gold"];
const TAG_PATH = "M31 2H69L98 31V112Q98 118 92 118H8Q2 118 2 112V31Z";

/** A gift tag's own shape, two sheets: a coloured backing tag peeping out from behind, and the tag with
 *  its stitched line, eyelet and the paper grain. `i` keeps each tag's clipping apart on a page. */
export function giftTag(o: { i: number; colour: TagColour }): string {
  const i = Math.max(0, Math.min(99, Math.round(Number(o.i) || 0)));
  const colour: TagColour = TAG_COLOURS.includes(o.colour) ? o.colour : "card";
  const light = colour === "card" || colour === "gold";
  return (
    `<svg class="elf-tag__card elf-tag--${colour}" viewBox="0 0 100 120" aria-hidden="true" focusable="false"><defs><clipPath id="elf-tag-clip-${i}"><path d="${TAG_PATH}"/></clipPath></defs>` +
    `<path class="elf-tag__back" d="${TAG_PATH}" transform="translate(${i % 2 ? -3 : 3} 4) rotate(${i % 2 ? -3 : 3} 50 60)"/>` +
    `<path class="elf-tag__fill" d="${TAG_PATH}"/>` +
    `<image class="elf-tag__grain${light ? " elf-tag__grain--light" : ""}" href="${PAPER}ui/${light ? "grain-light" : "grain"}.webp" x="0" y="0" width="256" height="256" clip-path="url(#elf-tag-clip-${i})"/>` +
    `<path class="elf-tag__stitch" d="M34 9H66L91 34V108Q91 111 88 111H12Q9 111 9 108V34Z"/>` +
    `<circle class="elf-tag__ring" cx="50" cy="19" r="7.5"/><circle class="elf-tag__hole" cx="50" cy="19" r="4.4"/></svg>`
  );
}

/** A colour choice cut as a circle of paper on a cream mount, with a crimson mat that shows under the
 *  one picked. Only a real colour (#RRGGBB) is drawn; anything else is plain card. */
export function paperCircle(fill: string): string {
  const colour = typeof fill === "string" && /^#[0-9A-Fa-f]{6}$/.test(fill) ? fill : CARD;
  const rnd = seeded(seedOf(`a paper circle ${colour}`));
  return (
    `<svg class="elf-circle" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
    `<path class="elf-circle__mat" d="${blob(rnd, 50, 52, 49, 4)}"/><path class="elf-circle__rim" fill="${CARD}" d="${blob(rnd, 50, 50, 42, 3)}"/>` +
    `<path class="elf-circle__fill" fill="${colour}" d="${blob(rnd, 50, 50, 35, 2.6)}"/></svg>`
  );
}
