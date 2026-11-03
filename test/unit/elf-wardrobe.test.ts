import { describe, it, expect } from "vitest";
import {
  HAIR_COLOURS,
  HAIR_STYLES,
  OUTFITS,
  SIBLINGS,
  SKIN_TONES,
  SLOTS,
  STYLES,
  defaultLook,
  drawElf,
  drawOutfit,
  drawPiece,
  inSentence,
  lookWords,
  newlyUnlocked,
  normaliseLook,
  outfitUnlocked,
  outfitWords,
  pieceUnlocked,
  pieceWords,
  wardrobeState,
} from "../../src/elf/wardrobe";
import { progressOf } from "../../src/elf/progress";

// NBCC Elf Detective School: the elf wardrobe. These tests read the one file the browser also loads
// (assets/js/elf-wardrobe.js) through src/elf/wardrobe.ts, so they hold the real thing: what there
// is to wear, what unlocks with each door, and that a look can never wear what it has not earned or
// carry markup into a drawing.

const EVERYTHING = { doorsDone: 24, goldSeal: true, wonRace: true };
const firstDoor = (styleId: string) => Math.min(...STYLES.find((s) => s.id === styleId)!.colours.map((c) => c.door));

describe("what there is to wear", () => {
  it("has seven slots, and a hat, a top and shoes are always worn", () => {
    expect(SLOTS.map((s) => s.id)).toEqual(["hat", "face", "neck", "top", "feet", "hand", "extra"]);
    expect(SLOTS.filter((s) => !s.optional).map((s) => s.id)).toEqual(["hat", "top", "feet"]);
  });

  it("gives every style a real slot and three colours with their own ids", () => {
    const slots = new Set<string>(SLOTS.map((s) => s.id));
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(STYLES.length);
    for (const style of STYLES) {
      expect(slots.has(style.slot), style.id).toBe(true);
      expect(style.colours.length, style.id).toBe(3);
      expect(new Set(style.colours.map((c) => c.id)).size, style.id).toBe(3);
    }
  });

  it("has 75 things to wear: 25 styles in three colours", () => {
    expect(STYLES.length).toBe(25);
    expect(STYLES.flatMap((s) => s.colours).length).toBe(75);
  });

  it("starts a new elf with an elf hat, a tunic and curly shoes", () => {
    const starters = STYLES.flatMap((s) => s.colours.filter((c) => c.door === 0).map((c) => `${s.id} ${c.id}`));
    expect(starters.sort()).toEqual(["curly maroon", "elf red", "tunic green"]);
  });

  it("unlocks exactly three new things with every door from 1 to 24", () => {
    const perDoor = new Map<number, number>();
    for (const c of STYLES.flatMap((s) => s.colours)) perDoor.set(c.door, (perDoor.get(c.door) ?? 0) + 1);
    for (let door = 1; door <= 24; door++) expect(perDoor.get(door), `door ${door}`).toBe(3);
    expect([...perDoor.keys()].every((d) => d >= 0 && d <= 24)).toBe(true);
  });

  it("brings the big ones with each promotion", () => {
    expect(firstDoor("jumper")).toBe(6);
    expect(firstDoor("badge")).toBe(12);
    expect(firstDoor("coat")).toBe(18);
  });

  it("names everything in plain words, with no dashes and no hyphenated words", () => {
    const names = [
      ...SLOTS.map((s) => s.name),
      ...STYLES.map((s) => s.name),
      ...STYLES.flatMap((s) => s.colours.map((c) => c.name)),
      ...OUTFITS.map((o) => o.name),
      ...HAIR_COLOURS.map((h) => h.name),
      ...HAIR_STYLES.map((h) => h.name),
    ];
    for (const name of names) {
      expect(name.trim()).not.toBe("");
      expect(name).not.toMatch(/[–—]/);
      expect(name).not.toMatch(/[A-Za-z0-9]-[A-Za-z0-9]/);
    }
  });

  it("offers five skin tones, five hair colours and three hair styles", () => {
    expect(SKIN_TONES.length).toBe(5);
    expect(HAIR_COLOURS.length).toBe(5);
    expect(HAIR_STYLES.map((h) => h.id)).toEqual(["short", "bunches", "curly"]);
  });
});

