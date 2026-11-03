// NBCC Elf Detective School: the painted dress-up elf (docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md).
//
// Every painting the wardrobe needs, worked out from the catalogue in assets/js/elf-wardrobe.js, so
// a piece can never be missed or painted twice. The words for each piece are its fresh design, in
// designs.json beside this file: Jaimie asked for every piece to be designed from scratch, keeping
// only the idea (3 November 2026).
//
// A job is one painting. Each edits another painting (`from`): the master elf (the approved sister
// with red mittens), an elf made from it, or an earlier job.
//   elf       one of the 150 elves: the sister or the brother master (Jaimie chose a separate
//             brother or sister, 3 November 2026) with only its skin and hair changed;
//   worn      the first colour of a piece (or an outfit) painted onto an elf;
//   recolour  another colour of that piece, painted from the first so the design matches;
//   alone     the piece on its own, in the same place, everything else magenta: the layer.
// An alone job names its `layer`, the elf it was worn on (`base`), and `still`, a box the piece
// does not touch, for lining the paintings up (see cutout.mjs).
//
// Unit tested in test/unit/elf-paint-jobs.test.ts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const W = require(resolve(HERE, "../../assets/js/elf-wardrobe.js"));
const D = JSON.parse(readFileSync(resolve(HERE, "designs.json"), "utf8"));

/** Hats are fitted on the biggest hair, so they sit right on every hairstyle. */
export const FITTING_ELF = "elf-sister-s2-curly-brown";

/** Boxes on the 1024 by 1536 canvas that a piece leaves alone. Checked on the real master in Task 8. */
const LEGS = [380, 1050, 640, 1350];
const FACE = [400, 400, 620, 560];

/** The batches, in the order they are painted and shown to Jaimie. */
export const BATCHES = ["elves", "starter", "hat", "top", "feet", "neck", "face", "hand", "extra", "outfits"];
const STARTER = new Set(["elf:red", "tunic:green", "curly:maroon", "outfit:workshop"]);

const KEEP =
  "Keep this picture exactly the same: the same elf, pose, size and position, the same face, eyes, eyebrows and smile, " +
  "the same art style with the same browny red outlines and soft painterly shading, and the same flat magenta background.";
const STYLE_IT = "Paint it in exactly the same style as the elf: a thick browny red outline, soft painterly shading and a little texture.";

const WEARS = {
  hat: (d) => `Add only a hat on the elf's head: ${d}. The elf's ears still show.`,
  face: (d) => `Add only glasses on the elf's face: ${d}. The eyes still show through them.`,
  neck: (d) => `Add only, round the elf's neck, ${d}.`,
  top: (d) => `Change only the elf's top: instead of the cream top, the elf wears ${d}. The red mittens and the striped tights stay as they are.`,
  feet: (d) => `Change only the elf's feet: instead of the cream socks, the elf wears ${d}.`,
  hand: (d) => `Add only, held in the elf's right mitten, ${d}. The red mitten now grips it.`,
  extra: (d) => `Add only ${d}.`,
};

const ALONE_WHAT = {
  hat: (n) => `the ${n}`,
  face: (n) => `the ${n}`,
  neck: (n) => `the ${n}`,
  top: (n) => `the ${n}, sleeves and all`,
  feet: (n) => `the ${n}, both of them`,
  hand: (n) => `the ${n} and the red mitten holding it`,
  extra: (n) => `the ${n}`,
};

/** A layer's name: "elf-sister-s2-curly-brown", "piece-bobble-red", "outfit-reindeer". */
export function layerName(kind, ...ids) {
  return [kind, ...ids].join("-");
}

function colourWords(c) {
  return `${c.name.toLowerCase()} (about ${c.fill})`;
}

function alonePrompt(what) {
  return (
    `Keep only ${what} exactly as it is, in exactly the same place and size, with its outline and shading. ` +
    "Paint everything else, the whole elf and the background, one flat plain magenta (#FF00FF). Nothing but that on magenta."
  );
}

