// Build the pictures the newsletter's paper look blocks use: assets/img/email/*.
//
// An email is not a web page. Gmail strips SVG, Outlook on a desktop does not show WebP, and nothing
// can be laid over anything else. So every piece of art a block needs is a plain PNG or JPG here,
// already flattened onto the colour it will sit on (the email's cream, the paper card, a white print),
// at twice the size it is shown.
//
// Everything is DERIVED: resized and re-encoded from art already in assets/img, or a flat shape
// drawn in code below (the tape, the top of a gift tag, a torn strip, a snowy band). Nothing is
// painted by hand. Each file is listed in assets/img/CREDITS.md with what it came from.
//
// Two rules that are not arbitrary:
//   * Never reuse a file name for different art. Mail clients and the CDN keep a picture for a year,
//     and a newsletter already sent would change in people's inboxes. New art gets a new name.
//   * Keep them small. A hero stays under 150 KB; the little ones are a few KB each. A reader on a
//     phone signal waits for every one of these.
//
// Regenerate with:  node scripts/build-email-art.mjs
// (src/newsletter/paper-blocks.ts names these files; test/unit/newsletter-email-art.test.ts checks
// every name it uses is here, is the size it says, and is not too heavy.)

import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMG = resolve(ROOT, "assets/img");
const OUT = resolve(IMG, "email");
mkdirSync(OUT, { recursive: true });

// The colours the art is flattened onto: the same values the email itself uses.
const CREAM = "#F8F5EE"; // the email's card (src/newsletter/theme.ts CREAM)
const CARD = "#FFFDFA"; // a paper card
const WHITE = "#FFFFFF"; // a photo print's frame
const KRAFT = "#F3E4DD"; // a kraft card
const CRIMSON = "#C02238";
const HOLLY = "#1A531A";
const TAN = "#D29C8A";
const TAN_LIGHT = "#E8C4B4";
const GOLD = "#D9A93E";
const GOLD_INK = "#B8862B";
const LINE = "#D6C7B4";

const written = [];
async function save(pipeline, name) {
  const file = resolve(OUT, name);
  await pipeline.toFile(file);
  const meta = await sharp(file).metadata();
  written.push([name, meta.width, meta.height, statSync(file).size]);
}
const png = (pipeline) => pipeline.png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 });
const jpg = (pipeline, quality) => pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
const svg = (markup) => sharp(Buffer.from(markup));
const blank = (width, height, background) => sharp({ create: { width, height, channels: 3, background } });