describe("pieces unlocking", () => {
  it("unlocks a colour once enough doors are done", () => {
    expect(pieceUnlocked("elf", "red", { doorsDone: 0 })).toBe(true);
    expect(pieceUnlocked("jumper", "red", { doorsDone: 5 })).toBe(false);
    expect(pieceUnlocked("jumper", "red", { doorsDone: 6 })).toBe(true);
    expect(pieceUnlocked("jumper", "blue", { doorsDone: 6 })).toBe(false);
  });

  it("knows nothing of a style or colour that does not exist", () => {
    expect(pieceUnlocked("cape", "red", EVERYTHING)).toBe(false);
    expect(pieceUnlocked("elf", "purple", EVERYTHING)).toBe(false);
  });

  it("treats a missing or silly count as no doors, so the starter kit is still there", () => {
    for (const silly of [Number.NaN, -3, Number.POSITIVE_INFINITY, undefined, null, "6"]) {
      const state = { doorsDone: silly as unknown as number };
      expect(pieceUnlocked("elf", "red", state), String(silly)).toBe(true);
      expect(pieceUnlocked("mag", "brass", state), String(silly)).toBe(false);
      expect(outfitUnlocked("workshop", state), String(silly)).toBe(true);
      expect(normaliseLook({ outfit: "workshop" }, state).outfit, String(silly)).toBe("workshop");
    }
  });

  it("counts whole doors only, and more than 24 as 24", () => {
    expect(pieceUnlocked("mag", "brass", { doorsDone: 1.9 })).toBe(true);
    expect(pieceUnlocked("stripe", "red", { doorsDone: 1.9 })).toBe(false);
    expect(pieceUnlocked("crown", "gold", { doorsDone: 99 })).toBe(true);
  });
});

describe("outfits", () => {
  it("has eleven: one at sign up, one every three doors, the gold seal and the race", () => {
    expect(OUTFITS.map((o) => [o.id, o.doors ?? o.special])).toEqual([
      ["workshop", 0],
      ["present", 3],
      ["tree", 6],
      ["pudding", 9],
      ["snowman", 12],
      ["ginger", 15],
      ["reindeer", 18],
      ["piper", 21],
      ["grad", 24],
      ["golden", "gold-seal"],
      ["nessie", "race-win"],
    ]);
  });

  it("unlocks by doors done", () => {
    expect(outfitUnlocked("workshop", { doorsDone: 0 })).toBe(true);
    expect(outfitUnlocked("tree", { doorsDone: 5 })).toBe(false);
    expect(outfitUnlocked("tree", { doorsDone: 6 })).toBe(true);
    expect(outfitUnlocked("grad", { doorsDone: 23 })).toBe(false);
    expect(outfitUnlocked("grad", { doorsDone: 24 })).toBe(true);
  });

  it("keeps the golden detective for the gold seal and Nessie for a race win, however many doors are done", () => {
    expect(outfitUnlocked("golden", { doorsDone: 24 })).toBe(false);
    expect(outfitUnlocked("golden", { doorsDone: 24, goldSeal: true })).toBe(true);
    expect(outfitUnlocked("nessie", { doorsDone: 24 })).toBe(false);
    expect(outfitUnlocked("nessie", { doorsDone: 0, wonRace: true })).toBe(true);
  });

  it("takes only a plain true for the gold seal and the race win", () => {
    for (const said of ["false", "true", "0", 1, [], {}]) {
      expect(outfitUnlocked("golden", { doorsDone: 24, goldSeal: said as unknown as boolean }), String(said)).toBe(false);
      expect(outfitUnlocked("nessie", { doorsDone: 24, wonRace: said as unknown as boolean }), String(said)).toBe(false);
    }
  });

  it("knows nothing of an outfit that does not exist", () => {
    expect(outfitUnlocked("robot", EVERYTHING)).toBe(false);
  });
});

