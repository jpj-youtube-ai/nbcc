import { HAIR_COLOURS, HAIR_STYLES, OUTFITS, SIBLINGS, SKIN_TONES, STYLES, type PaintManifest } from "../../src/elf/wardrobe";

// NBCC Elf Detective School: a made up list of painted layers, one for everything in the catalogue,
// for tests that draw an elf whatever has been painted so far (the real list is
// assets/js/elf-paint.js). Use it with usePaint(PAINT_FIXTURE) before a test and usePaint(null)
// after. The magnifying glass hides part of the elf (its open mitten), so covers are tested too.

type Box = { x: number; y: number; w: number; h: number };

export const PAINT_FIXTURE: PaintManifest = (() => {
  const layers: Record<string, Box & { cover?: Box }> = {};
  for (const sib of SIBLINGS)
    for (const skin of SKIN_TONES)
      for (const style of HAIR_STYLES) for (const hair of HAIR_COLOURS) layers[`elf-${sib.id}-${skin.id}-${style.id}-${hair.id}`] = { x: 216, y: 190, w: 612, h: 1150 };
  for (const style of STYLES) for (const c of style.colours) layers[`piece-${style.id}-${c.id}`] = { x: 300, y: 100, w: 400, h: 300 };
  for (const o of OUTFITS) layers[`outfit-${o.id}`] = { x: 150, y: 40, w: 720, h: 1400 };
  layers["piece-mag-brass"] = { x: 600, y: 700, w: 200, h: 300, cover: { x: 640, y: 760, w: 90, h: 100 } };
  return { canvas: { w: 1024, h: 1536, view: [-79, 0, 1182, 1536] }, layers };
})();

/** The fixture with some layers left out, as if they were not painted yet. */
export function paintWithout(...names: string[]): PaintManifest {
  return { ...PAINT_FIXTURE, layers: Object.fromEntries(Object.entries(PAINT_FIXTURE.layers).filter(([k]) => !names.includes(k))) };
}