// A repeatable "random", so a rebuild gives the same ragged edges and the files do not churn.
function jitter(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ---- pictures from the paintings ---------------------------------------------------------------

// The Workshop, half full: a header picture, cropped a little wider than it was painted.
await save(
  jpg(sharp(resolve(IMG, "red-bag/workshop/s08.webp")).resize(1272, 716, { fit: "cover", position: "centre" }), 70),
  "hero-workshop.jpg",
);

// The sleigh has no background of its own: stood on the email's cream.
{
  const sleigh = await sharp(resolve(IMG, "santa-sleigh-1340.webp")).resize(1060, 500, { fit: "inside" }).toBuffer();
  await save(jpg(blank(1272, 560, CREAM).composite([{ input: sleigh, gravity: "centre" }]), 82), "hero-sleigh.jpg");
}

// Three square prints of the Workshop filling up, for a photo row or a story that has no photo yet.
for (const [stage, n] of [["s03", 1], ["s08", 2], ["s12", 3]]) {
  await save(
    jpg(sharp(resolve(IMG, `red-bag/workshop/${stage}.webp`)).resize(560, 560, { fit: "cover", position: "centre" }), 72),
    `print-workshop-${n}.jpg`,
  );
}

// The Red Bag list's paintings, small, on the paper card they are listed on.
const ITEMS = [
  "blanket", "insulated-cup", "toiletry-set", "toy", "soft-toy", "headphones", "book", "colouring-book",
  "pencil", "notebook", "pyjamas", "socks", "hat-gloves", "present",
  "crisis-15", "crisis-30", "crisis-60", "school-25", "school-35", "school-40", "hand-20", "hand-75", "hand-150",
];
for (const key of ITEMS) {
  await save(
    png(sharp(resolve(IMG, `red-bag/${key}.webp`)).resize(88, 88, { fit: "contain", background: CARD }).flatten({ background: CARD })),
    `item-${key}.png`,
  );
}

// The Kilmarnock Santa Sleigh team's logo, as a PNG (it is only held as WebP).
await save(png(sharp(resolve(IMG, "kilmarnock-santa-sleigh-logo.webp")).resize(320, 180)), "logo-kilmarnock-santa-sleigh.png");

// ---- the festive dividers ----------------------------------------------------------------------

// The gold bow, on cream; the block draws the gold ribbon either side of it as plain table cells.
await save(
  png(sharp(resolve(IMG, "red-bag/bow.webp")).resize(200, 140, { fit: "contain", background: CREAM }).flatten({ background: CREAM })),
  "trim-bow.png",
);

// A star between a snowflake and a twinkle.
{
  const icon = (name, size) => sharp(resolve(IMG, `red-bag/${name}.webp`)).resize(size, size, { fit: "inside" }).toBuffer();
  const [flake, star, twinkle] = [await icon("snowflake", 68), await icon("star", 92), await icon("twinkle", 68)];
  await save(
    png(
      blank(440, 100, CREAM).composite([
        { input: flake, left: 40, top: 14 },
        { input: star, left: 174, top: 5 },
        { input: twinkle, left: 336, top: 13 },
      ]),
    ),
    "trim-stars.png",
  );
}

// A band of holly-green night with snow falling and a drift along the bottom: the drift's shape is
// the site's own (src/red-bag/scene.ts DRIFT), drawn here as a flat shape.
{
  const W = 1272;
  const H = 120;
  const rand = jitter(24);
  let flakes = "";
  for (let i = 0; i < 46; i += 1) {
    const x = Math.round(rand() * W);
    const y = Math.round(6 + rand() * (H - 62));
    const r = (1.6 + rand() * 2.6).toFixed(1);
    flakes += `<circle cx="${x}" cy="${y}" r="${r}" fill="${CREAM}" fill-opacity="${(0.45 + rand() * 0.5).toFixed(2)}"/>`;
  }
  const drift = "M0 62c90-34 170-44 262-20s150 44 252 26 176-58 292-44 168 54 276 50 170-40 358-34v60H0z";
  await save(
    png(
      svg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
          `<rect width="${W}" height="${H}" fill="${HOLLY}"/>${flakes}` +
          `<g transform="translate(-70 ${H - 100}) scale(${(W / 1440) * 1.12} 1)"><path d="${drift}" fill="#C9D8C6"/></g>` +
          `<g transform="translate(0 ${H - 88}) scale(${W / 1440} 0.88)"><path d="${drift}" fill="${CREAM}"/></g>` +
          `</svg>`,
      ).flatten({ background: HOLLY }),
    ),
    "trim-snow.png",
  );
}

// A torn strip of tan paper across the cream.
{
  const W = 1272;
  const H = 56;
  const rand = jitter(7);
  const edge = (base, spread) => {
    const pts = [];
    for (let x = 0; x <= W; x += 12) pts.push([x, +(base + (rand() - 0.5) * spread).toFixed(1)]);
    return pts;
  };
  const top = edge(13, 12);
  const bottom = edge(H - 13, 12).reverse();
  const d = "M" + [...top, ...bottom].map(([x, y]) => `${x} ${y}`).join("L") + "Z";
  await save(
    png(
      svg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
          `<rect width="${W}" height="${H}" fill="${CREAM}"/><path d="${d}" fill="${TAN_LIGHT}"/></svg>`,
      ).flatten({ background: CREAM }),
    ),
    "trim-torn.png",
  );
}

// ---- tape --------------------------------------------------------------------------------------

