import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HAIR_COLOURS, HAIR_STYLES, OUTFITS, SIBLINGS, SKIN_TONES, STYLES } from "../../src/elf/wardrobe";
// @ts-expect-error a plain JavaScript tool, with no type declarations
import { FITTING_ELF, allJobs, layerName } from "../../scripts/elf-paint/jobs.mjs";

// NBCC Elf Detective School: the painted dress-up elf (plan Task 3). Every painting the wardrobe
// needs, worked out from the catalogue, so nothing can be missed and nothing painted twice.

type Job = { id: string; batch: string; kind: string; prompt: string; from: string; layer?: string; base?: string };
const jobs: Job[] = allJobs();
const ofKind = (kind: string) => jobs.filter((j) => j.kind === kind);
const byId = (id: string) => jobs.find((j) => j.id === id)!;
const designs = JSON.parse(readFileSync(resolve(__dirname, "../../scripts/elf-paint/designs.json"), "utf8"));
const PIECES = STYLES.reduce((n, s) => n + s.colours.length, 0);

describe("the elves", () => {
  it("are 150, one for each sibling, skin tone, hairstyle and hair colour", () => {
    expect(ofKind("elf")).toHaveLength(SIBLINGS.length * SKIN_TONES.length * HAIR_STYLES.length * HAIR_COLOURS.length);
    expect(ofKind("elf")).toHaveLength(150);
  });

  it("paint sisters from the sister and brothers from the brother", () => {
    expect(byId("elf-sister-s3-short-blonde").from).toBe("master");
    expect(byId("elf-brother-s3-bunches-blonde").from).toBe("master-brother");
  });

  it("ask for the deeper browny red on the two darkest skin tones only", () => {
    for (const j of ofKind("elf")) expect(/deeper/.test(j.prompt), j.id).toBe(/^elf-(sister|brother)-s[45]-/.test(j.id));
  });

  it("change only the skin and the hair", () => {
    expect(byId("elf-sister-s3-bunches-blonde").prompt).toContain("golden blonde");
    expect(byId("elf-sister-s3-bunches-blonde").prompt).toContain("Keep this picture exactly the same");
  });
});

describe("the pieces and outfits", () => {
  it("have a worn painting and a painting on their own for every colour of every style, and every outfit", () => {
    const worn = ofKind("worn").length + ofKind("recolour").length;
    expect(worn).toBe(PIECES + OUTFITS.length);
    expect(ofKind("alone")).toHaveLength(PIECES + OUTFITS.length);
    expect(PIECES).toBe(75);
  });

  it("make every layer once, by its own name", () => {
    const layers = ofKind("alone").map((j) => j.layer);
    expect(new Set(layers).size).toBe(layers.length);
    expect(layers).toContain(layerName("piece", "bobble", "red"));
    expect(layers).toContain(layerName("outfit", "reindeer"));
  });

  it("paint the first colour on the elf and the others from it, so the design matches", () => {
    expect(byId("worn-tunic-green").from).toBe("master");
    expect(byId("worn-tunic-red").kind).toBe("recolour");
    expect(byId("worn-tunic-red").from).toBe("worn-tunic-green");
    expect(byId("alone-tunic-red").from).toBe("worn-tunic-red");
  });

  it("fit hats on curly hair, the biggest", () => {
    expect(FITTING_ELF).toBe("elf-sister-s2-curly-brown");
    expect(byId("worn-elf-red").from).toBe(FITTING_ELF);
    expect(byId("alone-elf-red").base).toBe(FITTING_ELF);
    expect(byId("worn-specs-black").from).toBe("master");
  });

  it("put gadgets in the right mitten", () => {
    expect(byId("worn-mag-brass").prompt).toMatch(/right mitten/);
  });
});

describe("the designs", () => {
  it("has a fresh design for every style and every outfit, and nothing else", () => {
    expect(Object.keys(designs.styles).sort()).toEqual(STYLES.map((s) => s.id).sort());
    expect(Object.keys(designs.outfits).sort()).toEqual(OUTFITS.map((o) => o.id).sort());
  });

  it("puts the starter kit and the Workshop outfit in the starter batch", () => {
    const starter = jobs.filter((j) => j.batch === "starter").map((j) => j.id).sort();
    expect(starter).toEqual(["alone-curly-maroon", "alone-elf-red", "alone-outfit-workshop", "alone-tunic-green", "worn-curly-maroon", "worn-elf-red", "worn-outfit-workshop", "worn-tunic-green"]);
  });

  it("paints every elf before anything is worn on one", () => {
    const order = ["elves", "starter", "hat", "top", "feet", "neck", "face", "hand", "extra", "outfits"];
    expect([...new Set(jobs.map((j) => j.batch))]).toEqual(order);
  });
});
