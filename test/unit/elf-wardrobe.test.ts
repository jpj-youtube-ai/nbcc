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
  costumeUnlocked,
  defaultLook,
  lookPictures,
  lookWords,
  normaliseFavourites,
  normaliseLook,
  wardrobeState,
} from "../../src/elf/wardrobe";

// NBCC Elf Detective School: the paper wardrobe (docs/superpowers/specs/2026-11-04-elf-paper-design.md).
// These tests read the one file the browser also loads (assets/js/elf-wardrobe.js) through
// src/elf/wardrobe.ts, so they hold the real thing: 51 whole costumes, three from the start and two for
// each door a detective does; extras (scenes, friends, frames, glasses, bow ties) all there from sign
// up; and a look that can never wear what it has not unlocked or carry anything typed into a picture.
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
});

describe("who the elf is", () => {
  it("offers five skin tones, five hair colours and three hair styles", () => {
    expect(SKIN_TONES.length).toBe(5);
    expect(HAIR_COLOURS.length).toBe(5);
    expect(HAIR_STYLES.map((h) => h.id)).toEqual(["short", "bunches", "curly"]);
  });

  it("offers a girl and a boy (Jaimie, 3 November 2026)", () => {
    expect(SIBLINGS.map((s) => [s.id, s.name])).toEqual([
      ["sister", "Girl"],
      ["brother", "Boy"],
    ]);
  });

  it("keeps the one chosen, and makes anything else a sister", () => {
    expect(normaliseLook({ sibling: "brother" }, NONE).sibling).toBe("brother");
    expect(normaliseLook({ sibling: "uncle" }, NONE).sibling).toBe("sister");
    expect(normaliseLook({ sibling: ["brother"] }, NONE).sibling).toBe("sister");
    expect(normaliseLook({}, NONE).sibling).toBe("sister");
  });

  it("opens every hairstyle to both", () => {
    for (const sibling of ["sister", "brother"])
      for (const style of HAIR_STYLES) expect(normaliseLook({ sibling, hairStyle: style.id }, NONE).hairStyle).toBe(style.id);
  });
});

