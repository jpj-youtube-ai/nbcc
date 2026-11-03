import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error a plain JavaScript tool, with no type declarations
import { buildManifest } from "../../scripts/elf-paint/manifest.mjs";

// NBCC Elf Detective School: the painted dress-up elf (plan Task 4). The list of painted layers the
// site reads: where each sits on the canvas, and what of the elf it hides. It is written as a plain
// script that works on the server and in the browser, like the wardrobe itself.

const require = createRequire(import.meta.url);

function layerDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "elf-manifest-"));
  const places = {
    "piece-bobble-red": { x: 300, y: 40, w: 420, h: 380 },
    "piece-mag-brass": { x: 600, y: 700, w: 200, h: 300, cover: { x: 620, y: 760, w: 90, h: 100 } },
    "piece-half-done": { x: 1, y: 2, w: 3, h: 4 },
  };
  writeFileSync(join(dir, "places.json"), JSON.stringify(places));
  for (const size of ["tile", "sm", "lg"]) {
    mkdirSync(join(dir, size));
    writeFileSync(join(dir, size, "piece-bobble-red.webp"), "x");
    writeFileSync(join(dir, size, "piece-mag-brass.webp"), "x");
    writeFileSync(join(dir, size, "piece-mag-brass.cover.webp"), "x");
  }
  writeFileSync(join(dir, "sm", "piece-half-done.webp"), "x");
  return dir;
}

describe("the painted layers' list", () => {
  it("records each layer's place on the canvas, and the part of the elf it hides", () => {
    const m = buildManifest(layerDir(), join(mkdtempSync(join(tmpdir(), "elf-out-")), "elf-paint.js"));
    expect(m.canvas).toEqual({ w: 1024, h: 1536, view: [-79, 0, 1182, 1536] });
    expect(m.layers["piece-bobble-red"]).toEqual({ x: 300, y: 40, w: 420, h: 380 });
    expect(m.layers["piece-mag-brass"].cover).toEqual({ x: 620, y: 760, w: 90, h: 100 });
  });

  it("lists only layers whose three sizes all exist", () => {
    const m = buildManifest(layerDir(), join(mkdtempSync(join(tmpdir(), "elf-out-")), "elf-paint.js"));
    expect(m.layers["piece-half-done"]).toBeUndefined();
  });

  it("is a script that loads on the server and in a browser, and cannot be changed", () => {
    const out = join(mkdtempSync(join(tmpdir(), "elf-out-")), "elf-paint.js");
    buildManifest(layerDir(), out);
    const onServer = require(out);
    expect(onServer.layers["piece-bobble-red"].w).toBe(420);
    expect(Object.isFrozen(onServer.layers["piece-bobble-red"])).toBe(true);
    const win: { NBCCElfPaint?: { layers: Record<string, unknown> } } = {};
    new Function("window", readFileSync(out, "utf8"))(win);
    expect(Object.keys(win.NBCCElfPaint!.layers).sort()).toEqual(["piece-bobble-red", "piece-mag-brass"]);
  });
});
