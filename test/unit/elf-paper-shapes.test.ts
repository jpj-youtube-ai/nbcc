// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The torn paper shapes of the approved paper look (mockup 6, Jaimie, 4 November 2026), drawn once by
// scripts/elf-paper/shapes.mjs and served as small files: the stylesheet masks cards with the torn
// edge strips and lays buttons, chips, notes and tape on the torn shapes.
const ROOT = resolve(__dirname, "../..");
const UI = resolve(ROOT, "assets/img/elf/paper/ui");
const SCRIPT = resolve(ROOT, "scripts/elf-paper/shapes.mjs");

interface Mask { band: number; lengths: number[]; sides: string[] }
interface Shapes { masks: Record<string, Mask>; files: string[] }
const shapes = (): Shapes => JSON.parse(readFileSync(resolve(UI, "shapes.json"), "utf8"));

// The shapes mockup 6's style uses, by its own names.
const EDGE_MASKS = ["tear-card-a", "tear-card-b", "tear-card-c", "tear-tile-a", "tear-tile-b", "tear-fine-a", "tear-fine-b"];
const USED = [
  ...EDGE_MASKS.flatMap((m) => ["top", "bottom", "left", "right"].map((side) => `${m}-${side}.svg`)),
  "tear-top.svg", "blob-a.svg", "tape.svg",
  "btn-s-cream.svg", "btn-s-crimson.svg", "btn-s-maroon.svg", "btn-s-tan.svg",
  "btn-m-cane.svg", "btn-m-cream.svg", "btn-m-crimson.svg", "btn-m-holly.svg", "btn-m-hollydark.svg", "btn-m-maroon.svg", "btn-m-tan.svg",
  "btn-l-cream.svg", "btn-l-crimson.svg", "btn-l-maroon.svg", "btn-l-tan.svg",
  "chip-cream.svg", "chip-crimson.svg", "chip-gold.svg", "chip-holly.svg", "chip-tan.svg",
  "label-holly.svg", "note-cream.svg", "note-holly.svg", "note-kraft.svg", "tag-cream.svg",
];

describe("the torn paper shapes", () => {
  it("has every torn shape the paper look uses, as a file", () => {
    const { files } = shapes();
    for (const name of USED) expect(files, name).toContain(name);
    for (const name of files) expect(existsSync(resolve(UI, name)), name).toBe(true);
  });

  it("keeps every shape a small, plain picture with no script, no outside link and no words", () => {
    for (const name of shapes().files) {
      const svg = readFileSync(resolve(UI, name), "utf8");
      // The long buttons and notes are the biggest, at about 12 KB: their tears are kept as approved.
      expect(statSync(resolve(UI, name)).size, name).toBeLessThan(16 * 1024);
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      expect(doc.querySelector("parsererror"), name).toBeNull();
      expect(doc.documentElement.nodeName, name).toBe("svg");
      expect(svg, name).not.toMatch(/<script|<text|<foreignObject|href="http|\son[a-z]+=/i);
    }
  });

  it("stretches every shape that is laid over a box", () => {
    for (const name of shapes().files) {
      const doc = new DOMParser().parseFromString(readFileSync(resolve(UI, name), "utf8"), "image/svg+xml");
      expect(doc.documentElement.getAttribute("preserveAspectRatio"), name).toBe("none");
    }
  });

  it("says how each torn edge tiles, matching the strips themselves", () => {
    const { masks } = shapes();
    expect(Object.keys(masks).sort()).toEqual([...EDGE_MASKS, "tear-top"].sort());
    for (const [name, mask] of Object.entries(masks)) {
      expect(mask.lengths.length, name).toBe(mask.sides.length);
      mask.sides.forEach((side, i) => {
        const file = name === "tear-top" ? "tear-top.svg" : `${name}-${side}.svg`;
        const root = new DOMParser().parseFromString(readFileSync(resolve(UI, file), "utf8"), "image/svg+xml").documentElement;
        const across = side === "top" || side === "bottom";
        expect([Number(root.getAttribute("width")), Number(root.getAttribute("height"))], file).toEqual(across ? [mask.lengths[i], mask.band] : [mask.band, mask.lengths[i]]);
      });
    }
  });

  it("draws exactly the same tears every time, so the files are what the script makes", () => {
    const dir = mkdtempSync(join(tmpdir(), "elf-shapes-"));
    try {
      execFileSync(process.execPath, [SCRIPT, dir]);
      const made = readdirSync(dir).filter((f) => f.endsWith(".svg")).sort();
      expect(made).toEqual(shapes().files.slice().sort());
      for (const name of made) expect(readFileSync(join(dir, name), "utf8"), name).toBe(readFileSync(resolve(UI, name), "utf8"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