describe("what a door unlocks", () => {
  it("lists the three pieces and the outfit that come with the sixth door", () => {
    expect(newlyUnlocked({ doorsDone: 5 }, { doorsDone: 6 })).toEqual({
      pieces: [
        { style: "jumper", colour: "red" },
        { style: "jumper", colour: "green" },
        { style: "boots", colour: "red" },
      ],
      outfits: ["tree"],
    });
  });

  it("lists everything in between when several doors are done at once", () => {
    const got = newlyUnlocked({ doorsDone: 0 }, { doorsDone: 3 });
    expect(got.pieces.length).toBe(9);
    expect(got.outfits).toEqual(["present"]);
  });

  it("lists nothing when nothing has changed", () => {
    expect(newlyUnlocked({ doorsDone: 7 }, { doorsDone: 7 })).toEqual({ pieces: [], outfits: [] });
  });

  it("does not call the starter kit new when the count before was not a number", () => {
    expect(newlyUnlocked({ doorsDone: Number.NaN }, { doorsDone: 0 })).toEqual({ pieces: [], outfits: [] });
  });

  it("lists Nessie when a race is won and the golden detective when the gold seal is earned", () => {
    expect(newlyUnlocked({ doorsDone: 7 }, { doorsDone: 7, wonRace: true })).toEqual({ pieces: [], outfits: ["nessie"] });
    expect(newlyUnlocked({ doorsDone: 24 }, { doorsDone: 24, goldSeal: true }).outfits).toEqual(["golden"]);
  });

  it("words a piece the way people read it", () => {
    expect(pieceWords("deer", "grey")).toBe("Grey detective's hat");
    expect(pieceWords("jumper", "red")).toBe("Red Christmas jumper");
    expect(pieceWords("santa", "blue")).toBe("Blue Santa hat");
    expect(pieceWords("cape", "red")).toBe("");
  });

  it("words an outfit the way people read it", () => {
    expect(outfitWords("tree")).toBe("Christmas tree outfit");
    expect(outfitWords("workshop")).toBe("Workshop elf outfit");
    expect(outfitWords("cape")).toBe("");
  });

  it("drops the capital in the middle of a sentence, except from a name", () => {
    expect(inSentence("Red snow boots")).toBe("red snow boots");
    expect(inSentence("Workshop elf outfit")).toBe("workshop elf outfit");
    expect(inSentence("Christmas tree outfit")).toBe("Christmas tree outfit");
    expect(inSentence("Santa hat")).toBe("Santa hat");
    expect(inSentence("Highland piper outfit")).toBe("Highland piper outfit");
    expect(inSentence("Nessie outfit")).toBe("Nessie outfit");
    expect(inSentence("")).toBe("");
  });
});

