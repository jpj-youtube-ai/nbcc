import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import sharp from "sharp";
import { BOWS, COSTUMES, FRIENDS, GLASSES, HAIR_COLOURS, HAIR_STYLES, SCENES, SIBLINGS, SKIN_TONES } from "../../src/elf/wardrobe";

// The approved paper pictures (Jaimie, 4 November 2026) as the site serves them. Everything the
// wardrobe, the elf's PNG and the pages draw comes from this one folder: a picture missing here is a
// broken picture on a child's screen, and one too many is weight nobody uses.
const ROOT = resolve(__dirname, "../..");
const PAPER = resolve(ROOT, "assets/img/elf/paper");

// The catalogue's ids.
const ids = (list: readonly { id: string }[]): string[] => list.map((item) => item.id);
const SIBLING_IDS = ids(SIBLINGS);
const SKINS = ids(SKIN_TONES);
const STYLES = ids(HAIR_STYLES);
const HAIRS = ids(HAIR_COLOURS);
const COSTUME_IDS = ids(COSTUMES);
const SCENE_IDS = ids(SCENES);
const FRIEND_IDS = ids(FRIENDS);
const GLASSES_IDS = ids(GLASSES);
const BOW_IDS = ids(BOWS);
const DECO = ["present-crimson", "present-holly", "present-cream", "candy-cane", "holly", "bauble", "bow-gold"];
const ICONS = ["costume", "scene", "friend", "frame", "glasses", "paint", "lock", "surprise", "camera", "bell"];

const elves = (): string[] =>
  SIBLING_IDS.flatMap((sib) => SKINS.flatMap((skin) => STYLES.flatMap((style) => HAIRS.map((hair) => `elves/elf-${sib}-${skin}-${style}-${hair}.webp`))));
const costumes = (): string[] => COSTUME_IDS.flatMap((id) => SKINS.map((skin) => `costumes/${id}-${skin}.webp`));
const costumeTiles = (): string[] => COSTUME_IDS.flatMap((id) => SKINS.map((skin) => `tiles/costumes/${id}-${skin}.webp`));
const scenes = (): string[] => SCENE_IDS.map((id) => `scenes/${id}.webp`);
const sceneTiles = (): string[] => SCENE_IDS.map((id) => `tiles/scenes/${id}.webp`);
const pieces = (): string[] => [...GLASSES_IDS, ...BOW_IDS].map((id) => `pieces/${id}.webp`);
const fitted = (): string[] => GLASSES_IDS.flatMap((g) => COSTUME_IDS.map((c) => `pieces/${g}--${c}.webp`));

function everyExpectedFile(): string[] {
  return [
    ...elves(),
    ...costumes(),
    ...costumeTiles(),
    ...scenes(),
    ...sceneTiles(),
    ...pieces(),
    ...fitted(),
    ...FRIEND_IDS.map((id) => `friends/${id}.webp`),
    ...DECO.map((name) => `deco/${name}.webp`),
    ...ICONS.map((name) => `icons/icon-${name}.webp`),
    "ui/grain.webp",
    "ui/grain-light.webp",
  ];
}

// The advent calendar has no painting of its own: Jaimie (5 November 2026) asked for NBCC's solid
// rich maroon in place of the rooftops across its doors, so board/rooftops.webp is gone.

function listAll(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listAll(path) : [relative(PAPER, path).split("\\").join("/")];
  });
}

const sizeOf = (name: string): number => statSync(resolve(PAPER, name)).size;
const sum = (sizes: number[]): number => sizes.reduce((a, b) => a + b, 0);
// A WebP file starts "RIFF", four bytes of length, then "WEBP".
const isWebp = (name: string): boolean => {
  const head = readFileSync(resolve(PAPER, name)).subarray(0, 12).toString("latin1");
  return head.startsWith("RIFF") && head.slice(8) === "WEBP";
};

describe("the paper pictures", () => {
  it("has a picture for every elf, costume in every skin, scene, friend, piece and decoration", () => {
    for (const name of everyExpectedFile()) {
      expect(existsSync(resolve(PAPER, name)), name).toBe(true);
      expect(isWebp(name), `${name} is a WebP picture`).toBe(true);
    }
  });

  it("has every pair of glasses fitted to every costume", () => {
    for (const g of GLASSES_IDS) for (const c of COSTUME_IDS) expect(existsSync(resolve(PAPER, `pieces/${g}--${c}.webp`)), `${g}--${c}`).toBe(true);
  });

  // It reads about 750 pictures' headers, which takes some seconds on a busy machine, so it has a
  // longer time limit of its own.
  it("puts every elf, costume, scene and glasses or bow tie layer on the same 640 by 960 canvas, so they line up", async () => {
    for (const name of [...elves(), ...costumes(), ...scenes(), ...pieces(), ...fitted()]) {
      const { width, height } = await sharp(resolve(PAPER, name)).metadata();
      expect(`${width} by ${height}`, name).toBe("640 by 960");
    }
  }, 30_000);

  it("keeps one skin's 51 costume tiles under 600 KB, as the old tile budget did", () => {
    for (const skin of SKINS) expect(sum(COSTUME_IDS.map((id) => sizeOf(`tiles/costumes/${id}-${skin}.webp`))), skin).toBeLessThan(600 * 1024);
  });

  it("keeps every elf, costume and scene picture under 150 KB and every tile under 20 KB", () => {
    for (const name of [...elves(), ...costumes(), ...scenes()]) expect(sizeOf(name), name).toBeLessThan(150 * 1024);
    for (const name of [...costumeTiles(), ...sceneTiles()]) expect(sizeOf(name), name).toBeLessThan(20 * 1024);
  });

  it("holds no other pictures", () => {
    expect(listAll(PAPER).filter((f) => f.endsWith(".webp")).sort()).toEqual(everyExpectedFile().sort());
  });
});
