import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOWS,
  COSTUMES,
  FRAMES,
  FRIENDS,
  GLASSES,
  HAIR_COLOURS,
  HAIR_STYLES,
  SCENES,
  SIBLINGS,
  SKIN_TONES,
  costumeLookWords,
  costumeUnlocked,
  defaultCostumeLook,
  doorState,
  lookPictures,
  normaliseCostumeLook,
} from "../../src/elf/wardrobe";

// The paper wardrobe (docs/superpowers/specs/2026-11-04-elf-paper-design.md): 51 whole costumes, three
// from the start and two for each door a detective does, and extras (scenes, friends, frames, glasses,
// bow ties) that are all there from sign up.
const PAPER = resolve(__dirname, "../../assets/img/elf/paper");
const NONE = { doors: [] as number[] };
const ALL = { doors: Array.from({ length: 24 }, (_, i) => i + 1) };

describe("the costumes", () => {
  it("has 51 costumes: three from the start and two for each door", () => {
    expect(COSTUMES).toHaveLength(51);
    expect(COSTUMES.filter((c) => c.door === 0).map((c) => c.id)).toEqual(["workshop", "reindeer", "snowman"]);
    for (let d = 1; d <= 24; d++) expect(COSTUMES.filter((c) => c.door === d), `door ${d}`).toHaveLength(2);
    expect(COSTUMES.filter((c) => c.door === 21).map((c) => c.id)).toEqual(["postbox", "nessie"]);
  });

  it("unlocks a door's two costumes when that door is done, and no others", () => {
    expect(costumeUnlocked("tree", NONE)).toBe(false);
    expect(costumeUnlocked("tree", { doors: [2] })).toBe(true);
    expect(costumeUnlocked("polarbear", { doors: [2] })).toBe(true);
    expect(costumeUnlocked("tree", { doors: [1, 3] })).toBe(false);
    expect(costumeUnlocked("reindeer", NONE)).toBe(true);
  });

  it("counts only real door numbers, never words or a missing list", () => {
    expect(costumeUnlocked("tree", { doors: ["2"] as unknown as number[] })).toBe(false);
    expect(costumeUnlocked("tree", {} as unknown as { doors: number[] })).toBe(false);
    expect(costumeUnlocked("tree", null as unknown as { doors: number[] })).toBe(false);
    expect(costumeUnlocked("dragon", ALL)).toBe(false);
  });

  it("cannot be changed by anything that reads it", () => {
    expect(Object.isFrozen(COSTUMES) && Object.isFrozen(COSTUMES[0])).toBe(true);
    for (const list of [SCENES, FRIENDS, FRAMES, GLASSES, BOWS]) expect(Object.isFrozen(list) && Object.isFrozen(list[0])).toBe(true);
  });
});

describe("a look", () => {
  it("starts as a sister with red bunches, skin 3, no costume, at the village window", () => {
    expect(defaultCostumeLook()).toEqual({ sibling: "sister", skin: "s3", hair: "ginger", hairStyle: "bunches", costume: null, scene: "village", friend: null, frame: null, glasses: null, bow: null });
  });

  it("keeps every extra from sign up, and sends a locked costume back to none", () => {
    const all = { ...defaultCostumeLook(), scene: "largs", friend: "robin", frame: "tartan", glasses: "stars-blue", bow: "bow-gold" };
    expect(normaliseCostumeLook(all, NONE)).toEqual(all);
    expect(normaliseCostumeLook({ ...all, costume: "tree" }, NONE).costume).toBeNull();
  });

  it("keeps a costume whose door is done", () => {
    expect(normaliseCostumeLook({ ...defaultCostumeLook(), costume: "tree" }, { doors: [2] }).costume).toBe("tree");
  });

  it("sends anything unknown back to the start", () => {
    expect(normaliseCostumeLook({ scene: "mars", friend: "dragon", frame: "<b>", glasses: "x", bow: 7, skin: "s5" }, NONE)).toEqual({ ...defaultCostumeLook(), skin: "s5" });
  });

  it("turns an old layered look into the start, keeping its sibling, skin and hair", () => {
    const old = { sibling: "brother", skin: "s4", hair: "black", hairStyle: "curly", outfit: "tree", pieces: { hat: ["bobble", "red"] } };
    expect(normaliseCostumeLook(old, NONE)).toEqual({ ...defaultCostumeLook(), sibling: "brother", skin: "s4", hair: "black", hairStyle: "curly" });
  });

  it("never throws, whatever it is given", () => {
    for (const junk of [null, undefined, 7, "x", [], JSON.parse('{"__proto__":{"costume":"tree"}}'), { costume: ["tree"] }]) {
      expect(() => normaliseCostumeLook(junk, NONE)).not.toThrow();
      expect(normaliseCostumeLook(junk, NONE)).toEqual(defaultCostumeLook());
    }
  });

  it("never takes a choice from anywhere but the look itself", () => {
    const inherited = Object.create({ costume: "reindeer", scene: "largs" });
    expect(normaliseCostumeLook(inherited, NONE)).toEqual(defaultCostumeLook());
  });
});