// One strip of tape, 112 by 30 as shown, drawn at twice that with pinked ends and a slight slant. It
// is cut in two along the paper's top edge: the top half sits above a card on the email's cream, the
// bottom half is the first thing inside the card, on the card's own colour. The card's top border
// shows between the two like the edge of the paper through the tape.
{
  const W = 224;
  const H = 60;
  const zig = (x, out, from, to, step) => {
    const pts = [];
    const dir = to > from ? 1 : -1;
    for (let y = from, i = 0; dir > 0 ? y <= to : y >= to; y += dir * step, i += 1) pts.push(`${i % 2 ? x + out : x} ${y}`);
    return pts;
  };
  const d = "M" + [...zig(10, 7, 8, 52, 5.5), ...zig(214, -7, 52, 8, 5.5)].join("L") + "Z";
  const tape = await svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<g transform="rotate(-1.6 ${W / 2} ${H / 2})"><path d="${d}" fill="${TAN}" fill-opacity="0.62"/></g></svg>`,
  )
    .png()
    .toBuffer();
  const half = async (background, top) =>
    png(sharp(await blank(W, H, background).composite([{ input: tape }]).png().toBuffer()).extract({ left: 0, top, width: W, height: H / 2 }));
  await save(await half(CREAM, 0), "tape-top.png");
  await save(await half(CARD, H / 2), "tape-on-card.png");
  await save(await half(WHITE, H / 2), "tape-on-white.png");
  await save(await half(KRAFT, H / 2), "tape-on-kraft.png");
}

// ---- the top of a gift tag ---------------------------------------------------------------------

// The home page's hanging tags cut their corners and punch their hole with clip-path and a mask,
// which no mail client has. So the top of a tag is a picture: the two cut corners, the hole with its
// gold ring, and the gold string it hangs from, on the email's cream. The rest of the tag is a plain
// coloured table cell under it.
{
  const W = 360;
  const H = 104;
  const TOP = 18; // room above the tag for the string
  const C = 46; // the cut corner
  const shape = `M${C} ${TOP}L${W - C} ${TOP}L${W} ${TOP + C}L${W} ${H}L0 ${H}L0 ${TOP + C}Z`;
  const outline = `M1 ${H}L1 ${TOP + C}L${C} ${TOP + 1}L${W - C} ${TOP + 1}L${W - 1} ${TOP + C}L${W - 1} ${H}`;
  const cx = W / 2;
  const cy = TOP + 38;
  for (const [name, fill, edged] of [["card", CARD, true], ["crimson", CRIMSON, false], ["holly", HOLLY, false], ["tan", TAN, false]]) {
    await save(
      png(
        svg(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
            `<rect width="${W}" height="${H}" fill="${CREAM}"/>` +
            `<path d="${shape}" fill="${fill}"/>` +
            (edged ? `<path d="${outline}" fill="none" stroke="${LINE}" stroke-width="2"/>` : "") +
            `<circle cx="${cx}" cy="${cy}" r="13" fill="${CREAM}"/>` +
            `<circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="${GOLD}" stroke-width="6"/>` +
            `<line x1="${cx}" y1="0" x2="${cx}" y2="${cy - 2}" stroke="${GOLD}" stroke-width="4"/>` +
            `<line x1="${cx}" y1="0" x2="${cx}" y2="${cy - 2}" stroke="${GOLD_INK}" stroke-width="4" stroke-dasharray="6 6"/>` +
            `</svg>`,
        ).flatten({ background: CREAM }),
      ),
      `tag-top-${name}.png`,
    );
  }
}

let total = 0;
for (const [name, w, h, bytes] of written) {
  total += bytes;
  console.log(`${name.padEnd(36)} ${String(w).padStart(4)}x${String(h).padEnd(4)} ${(bytes / 1024).toFixed(1).padStart(6)} KB`);
}
console.log(`${written.length} files, ${(total / 1024).toFixed(0)} KB in all, in assets/img/email/`);