describe("hair that can be seen", () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

  it("gives every hair colour an edge that stands out from every skin tone", () => {
    // Kept for the hair swatches on the wardrobe page, which are drawn with this edge.
    for (const hair of HAIR_COLOURS) {
      for (const skin of SKIN_TONES) {
        expect(distance(hair.dark, skin.hex), `${hair.id} hair on ${skin.id}`).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

describe("the names", () => {
  it("names everything in plain words, with no dashes and no hyphenated words", () => {
    const names = [COSTUMES, SCENES, FRIENDS, FRAMES, GLASSES, BOWS, HAIR_COLOURS, HAIR_STYLES, SIBLINGS].flatMap((list) => list.map((item) => item.name));
    for (const name of names) {
      expect(name.trim()).not.toBe("");
      expect(name).not.toMatch(/[–—]/);
      expect(name).not.toMatch(/[A-Za-z0-9]-[A-Za-z0-9]/);
    }
  });
});

describe("a look", () => {
  it("starts as a sister with red bunches, skin 3, no costume, at the village window", () => {
    expect(defaultLook()).toEqual({ sibling: "sister", skin: "s3", hair: "ginger", hairStyle: "bunches", costume: null, scene: "village", friend: null, frame: null, glasses: null, bow: null });
  });

  it("keeps every extra from sign up, and sends a locked costume back to none", () => {
    const all = { ...defaultLook(), scene: "largs", friend: "robin", frame: "tartan", glasses: "stars-blue", bow: "bow-gold" };
    expect(normaliseLook(all, NONE)).toEqual(all);
    expect(normaliseLook({ ...all, costume: "tree" }, NONE).costume).toBeNull();
  });

  it("keeps a costume whose door is done", () => {
    expect(normaliseLook({ ...defaultLook(), costume: "tree" }, { doors: [2] }).costume).toBe("tree");
  });

  it("sends anything unknown back to the start", () => {
    expect(normaliseLook({ scene: "mars", friend: "dragon", frame: "<b>", glasses: "x", bow: 7, skin: "s5" }, NONE)).toEqual({ ...defaultLook(), skin: "s5" });
  });

  it("turns an old layered look into the start, keeping its sibling, skin and hair", () => {
    const old = { sibling: "brother", skin: "s4", hair: "black", hairStyle: "curly", outfit: "tree", pieces: { hat: ["bobble", "red"] } };
    expect(normaliseLook(old, NONE)).toEqual({ ...defaultLook(), sibling: "brother", skin: "s4", hair: "black", hairStyle: "curly" });
  });

  it("never throws, whatever it is given", () => {
    for (const junk of [null, undefined, 7, "x", [], JSON.parse('{"__proto__":{"costume":"tree"}}'), { costume: ["tree"] }]) {
      expect(() => normaliseLook(junk, NONE)).not.toThrow();
      expect(normaliseLook(junk, NONE)).toEqual(defaultLook());
    }
  });

  it("never takes a choice from anywhere but the look itself", () => {
    const inherited = Object.create({ costume: "reindeer", scene: "largs" });
    expect(normaliseLook(inherited, NONE)).toEqual(defaultLook());
  });

  it("reads each part of a look once, so a look that changes as it is read cannot slip through", () => {
    let reads = 0;
    const shifty = {
      get skin() {
        reads += 1;
        return reads === 1 ? "s5" : { toString: () => "<script>" };
      },
    };
    expect(normaliseLook(shifty, NONE)).toEqual({ ...defaultLook(), skin: "s5" });
    expect(reads).toBe(1);
  });
});

describe("the pictures for a look", () => {
  it("names pictures that exist, for every possible look", () => {
    const seen = new Set<string>();
    const check = (look: Record<string, unknown>) => {
      const p = lookPictures({ ...defaultLook(), ...look }, ALL);
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
    expect(lookPictures({ ...defaultLook(), sibling: "brother", skin: "s5", hairStyle: "curly", hair: "black", scene: "ayr", glasses: "specs-red", bow: "bow-green", friend: "robin" }, NONE)).toEqual({
      scene: "scenes/ayr.webp",
      body: "elves/elf-brother-s5-curly-black.webp",
      glasses: "pieces/specs-red.webp",
      bow: "pieces/bow-green.webp",
      friend: "friends/robin.webp",
    });
  });

  it("fits glasses to the costume, and draws no bow tie under one", () => {
    const p = lookPictures({ ...defaultLook(), costume: "reindeer", glasses: "specs-gold", bow: "bow-red" }, NONE);
    expect(p.body).toBe("costumes/reindeer-s3.webp");
    expect(p.glasses).toBe("pieces/specs-gold--reindeer.webp");
    expect(p.bow).toBeNull();
  });

  it("draws a locked costume as the plain elf", () => {
    expect(lookPictures({ ...defaultLook(), costume: "santa" }, NONE).body).toBe("elves/elf-sister-s3-bunches-ginger.webp");
  });
});

describe("a look in words", () => {
  it("says what the elf wears, who is with it, where it is and its frame", () => {
    const look = { ...defaultLook(), costume: "reindeer", glasses: "specs-gold", friend: "robin", scene: "ayr", frame: "candy" };
    expect(lookWords(look, NONE)).toBe("Reindeer costume and gold glasses, with a robin. River Ayr, in a candy cane frame.");
  });

  it("says when there is no costume", () => {
    expect(lookWords({ ...defaultLook(), bow: "bow-red" }, NONE)).toBe("No costume, red bow tie. Snowy village window.");
    expect(lookWords(defaultLook(), NONE)).toBe("No costume. Snowy village window.");
  });

  it("says star glasses plainly, keeps a name's capital, and never calls a suit a costume twice", () => {
    expect(lookWords({ ...defaultLook(), glasses: "stars-blue", bow: "bow-gold", friend: "highlandcalf" }, NONE)).toBe("No costume, blue star glasses and gold bow tie, with a Highland calf. Snowy village window.");
    expect(lookWords({ ...defaultLook(), costume: "santa" }, ALL)).toBe("Santa suit. Snowy village window.");
  });

  it("says only what is unlocked, so the words always match the picture", () => {
    expect(lookWords({ ...defaultLook(), costume: "santa" }, NONE)).toBe("No costume. Snowy village window.");
  });
});

describe("favourite looks", () => {
  const a = { ...defaultLook(), scene: "largs" };
  const b = { ...defaultLook(), costume: "tree", scene: "loch" };
  const c = { ...defaultLook(), friend: "robin" };
  const d = { ...defaultLook(), glasses: "specs-gold" };

  it("keeps three at most, in the order sent, each made safe and each once", () => {
    expect(normaliseFavourites([a, 7, null, [], "x", a, b, c, d], NONE)).toEqual([a, { ...defaultLook(), scene: "loch" }, c]);
  });

  it("counts a look made safe as a repeat of the same look", () => {
    expect(normaliseFavourites([{ ...a, costume: "tree" }, a], NONE)).toEqual([a]);
  });

  it("is none for anything that is not a list", () => {
    for (const junk of [null, undefined, "x", {}, 7]) expect(normaliseFavourites(junk, NONE)).toEqual([]);
  });
});

describe("the catalogue", () => {
  it("cannot be changed by anything that reads it", () => {
    for (const list of [COSTUMES, SCENES, FRIENDS, FRAMES, GLASSES, BOWS]) expect(Object.isFrozen(list) && Object.isFrozen(list[0])).toBe(true);
    expect(() => {
      (COSTUMES.find((c) => c.id === "santa") as { door: number }).door = 0;
    }).toThrow();
    expect(costumeUnlocked("santa", NONE)).toBe(false);
  });
});

describe("the doors a detective has done, for the wardrobe", () => {
  it("counts a door done once, whether cracked or visited, in order", () => {
    expect(wardrobeState({ cracked: [1, 2, 3], visited: [3, 4] })).toEqual({ doors: [1, 2, 3, 4] });
    expect(wardrobeState({ cracked: [3, 1], visited: [3, 30, 2.5] })).toEqual({ doors: [1, 3] });
  });

  it("counts nothing from a missing list", () => {
    expect(wardrobeState({ cracked: null, visited: undefined })).toEqual({ doors: [] });
  });
});