describe("the pictures for a look", () => {
  it("names pictures that exist, for every possible look", () => {
    const seen = new Set<string>();
    const check = (look: Record<string, unknown>) => {
      const p = lookPictures({ ...defaultCostumeLook(), ...look }, ALL);
      for (const path of Object.values(p)) if (path) seen.add(path);
    };
    for (const s of SIBLINGS) for (const k of SKIN_TONES) for (const st of HAIR_STYLES) for (const h of HAIR_COLOURS) check({ sibling: s.id, skin: k.id, hairStyle: st.id, hair: h.id });
    for (const c of COSTUMES) for (const k of SKIN_TONES) for (const g of GLASSES) check({ costume: c.id, skin: k.id, glasses: g.id });
    for (const g of GLASSES) check({ glasses: g.id });
    for (const b of BOWS) check({ bow: b.id });
    for (const sc of SCENES) check({ scene: sc.id });
    for (const f of FRIENDS) check({ friend: f.id });
    expect(seen.size).toBe(150 + 255 + 306 + 6 + 3 + 16 + 6);
    for (const path of seen) expect(existsSync(resolve(PAPER, path)), path).toBe(true);
  });

  it("draws the elf with no costume, at the scene, with glasses, bow tie and friend", () => {
    expect(lookPictures({ ...defaultCostumeLook(), sibling: "brother", skin: "s5", hairStyle: "curly", hair: "black", scene: "ayr", glasses: "specs-red", bow: "bow-green", friend: "robin" }, NONE)).toEqual({
      scene: "scenes/ayr.webp",
      body: "elves/elf-brother-s5-curly-black.webp",
      glasses: "pieces/specs-red.webp",
      bow: "pieces/bow-green.webp",
      friend: "friends/robin.webp",
    });
  });

  it("fits glasses to the costume, and draws no bow tie under one", () => {
    const p = lookPictures({ ...defaultCostumeLook(), costume: "reindeer", glasses: "specs-gold", bow: "bow-red" }, NONE);
    expect(p.body).toBe("costumes/reindeer-s3.webp");
    expect(p.glasses).toBe("pieces/specs-gold--reindeer.webp");
    expect(p.bow).toBeNull();
  });

  it("draws a locked costume as the plain elf", () => {
    expect(lookPictures({ ...defaultCostumeLook(), costume: "santa" }, NONE).body).toBe("elves/elf-sister-s3-bunches-ginger.webp");
  });
});

describe("a look in words", () => {
  it("says what the elf wears, who is with it, where it is and its frame", () => {
    const look = { ...defaultCostumeLook(), costume: "reindeer", glasses: "specs-gold", friend: "robin", scene: "ayr", frame: "candy" };
    expect(costumeLookWords(look, NONE)).toBe("Reindeer costume and gold glasses, with a robin. River Ayr, in a candy cane frame.");
  });

  it("says when there is no costume", () => {
    expect(costumeLookWords({ ...defaultCostumeLook(), bow: "bow-red" }, NONE)).toBe("No costume, red bow tie. Snowy village window.");
    expect(costumeLookWords(defaultCostumeLook(), NONE)).toBe("No costume. Snowy village window.");
  });

  it("says star glasses plainly, keeps a name's capital, and never calls a suit a costume twice", () => {
    expect(costumeLookWords({ ...defaultCostumeLook(), glasses: "stars-blue", bow: "bow-gold", friend: "highlandcalf" }, NONE)).toBe("No costume, blue star glasses and gold bow tie, with a Highland calf. Snowy village window.");
    expect(costumeLookWords({ ...defaultCostumeLook(), costume: "santa" }, ALL)).toBe("Santa suit. Snowy village window.");
  });
});

describe("the doors a detective has done", () => {
  it("counts a door done once, whether cracked or visited", () => {
    expect(doorState({ cracked: [3, 1], visited: [3, 30, 2.5] })).toEqual({ doors: [1, 3] });
  });

  it("counts nothing from a missing list", () => {
    expect(doorState({ cracked: null, visited: undefined })).toEqual({ doors: [] });
  });
});