describe("what an elf is wearing, in words", () => {
  const SIX = { doorsDone: 6 };
  const dressed = {
    ...defaultLook(),
    pieces: {
      hat: ["deer", "tan"],
      face: ["specs", "black"],
      neck: ["stripe", "red"],
      top: ["jumper", "red"],
      feet: ["boots", "brown"],
      hand: ["mag", "brass"],
      extra: null,
    },
  };

  it("lists the pieces from the hat down, as one sentence", () => {
    expect(lookWords(dressed, SIX)).toBe(
      "Tan detective's hat, black round glasses, red striped scarf, red Christmas jumper, brown snow boots and brass magnifying glass",
    );
    expect(lookWords(defaultLook(), { doorsDone: 0 })).toBe("Red elf hat, green elf tunic and maroon curly shoes");
  });

  it("names the outfit alone when one is worn, since it covers everything else", () => {
    expect(lookWords({ ...dressed, outfit: "tree" }, SIX)).toBe("The Christmas tree outfit");
    expect(lookWords({ ...dressed, outfit: "workshop" }, SIX)).toBe("The workshop elf outfit");
  });

  it("says only what has been earned, so the words always match the drawing", () => {
    expect(lookWords({ ...dressed, outfit: "nessie" }, SIX)).toContain("Tan detective's hat");
    expect(lookWords(dressed, { doorsDone: 0 })).toBe("Red elf hat, green elf tunic and maroon curly shoes");
    expect(lookWords(null, { doorsDone: 0 })).toBe("Red elf hat, green elf tunic and maroon curly shoes");
  });

  it("has no dashes and no hyphenated words, whatever is worn", () => {
    for (const style of STYLES) {
      for (const colour of style.colours) {
        expect(pieceWords(style.id, colour.id)).not.toMatch(/[–—]|[A-Za-z0-9]-[A-Za-z0-9]/);
      }
    }
    for (const outfit of OUTFITS) expect(outfitWords(outfit.id)).not.toMatch(/[–—]|[A-Za-z0-9]-[A-Za-z0-9]/);
  });
});

describe("brother or sister (Jaimie, 3 November 2026)", () => {
  it("offers a sister and a brother", () => {
    expect(SIBLINGS.map((s) => [s.id, s.name])).toEqual([
      ["sister", "Sister"],
      ["brother", "Brother"],
    ]);
  });

  it("keeps the one chosen, and makes anything else a sister", () => {
    expect(normaliseLook({ sibling: "brother" }, { doorsDone: 0 }).sibling).toBe("brother");
    expect(normaliseLook({ sibling: "uncle" }, { doorsDone: 0 }).sibling).toBe("sister");
    expect(normaliseLook({ sibling: ["brother"] }, { doorsDone: 0 }).sibling).toBe("sister");
    expect(normaliseLook({}, { doorsDone: 0 }).sibling).toBe("sister");
  });

  it("opens every hairstyle to both", () => {
    for (const sibling of ["sister", "brother"])
      for (const style of HAIR_STYLES) expect(normaliseLook({ sibling, hairStyle: style.id }, { doorsDone: 0 }).hairStyle).toBe(style.id);
  });
});

describe("a look", () => {
  it("starts with the starter kit and nothing optional", () => {
    expect(defaultLook()).toEqual({
      sibling: "sister",
      skin: "s2",
      hair: "brown",
      hairStyle: "short",
      outfit: null,
      pieces: { hat: ["elf", "red"], face: null, neck: null, top: ["tunic", "green"], feet: ["curly", "maroon"], hand: null, extra: null },
    });
  });

  it("keeps everything that is unlocked", () => {
    const look = {
      sibling: "brother",
      skin: "s5",
      hair: "black",
      hairStyle: "curly",
      outfit: "tree",
      pieces: { hat: ["deer", "tan"], face: ["specs", "black"], neck: ["stripe", "red"], top: ["jumper", "green"], feet: ["boots", "brown"], hand: ["mag", "brass"], extra: null },
    };
    expect(normaliseLook(look, { doorsDone: 6 })).toEqual(look);
  });

  it("puts the starter back for anything locked, unknown or in the wrong slot", () => {
    const look = { pieces: { hat: ["mag", "brass"], top: ["coat", "tan"], feet: ["boots", "pink"], hand: ["torch", "red"], neck: ["stripe", "red"] } };
    expect(normaliseLook(look, { doorsDone: 2 }).pieces).toEqual({
      hat: ["elf", "red"],
      face: null,
      neck: ["stripe", "red"],
      top: ["tunic", "green"],
      feet: ["curly", "maroon"],
      hand: null,
      extra: null,
    });
  });

  it("takes off an outfit that has not been earned", () => {
    expect(normaliseLook({ outfit: "snowman" }, { doorsDone: 11 }).outfit).toBeNull();
    expect(normaliseLook({ outfit: "golden" }, { doorsDone: 24 }).outfit).toBeNull();
    expect(normaliseLook({ outfit: "golden" }, { doorsDone: 24, goldSeal: true }).outfit).toBe("golden");
  });

  it("survives rubbish", () => {
    for (const rubbish of [null, undefined, "elf", 7, [], { pieces: "all of them" }, { skin: 3, hair: {}, hairStyle: [] }]) {
      expect(normaliseLook(rubbish, { doorsDone: 0 })).toEqual(defaultLook());
    }
  });
});

