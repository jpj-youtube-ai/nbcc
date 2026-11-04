import { describe, it, expect } from "vitest";
// @ts-expect-error a plain JavaScript tool, with no type declarations
import { alignBlob, contentBox, coverOutside, fillBox, fitBottomWidth, fitCentred, fitContain, fitHole, fitHoleOnFloor, heldBehind, regionCover } from "../../scripts/elf-paint/fit.mjs";

// NBCC Elf Detective School: the painted dress-up elf, second way (Jaimie, 3 November 2026: "you
// should have been rendering these things as separate items that are on transparent backgrounds").
// Each item is painted on its own on a clear background, then fitted onto the 1024 by 1536 canvas
// where it belongs on the elf. Nothing is cut out of a painting of the elf.

type Rgba = { data: Uint8ClampedArray; width: number; height: number };
const CW = 1024;
const CH = 1536;

function clear(w: number, h: number): Rgba {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}
function paint(img: Rgba, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): Rgba {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([...rgb, 255], (y * img.width + x) * 4);
  return img;
}
const alphaAt = (img: Rgba, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

describe("finding what is painted", () => {
  it("finds the box round the painted part of a clear picture", async () => {
    expect(contentBox(paint(clear(200, 100), 30, 20, 90, 70, [200, 0, 0]))).toEqual({ x: 30, y: 20, w: 60, h: 50 });
  });
});

describe("fitting an item onto the canvas", () => {
  it("stretches an item to fill a box exactly (tops, shoes, outfits)", async () => {
    const placed = await fillBox(paint(clear(300, 300), 50, 50, 250, 150, [0, 0, 200]), { x: 290, y: 700, w: 470, h: 330 });
    expect(placed.width).toBe(CW);
    expect(placed.height).toBe(CH);
    expect(contentBox(placed)).toEqual({ x: 290, y: 700, w: 470, h: 330 });
  });

  it("sizes a hat by the width of its brim, and sits the brim on a line", async () => {
    // A hat 100 wide at its brim with a tip poking 60 to the side above it.
    const hat = paint(paint(clear(300, 300), 100, 100, 200, 200, [200, 0, 0]), 200, 100, 260, 120, [200, 0, 0]);
    const placed = await fitBottomWidth(hat, { width: 500, bottom: 440, centreX: 528 });
    const box = contentBox(placed);
    expect(box.y + box.h).toBe(440);
    expect(alphaAt(placed, 528 - 245, 430)).toBe(255); // the brim reaches 250 each side
    expect(alphaAt(placed, 528 + 245, 430)).toBe(255);
    expect(alphaAt(placed, 528 - 260, 430)).toBe(0);
  });

  it("centres an item of a given width on a point (glasses, badges)", async () => {
    const placed = await fitCentred(paint(clear(200, 100), 20, 30, 180, 70, [90, 30, 30]), { width: 400, centreX: 528, centreY: 540 });
    const box = contentBox(placed);
    expect(box.w).toBe(400);
    expect(Math.round(box.x + box.w / 2)).toBe(528);
    expect(Math.round(box.y + box.h / 2)).toBe(540);
  });

  it("puts the mitten a gadget is held in exactly where the elf's own mitten is", async () => {
    // A blue torch held in a red mitten.
    const item = paint(paint(clear(400, 400), 150, 50, 190, 250, [40, 80, 200]), 130, 250, 210, 330, [190, 40, 40]);
    const placed = await alignBlob(item, { centreX: 315, centreY: 1000, height: 100 });
    // The red mitten is now centred on the elf's mitten, 100 tall.
    let n = 0;
    let sx = 0;
    let sy = 0;
    let top = CH;
    let bottom = 0;
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const i = (y * CW + x) * 4;
        if (placed.data[i + 3] > 200 && placed.data[i] > 150 && placed.data[i + 2] < 90) {
          n++;
          sx += x;
          sy += y;
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    expect(Math.abs(sx / n - 315)).toBeLessThan(3);
    expect(Math.abs(sy / n - 1000)).toBeLessThan(3);
    expect(Math.abs(bottom - top + 1 - 100)).toBeLessThan(3);
  });

  it("finds the mitten at the bottom of a gadget even when the gadget is red too", async () => {
    // A red torch held in a red mitten, touching (the first trial, 4 November 2026).
    const item = paint(paint(clear(400, 400), 150, 50, 190, 260, [200, 40, 40]), 130, 250, 210, 330, [190, 40, 40]);
    // Only the bottom 28% is looked at for the mitten (79 of the 280 rows, the mitten itself).
    const placed = await alignBlob(item, { centreX: 315, centreY: 1000, height: 100, band: 0.28 });
    const box = contentBox(placed);
    expect(Math.abs(box.y + box.h - 1050)).toBeLessThan(5); // the mitten's bottom, 50 below its middle
    expect(Math.abs(box.h - 354)).toBeLessThan(5); // the whole, scaled by 100 / 79
  });

  it("finds the mitten at the top of a gadget held from above, like a lantern", async () => {
    // A gold lantern hanging from a red mitten (4 November 2026).
    const item = paint(paint(clear(400, 400), 130, 50, 210, 130, [190, 40, 40]), 140, 130, 200, 330, [200, 160, 60]);
    const placed = await alignBlob(item, { centreX: 315, centreY: 1000, height: 100, band: 0.3, from: "top" });
    const box = contentBox(placed);
    expect(Math.abs(box.y - 950)).toBeLessThan(5); // the mitten's top, 50 above its middle
  });

  it("fits within a width and a height, whichever is tighter (a long scarf)", async () => {
    const placed = await fitContain(paint(clear(200, 400), 50, 0, 150, 400, [200, 0, 0]), { width: 330, height: 330, centreX: 528, top: 672 });
    expect(contentBox(placed)).toEqual({ x: 528 - 41, y: 672, w: 83, h: 330 });
  });

  it("stands a hooded costume on the floor with its face hole on the face", async () => {
    const hood = paint(clear(400, 600), 50, 50, 350, 550, [60, 140, 60]);
    for (let y = 100; y < 160; y++) for (let x = 170; x < 230; x++) hood.data[(y * 400 + x) * 4 + 3] = 0; // a small hole, centre (200, 130)
    const placed = await fitHoleOnFloor(hood, { centreX: 529, centreY: 545, floor: 1345 });
    const box = contentBox(placed);
    expect(box.y + box.h).toBe(1345); // its feet on the floor
    // The hole's middle on the face: (130 - 50 + 0.5) / 500 of the way down, scaled so 545 to 1345 is the rest.
    expect(alphaAt(placed, 529, 545)).toBe(0);
    expect(alphaAt(placed, 529, 700)).toBe(255);
  });

  it("fits a hooded costume by its face hole: centred on the face, its bottom on the chin", async () => {
    const hood = paint(clear(400, 600), 50, 50, 350, 550, [60, 140, 60]);
    for (let y = 100; y < 220; y++) for (let x = 140; x < 260; x++) hood.data[(y * 400 + x) * 4 + 3] = 0; // a hole 120 wide
    const placed = await fitHole(hood, { centreX: 525, chin: 682, width: 360 });
    expect(alphaAt(placed, 525, 600)).toBe(0); // the face shows through
    expect(alphaAt(placed, 525, 690)).toBe(255); // costume just below the chin
    expect(alphaAt(placed, 525 - 175, 600)).toBe(0); // the hole is 360 wide
    expect(alphaAt(placed, 525 - 190, 600)).toBe(255);
  });
});

describe("what an item hides of the elf", () => {
  it("hides the elf everywhere except where it should show through", async () => {
    const keep = paint(clear(CW, CH), 400, 400, 600, 600, [0, 0, 0]);
    const cover = coverOutside(keep);
    expect(alphaAt(cover, 500, 500)).toBe(0);
    expect(alphaAt(cover, 100, 100)).toBe(255);
  });

  it("hides a part of the elf found by its colour, inside a box (the cream top, the open mitten)", async () => {
    const master = paint(paint(clear(CW, CH), 300, 700, 700, 1000, [250, 240, 220]), 250, 950, 380, 1050, [190, 40, 40]);
    const cover = regionCover(master, { x: 240, y: 940, w: 150, h: 120 }, (r: number, g: number, b: number) => r > 150 && g < 90 && b < 90, 2);
    expect(alphaAt(cover, 300, 1020)).toBe(255); // the mitten
    expect(alphaAt(cover, 600, 800)).toBe(0); // not the top
  });
});

describe("a gadget held in the elf's own mitten", () => {
  it("is taken away where the elf's mitten is, so the mitten shows gripping it", () => {
    // The hands holding the gadgets did not line up with the arms (Jaimie, 4 November 2026): the
    // gadget is painted without a mitten and slides under the elf's own.
    const gadget = paint(clear(CW, CH), 300, 800, 330, 1040, [40, 80, 200]);
    const mitten = paint(clear(CW, CH), 270, 960, 360, 1050, [0, 0, 0]);
    const held = heldBehind(gadget, mitten);
    expect(alphaAt(held, 315, 850)).toBe(255); // above the mitten: the gadget
    expect(alphaAt(held, 315, 1000)).toBe(0); // inside the mitten: the elf's own mitten shows
  });
});