function elfJobs() {
  const out = [];
  for (const sibling of W.SIBLINGS)
  for (const skin of W.SKIN_TONES)
    for (const style of W.HAIR_STYLES)
      for (const hair of W.HAIR_COLOURS) {
        const deeper = D.deeper.includes(skin.id)
          ? " Because the skin is dark, make every outline, and the eyes, eyebrows and smile, a deeper, darker shade of the same browny red, so the face shows clearly."
          : "";
        const name = layerName("elf", sibling.id, skin.id, style.id, hair.id);
        out.push({
          id: name,
          batch: "elves",
          kind: "elf",
          from: sibling.id === "brother" ? "master-brother" : "master",
          layer: name,
          prompt:
            KEEP.replace("the same face, eyes", "the same face shape, eyes") +
            " Keep the red mittens, the cream top, the red and cream striped tights and the cream socks." +
            ` Change only the skin and the hair: the skin is ${D.skins[skin.id]}, and the hair is ${D.hairColours[hair.id]}, ${D.hairStyles[style.id]}.` +
            deeper,
        });
      }
  return out;
}

function pieceJobs() {
  const out = [];
  for (const style of W.STYLES) {
    const base = style.slot === "hat" ? FITTING_ELF : "master";
    const still = style.slot === "feet" ? FACE : LEGS;
    const name = style.name.toLowerCase();
    style.colours.forEach((c, i) => {
      const batch = STARTER.has(`${style.id}:${c.id}`) ? "starter" : style.slot;
      const worn = `worn-${style.id}-${c.id}`;
      const first = `worn-${style.id}-${style.colours[0].id}`;
      out.push(
        i === 0
          ? { id: worn, batch, kind: "worn", from: base, prompt: `${KEEP} ${WEARS[style.slot](`${D.styles[style.id]}, in ${colourWords(c)}`)} ${STYLE_IT}` }
          : {
              id: worn,
              batch,
              kind: "recolour",
              from: first,
              prompt: `Keep this picture exactly the same, everything identical. Change only the colour of the ${name}: it is now ${colourWords(c)}. Keep its design, shape, shading and outline exactly.`,
            },
      );
      out.push({ id: `alone-${style.id}-${c.id}`, batch, kind: "alone", from: worn, base, still, layer: layerName("piece", style.id, c.id), prompt: alonePrompt(ALONE_WHAT[style.slot](name)) });
    });
  }
  return out;
}

function outfitJobs() {
  const out = [];
  for (const outfit of W.OUTFITS) {
    const batch = STARTER.has(`outfit:${outfit.id}`) ? "starter" : "outfits";
    const worn = `worn-outfit-${outfit.id}`;
    out.push({
      id: worn,
      batch,
      kind: "worn",
      from: "master",
      prompt:
        "Keep the elf's face, eyes, eyebrows, smile, skin, size, position and pose exactly the same, in exactly the same art style with the same browny red outlines, on the same flat magenta background. " +
        `Dress the elf in ${D.outfits[outfit.id]}. The face shows. ${STYLE_IT}`,
    });
    out.push({
      id: `alone-outfit-${outfit.id}`,
      batch,
      kind: "alone",
      from: worn,
      base: "master",
      still: FACE,
      layer: layerName("outfit", outfit.id),
      prompt:
        "Keep only the costume exactly as it is, in exactly the same place and size, with its outline and shading. " +
        "Paint the elf's face, skin and hair, and the background, one flat plain magenta (#FF00FF), so only the costume is left, with a hole where the face is.",
    });
  }
  return out;
}

/** Every painting, in the order the batches are painted. */
export function allJobs() {
  const all = [...elfJobs(), ...pieceJobs(), ...outfitJobs()];
  return BATCHES.flatMap((b) => all.filter((j) => j.batch === b));
}