describe("drawing", () => {
  it("draws the elf as one svg", () => {
    const svg = drawElf(defaultLook(), { doorsDone: 0 });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('viewBox="0 0 200 260"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.match(/<svg/g)?.length).toBe(1);
  });

  it("draws every piece in every colour without a gap", () => {
    for (const style of STYLES) {
      for (const colour of style.colours) {
        const look = defaultLook();
        look.pieces[style.slot] = [style.id, colour.id];
        const worn = drawElf(look, EVERYTHING);
        const tile = drawPiece(style.id, colour.id, 40);
        expect(worn, `${style.id} ${colour.id}`).not.toMatch(/undefined|NaN|null/);
        expect(worn.length, `${style.id} ${colour.id}`).toBeGreaterThan(drawElf(defaultLook(), EVERYTHING).length - 1200);
        expect(tile.startsWith("<svg "), `${style.id} ${colour.id}`).toBe(true);
        expect(tile, `${style.id} ${colour.id}`).not.toMatch(/undefined|NaN|null/);
      }
    }
  });

  it("draws every outfit, worn and as a tile", () => {
    for (const outfit of OUTFITS) {
      const worn = drawElf({ ...defaultLook(), outfit: outfit.id }, EVERYTHING);
      expect(worn, outfit.id).not.toMatch(/undefined|NaN|null/);
      expect(worn, outfit.id).not.toBe(drawElf(defaultLook(), EVERYTHING));
      expect(drawOutfit(outfit.id, null, 58).startsWith("<svg "), outfit.id).toBe(true);
    }
  });

  it("changes the drawing with the skin tone, the hair colour and the hair style", () => {
    const base = drawElf(defaultLook(), EVERYTHING);
    expect(drawElf({ ...defaultLook(), skin: "s5" }, EVERYTHING)).not.toBe(base);
    expect(drawElf({ ...defaultLook(), hair: "ginger" }, EVERYTHING)).not.toBe(base);
    expect(drawElf({ ...defaultLook(), hairStyle: "bunches" }, EVERYTHING)).not.toBe(base);
  });

  it("never lets markup in through a look", () => {
    const evil = {
      skin: '"><script>alert(1)</script>',
      hair: "x' onload='alert(1)",
      hairStyle: "<b>",
      outfit: "<svg onload=alert(1)>",
      pieces: { hat: ["elf", 'red"><script>'], top: ["<img>", "tan"], feet: "boots", hand: ["mag", { toString: () => "brass" }] },
    };
    const svg = drawElf(evil, EVERYTHING);
    expect(svg).not.toMatch(/<script|onload|<b>|<img/);
    expect(svg).toBe(drawElf(defaultLook(), EVERYTHING));
  });

  it("reads each part of a look once, so a look that changes as it is read cannot slip through", () => {
    let reads = 0;
    const shifty = {
      get skin() {
        reads += 1;
        return reads === 1 ? "s5" : { toString: () => "<script>" };
      },
    };
    const svg = drawElf(shifty, EVERYTHING);
    expect(svg).not.toMatch(/object Object|<script/);
    expect(svg).toBe(drawElf({ skin: "s5" }, EVERYTHING));
    expect(reads).toBe(1);
  });

  it("does not draw what has not been earned", () => {
    const look = { ...defaultLook(), outfit: "nessie" };
    expect(drawElf(look, { doorsDone: 24 })).toBe(drawElf(defaultLook(), { doorsDone: 24 }));
  });

  it("keeps the size sensible and can leave out the backdrop and the label", () => {
    expect(drawElf(defaultLook(), EVERYTHING, { size: 100 })).toContain('width="100" height="130"');
    expect(drawElf(defaultLook(), EVERYTHING, { size: 1 })).toContain('width="16"');
    expect(drawElf(defaultLook(), EVERYTHING, { size: 99999 })).toContain('width="2000"');
    expect(drawElf(defaultLook(), EVERYTHING)).toContain('role="img"');
    expect(drawElf(defaultLook(), EVERYTHING, { label: false })).toContain('aria-hidden="true"');
    const plain = drawElf(defaultLook(), EVERYTHING, { backdrop: false });
    expect(plain.length).toBeLessThan(drawElf(defaultLook(), EVERYTHING).length);
  });

  it("draws nothing for a piece or an outfit that does not exist", () => {
    expect(drawPiece("cape", "red", 40)).toBe("");
    expect(drawPiece("elf", "purple", 40)).toBe("");
    expect(drawOutfit("robot", null, 58)).toBe("");
  });

  it("draws whatever is worn in every slot, so nothing in the catalogue can go undrawn", () => {
    for (const slot of SLOTS) {
      const styles = STYLES.filter((s) => s.slot === slot.id);
      const drawings = styles.flatMap((style) =>
        style.colours.map((colour) => {
          const look = defaultLook();
          look.pieces[slot.id] = [style.id, colour.id];
          return drawElf(look, EVERYTHING);
        }),
      );
      // Every style in every colour draws differently from every other, and from wearing nothing.
      const bare = defaultLook();
      if (slot.optional) (bare.pieces as Record<string, unknown>)[slot.id] = null;
      const all = slot.optional ? [...drawings, drawElf(bare, EVERYTHING)] : drawings;
      expect(new Set(all).size, slot.id).toBe(all.length);
    }
  });

  it("can say whose elf it is, in words that are made safe", () => {
    const named = drawElf(defaultLook(), EVERYTHING, { label: "Detective Ruby Tinselfoot's elf" });
    expect(named).toContain('aria-label="Detective Ruby Tinselfoot&#39;s elf"');
    const nasty = drawElf(defaultLook(), EVERYTHING, { label: '"><script>alert(1)</script>' });
    expect(nasty).not.toContain("<script");
    expect(nasty.match(/<svg/g)?.length).toBe(1);
  });
});

describe("patterns: the stripes, checks and tartans", () => {
  const ids = (svg: string) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const refs = (svg: string) => [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  const pieceTiles = () => STYLES.flatMap((s) => s.colours.map((c) => drawPiece(s.id, c.id, 40)));
  const outfitTiles = () => OUTFITS.map((o) => drawOutfit(o.id, null, 58));
  const worn = () =>
    STYLES.flatMap((s) =>
      s.colours.map((c) => {
        const look = defaultLook();
        look.pieces[s.slot] = [s.id, c.id];
        return drawElf(look, EVERYTHING);
      }),
    );

  it("defines every pattern a drawing uses, and none that it does not", () => {
    for (const svg of [...pieceTiles(), ...outfitTiles(), ...worn()]) {
      expect(new Set(ids(svg))).toEqual(new Set(refs(svg)));
    }
  });

  it("gives every tile ids of its own, so a whole wardrobe can sit on one page", () => {
    const all = [...pieceTiles(), ...outfitTiles()].flatMap(ids);
    expect(all.length).toBeGreaterThan(10);
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives an elf ids from its key, so several elves can sit on one page", () => {
    const ruby = drawElf(defaultLook(), EVERYTHING, { key: "ruby" });
    const sam = drawElf(defaultLook(), EVERYTHING, { key: "sam" });
    expect(ids(ruby).length).toBeGreaterThan(0);
    expect(ids(ruby).every((id) => id.endsWith("-ruby"))).toBe(true);
    expect(ids(ruby).filter((id) => ids(sam).includes(id))).toEqual([]);
  });

  it("keeps a key to plain characters", () => {
    const svg = drawElf(defaultLook(), EVERYTHING, { key: '"><script>x' });
    expect(svg).not.toContain("<script");
    expect(ids(svg).every((id) => /^[A-Za-z0-9_-]+$/.test(id))).toBe(true);
  });

  it("draws the same elf the same way every time", () => {
    expect(drawElf(defaultLook(), EVERYTHING)).toBe(drawElf(defaultLook(), EVERYTHING));
  });
});

describe("hair that can be seen", () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

  it("gives every hair colour an edge that stands out from every skin tone", () => {
    // Brown hair on a brown face is nearly one colour. The edge is what shows the hair is there.
    for (const hair of HAIR_COLOURS) {
      for (const skin of SKIN_TONES) {
        expect(distance(hair.dark, skin.hex), `${hair.id} hair on ${skin.id}`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("draws that edge round the hair, in every style", () => {
    for (const hair of HAIR_COLOURS) {
      for (const style of HAIR_STYLES) {
        const svg = drawElf({ ...defaultLook(), hair: hair.id, hairStyle: style.id }, EVERYTHING);
        expect(svg, `${style.id} ${hair.id}`).toContain(`stroke="${hair.dark}"`);
      }
    }
  });
});

describe("the catalogue", () => {
  it("cannot be changed by anything that reads it", () => {
    expect(Object.isFrozen(STYLES)).toBe(true);
    expect(Object.isFrozen(STYLES[0].colours[0])).toBe(true);
    expect(Object.isFrozen(OUTFITS[0])).toBe(true);
    expect(() => {
      (STYLES.find((s) => s.id === "crown")!.colours[2] as { door: number }).door = 0;
    }).toThrow();
    expect(pieceUnlocked("crown", "gold", { doorsDone: 0 })).toBe(false);
  });
});

describe("what a detective has earned, for the wardrobe", () => {
  it("is built from their progress in one place, so it can never be text by mistake", () => {
    const progress = progressOf({ cracked: [1, 2, 3], visited: [3, 4] });
    expect(wardrobeState(progress, false)).toEqual({ doorsDone: 4, goldSeal: false, wonRace: false });
    const all = progressOf({ cracked: [], visited: Array.from({ length: 24 }, (_, i) => i + 1) });
    expect(wardrobeState(all, true)).toEqual({ doorsDone: 24, goldSeal: true, wonRace: true });
    expect(wardrobeState(progress, "yes" as unknown as boolean).wonRace).toBe(false);
  });
});

describe("the drawing style, matched to the school's logo (Jaimie, 3 November 2026)", () => {
  const INK_LINE = 'stroke="#4A2A1E" stroke-width="3"';

  it("outlines the whole elf, every outfit and every piece in the logo's dark brown", () => {
    expect(drawElf(defaultLook(), { doorsDone: 0 })).toContain(INK_LINE);
    for (const outfit of OUTFITS) expect(drawOutfit(outfit.id, defaultLook(), 58), outfit.id).toContain(INK_LINE);
    for (const style of STYLES) expect(drawPiece(style.id, style.colours[0].id, 40), style.id).toContain(INK_LINE);
  });

  it("keeps the pale circle behind the elf free of the outline", () => {
    const svg = drawElf(defaultLook(), { doorsDone: 0 });
    expect(svg.indexOf('fill="#EAF0E7"')).toBeLessThan(svg.indexOf(INK_LINE));
  });

  it("gives the starter elf hat a fluffy brim, not a flat band", () => {
    const hat = drawPiece("elf", "red", 40);
    expect(hat).toMatch(/a[\d.]+ [\d.]+ 0 0 1 [\d.]+ 0/);
  });
});
