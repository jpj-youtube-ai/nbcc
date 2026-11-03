import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  layersFor,
  lookWords,
  newlyUnlocked,
  normaliseLook,
  outfitUnlocked,
  outfitWords,
  pieceUnlocked,
  pieceWords,
  usePaint,
  wardrobeState,
} from "../../src/elf/wardrobe";
import { createRequire } from "node:module";
import { progressOf } from "../../src/elf/progress";
import { PAINT_FIXTURE, paintWithout } from "./elf-paint-fixture";

const PAINT = createRequire(import.meta.url)("../../assets/js/elf-paint.js") as { layers: Record<string, unknown> };

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

// The elf and every piece are paintings, stacked as layers (docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md).
// These tests stack a made up list of layers, one for everything in the catalogue, so they hold
// the drawing whatever has been painted so far. The real list is checked for completeness below.
const hrefs = (svg: string) => [...svg.matchAll(/<image href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.endsWith(".cover.webp"));
const ids = (svg: string) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const without = paintWithout;
const sm = (name: string) => `/assets/img/elf/sm/${name}.webp`;

describe("drawing from the painted layers", () => {
  beforeEach(() => usePaint(PAINT_FIXTURE));
  afterEach(() => usePaint(null));

  it("draws the elf as one svg of the canvas, 1.3 times as tall as it is wide", () => {
    const svg = drawElf(defaultLook(), { doorsDone: 0 }, { size: 100 });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('viewBox="-79 0 1182 1536"');
    expect(svg).toContain('width="100" height="130"');
    expect(svg.match(/<svg/g)?.length).toBe(1);
  });

  it("stacks one picture for each thing worn, in layer order", () => {
    const look = { ...defaultLook(), pieces: { hat: ["bobble", "red"], face: ["specs", "black"], neck: ["stripe", "red"], top: ["jumper", "red"], feet: ["boots", "brown"], hand: ["mag", "brass"], extra: ["badge", "gold"] } };
    const order = ["elf-sister-s2-short-brown", "piece-boots-brown", "piece-jumper-red", "piece-badge-gold", "piece-specs-black", "piece-stripe-red", "piece-bobble-red", "piece-mag-brass"];
    expect(hrefs(drawElf(look, EVERYTHING))).toEqual(order.map(sm));
    expect(layersFor(look, EVERYTHING).map((l: { name: string }) => l.name)).toEqual(order);
  });

  it("draws only the elf and the outfit when an outfit is on", () => {
    expect(hrefs(drawElf({ ...defaultLook(), outfit: "tree" }, EVERYTHING))).toEqual([sm("elf-sister-s2-short-brown"), sm("outfit-tree")]);
  });

  it("uses the large pictures for print, and the small ones for screens", () => {
    expect(hrefs(drawElf(defaultLook(), EVERYTHING, { set: "lg" }))[0]).toBe("/assets/img/elf/lg/elf-sister-s2-short-brown.webp");
    expect(hrefs(drawElf(defaultLook(), EVERYTHING, { set: "nonsense" as "sm" }))[0]).toBe(sm("elf-sister-s2-short-brown"));
  });

  it("paints the elf chosen: brother or sister, skin, hair colour and hairstyle", () => {
    const look = { ...defaultLook(), sibling: "brother", skin: "s5", hair: "black", hairStyle: "curly" };
    expect(hrefs(drawElf(look, EVERYTHING))[0]).toBe(sm("elf-brother-s5-curly-black"));
  });

  it("hides the elf's own mitten under a gadget, and nothing without one", () => {
    const holding = drawElf({ ...defaultLook(), pieces: { ...defaultLook().pieces, hand: ["mag", "brass"] } }, EVERYTHING, { key: "a" });
    expect(holding).toContain('<mask id="m-a"');
    expect(holding).toContain('href="/assets/img/elf/sm/piece-mag-brass.cover.webp"');
    expect(holding).toMatch(/<image href="\/assets\/img\/elf\/sm\/elf-[^"]+" [^>]*mask="url\(#m-a\)"/);
    expect(drawElf(defaultLook(), EVERYTHING, { key: "a" })).not.toContain("<mask");
  });

  it("keeps each drawing's mask its own when several share a page, and its key plain", () => {
    const look = { ...defaultLook(), pieces: { ...defaultLook().pieces, hand: ["mag", "brass"] } };
    expect(ids(drawElf(look, EVERYTHING, { key: "a" }))).toEqual(["m-a"]);
    expect(ids(drawElf(look, EVERYTHING, { key: "b" }))).toEqual(["m-b"]);
    const odd = drawElf(look, EVERYTHING, { key: '"><script>x' });
    expect(odd).not.toContain("<script");
    expect(ids(odd).every((id) => /^m-[A-Za-z0-9_-]+$/.test(id))).toBe(true);
    expect(ids(drawElf(look, EVERYTHING))[0]).toMatch(/^m-e[0-9a-z]+$/);
  });

  it("leaves out a piece that has not been painted, and still draws the elf", () => {
    usePaint(without("piece-bobble-red"));
    const svg = drawElf({ ...defaultLook(), pieces: { ...defaultLook().pieces, hat: ["bobble", "red"] } }, EVERYTHING);
    expect(hrefs(svg)).toEqual([sm("elf-sister-s2-short-brown"), sm("piece-curly-maroon"), sm("piece-tunic-green")]);
  });

  it("falls back to the first elf when the one chosen has not been painted, and draws no broken picture when none has", () => {
    usePaint(without("elf-brother-s5-curly-black"));
    expect(hrefs(drawElf({ ...defaultLook(), sibling: "brother", skin: "s5", hair: "black", hairStyle: "curly" }, EVERYTHING))[0]).toBe(sm("elf-sister-s2-short-brown"));
    usePaint({ canvas: PAINT_FIXTURE.canvas, layers: {} });
    const empty = drawElf(defaultLook(), EVERYTHING);
    expect(hrefs(empty)).toEqual([]);
    expect(empty.startsWith("<svg ")).toBe(true);
  });

  it("never lets markup in through a look", () => {
    const evil = {
      sibling: "<i>",
      skin: '"><script>alert(1)</script>',
      hair: "x' onload='alert(1)",
      hairStyle: "<b>",
      outfit: "<svg onload=alert(1)>",
      pieces: { hat: ["elf", 'red"><script>'], top: ["<img>", "tan"], feet: "boots", hand: ["mag", { toString: () => "brass" }] },
    };
    const svg = drawElf(evil, EVERYTHING);
    expect(svg).not.toMatch(/<script|onload|<b>|<img|<i>/);
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
    expect(drawElf({ ...defaultLook(), outfit: "nessie" }, { doorsDone: 24 })).toBe(drawElf(defaultLook(), { doorsDone: 24 }));
  });

  it("keeps the size sensible and can leave out the backdrop and the label", () => {
    expect(drawElf(defaultLook(), EVERYTHING, { size: 1 })).toContain('width="16"');
    expect(drawElf(defaultLook(), EVERYTHING, { size: 99999 })).toContain('width="2000"');
    expect(drawElf(defaultLook(), EVERYTHING)).toContain('role="img"');
    expect(drawElf(defaultLook(), EVERYTHING, { label: false })).toContain('aria-hidden="true"');
    expect(drawElf(defaultLook(), EVERYTHING, { backdrop: false }).length).toBeLessThan(drawElf(defaultLook(), EVERYTHING).length);
  });

  it("can say whose elf it is, in words that are made safe", () => {
    expect(drawElf(defaultLook(), EVERYTHING, { label: "Detective Ruby Tinselfoot's elf" })).toContain('aria-label="Detective Ruby Tinselfoot&#39;s elf"');
    const nasty = drawElf(defaultLook(), EVERYTHING, { label: '"><script>alert(1)</script>' });
    expect(nasty).not.toContain("<script");
    expect(nasty.match(/<svg/g)?.length).toBe(1);
  });

  it("shows a piece's tile as one small picture that loads only when it is near", () => {
    expect(drawPiece("bobble", "red", 56)).toBe('<img src="/assets/img/elf/tile/piece-bobble-red.webp" width="56" height="42" alt="" loading="lazy" decoding="async" />');
    expect(drawPiece("cape", "red", 40)).toBe("");
    expect(drawPiece("elf", "purple", 40)).toBe("");
    usePaint(without("piece-bobble-red"));
    expect(drawPiece("bobble", "red", 56)).toBe("");
  });

  it("shows an outfit's tile on this elf, from the tile pictures", () => {
    const tile = drawOutfit("reindeer", { ...defaultLook(), skin: "s4" }, 72);
    expect(hrefs(tile)).toEqual(["/assets/img/elf/tile/elf-sister-s4-short-brown.webp", "/assets/img/elf/tile/outfit-reindeer.webp"]);
    expect(tile).toContain('width="72" height="94"');
    expect(tile).toContain('aria-hidden="true"');
    expect(drawOutfit("robot", null, 58)).toBe("");
  });

  it("draws every piece in every colour differently from every other, and from wearing nothing", () => {
    for (const slot of SLOTS) {
      const drawings = STYLES.filter((s) => s.slot === slot.id).flatMap((style) =>
        style.colours.map((colour) => {
          const look = defaultLook();
          look.pieces[slot.id] = [style.id, colour.id];
          return drawElf(look, EVERYTHING);
        }),
      );
      const bare = defaultLook();
      if (slot.optional) (bare.pieces as Record<string, unknown>)[slot.id] = null;
      const all = slot.optional ? [...drawings, drawElf(bare, EVERYTHING)] : drawings;
      expect(new Set(all).size, slot.id).toBe(all.length);
    }
  });

  it("draws the same elf the same way every time", () => {
    expect(drawElf(defaultLook(), EVERYTHING)).toBe(drawElf(defaultLook(), EVERYTHING));
  });
});

describe("the painted layers on the site", () => {
  // Switched on at the end of the painting (plan Task 8), when every elf, piece and outfit is painted.
  it.skip("has a picture for every sibling, skin, hairstyle, hair colour, style colour and outfit", () => {
    const missing = Object.keys(PAINT_FIXTURE.layers).filter((name) => !(name in PAINT.layers));
    expect(missing).toEqual([]);
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
