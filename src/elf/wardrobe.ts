import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Progress } from "./progress";

// NBCC Elf Detective School: the elf wardrobe, as the server sees it. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decisions 14 and 15).
//
// The wardrobe itself (what there is to wear, how many doors unlock each thing, and which painted
// layers draw a look: docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md) lives in ONE
// file that the browser also loads: assets/js/elf-wardrobe.js. The
// server reads that same file, the way src/fundraising/signers.ts reads the admin's list of signers,
// so the two can never disagree about what a detective may wear or how their elf looks. It ships
// with the app, next to the pages. It is read when this module is first loaded: if the file were
// missing the app would not start, which is the right failure for a file every elf screen needs.
//
// This module adds the types, and one function, wardrobeState, that turns a detective's progress
// into what the wardrobe needs to know. Everything in it is pure once the file is read.
// Unit tested in test/unit/elf-wardrobe.test.ts.

export type SlotId = "hat" | "face" | "neck" | "top" | "feet" | "hand" | "extra";

export interface WardrobeSlot {
  readonly id: SlotId;
  /** The heading people read: "Hats". */
  readonly name: string;
  /** Can this slot be left empty? Hat, top and shoes cannot. */
  readonly optional: boolean;
}

export interface WardrobeColour {
  readonly id: string;
  /** The word people read: "Red". */
  readonly name: string;
  /** How many doors done unlock it. 0 is the starter kit. */
  readonly door: number;
  readonly fill: string;
  readonly dark: string;
}

export interface WardrobeStyle {
  readonly id: string;
  readonly slot: SlotId;
  /** The words people read: "Detective's hat". */
  readonly name: string;
  /** The crop for a wardrobe tile, as an SVG viewBox. */
  readonly box: string;
  readonly colours: readonly WardrobeColour[];
}

export interface WardrobeOutfit {
  readonly id: string;
  readonly name: string;
  /** How many doors done unlock it, for the outfits that come with doors. */
  readonly doors?: number;
  /** The other way in: the gold seal, or winning a race. */
  readonly special?: "gold-seal" | "race-win";
}

/** A hair colour: its fill, and the darker edge drawn round it so it shows against any skin. */
export interface HairColour {
  readonly id: string;
  /** The word people read: "Red" (Jaimie, 3 November 2026: "use the word red or auburn"; the id stays "ginger" so saved looks keep it). */
  readonly name: string;
  readonly hex: string;
  readonly dark: string;
}

/** A piece being worn: the style and the colour. */
export type PieceChoice = [style: string, colour: string];

/** What is worn in each slot. A hat, a top and shoes are always worn. */
export interface ElfPieces {
  hat: PieceChoice;
  top: PieceChoice;
  feet: PieceChoice;
  face: PieceChoice | null;
  neck: PieceChoice | null;
  hand: PieceChoice | null;
  extra: PieceChoice | null;
}

export interface ElfLook {
  /** "sister" or "brother": which of the logo elf's family this is. */
  sibling: string;
  skin: string;
  hair: string;
  hairStyle: string;
  /** A whole costume, or null to wear the pieces. */
  outfit: string | null;
  pieces: ElfPieces;
}

/** What a detective has earned, as far as the wardrobe cares. Build it with wardrobeState. */
export interface WardrobeState {
  /** A NUMBER. Text such as "6" counts as no doors at all, and the starter kit is all that is left. */
  doorsDone: number;
  goldSeal?: boolean;
  wonRace?: boolean;
}

export interface Unlocks {
  pieces: { style: string; colour: string }[];
  outfits: string[];
}

export interface DrawOptions {
  /** Width in pixels; the height follows. */
  size?: number;
  /** The pale circle behind the elf. On unless false. */
  backdrop?: boolean;
  /** The words a screen reader says, such as whose elf it is. False for an elf that is decoration. */
  label?: string | false;
  /** A short name that is this drawing's alone on the page. Give one whenever several elves are put
   *  into one page, so that their masks keep apart. */
  key?: string;
  /** Which painted pictures: "sm" for screens (the default), "lg" for print. */
  set?: "sm" | "lg";
}

/** A place on the painted canvas (1024 by 1536). */
export interface PaintBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One painted layer of a drawing: its name (the file is assets/img/elf/<size>/<name>.webp), its
 *  place, and the part of the elf it hides, if any. */
export interface PaintLayer extends PaintBox {
  name: string;
  cover: PaintBox | null;
}

/** The list of painted layers, as assets/js/elf-paint.js holds it. */
export interface PaintManifest {
  canvas: { w: number; h: number; view: number[] };
  layers: Record<string, PaintBox & { cover?: PaintBox }>;
}

interface WardrobeApi {
  DOORS: number;
  SIBLINGS: readonly { readonly id: string; readonly name: string }[];
  SKIN_TONES: readonly { readonly id: string; readonly hex: string }[];
  HAIR_COLOURS: readonly HairColour[];
  HAIR_STYLES: readonly { readonly id: string; readonly name: string }[];
  SLOTS: readonly WardrobeSlot[];
  STYLES: readonly WardrobeStyle[];
  OUTFITS: readonly WardrobeOutfit[];
  pieceUnlocked(styleId: string, colourId: string, state: WardrobeState): boolean;
  outfitUnlocked(outfitId: string, state: WardrobeState): boolean;
  newlyUnlocked(before: WardrobeState, after: WardrobeState): Unlocks;
  pieceWords(styleId: string, colourId: string): string;
  outfitWords(outfitId: string): string;
  inSentence(words: string): string;
  lookWords(look: unknown, state: WardrobeState): string;
  defaultLook(): ElfLook;
  normaliseLook(look: unknown, state: WardrobeState): ElfLook;
  drawElf(look: unknown, state: WardrobeState, opts?: DrawOptions): string;
  drawPiece(styleId: string, colourId: string, size?: number): string;
  drawOutfit(outfitId: string, look: unknown, size?: number): string;
  layersFor(look: unknown, state: WardrobeState): PaintLayer[];
  usePaint(manifest: PaintManifest | null): void;
}

const SCRIPT = resolve(__dirname, "../../assets/js/elf-wardrobe.js");
const api = createRequire(SCRIPT)(SCRIPT) as WardrobeApi;

export const SIBLINGS = api.SIBLINGS;
export const SKIN_TONES = api.SKIN_TONES;
export const HAIR_COLOURS = api.HAIR_COLOURS;
export const HAIR_STYLES = api.HAIR_STYLES;
export const SLOTS = api.SLOTS;
export const STYLES = api.STYLES;
export const OUTFITS = api.OUTFITS;

/** Can this detective wear this colour of this style? */
export const pieceUnlocked = api.pieceUnlocked;
/** Can this detective wear this outfit? */
export const outfitUnlocked = api.outfitUnlocked;
/** Everything that unlocks going from one state to another. */
export const newlyUnlocked = api.newlyUnlocked;
/** The words for a piece: "Grey detective's hat". */
export const pieceWords = api.pieceWords;
/** The words for an outfit: "Christmas tree outfit". */
export const outfitWords = api.outfitWords;
/** Words as they read in the middle of a sentence: a name keeps its capital, nothing else does. */
export const inSentence = api.inSentence;
/** What a look is wearing, as one line. The look is made safe first, so the words match the drawing. */
export const lookWords = api.lookWords;
/** What a brand new detective's elf wears. */
export const defaultLook = api.defaultLook;
/** A look made safe to keep and to draw: anything unknown or still locked falls back to the starter kit. */
export const normaliseLook = api.normaliseLook;
/** The whole elf as an SVG string. The look is made safe first. */
export const drawElf = api.drawElf;
/** One piece on its own, for a wardrobe tile. */
export const drawPiece = api.drawPiece;
/** One outfit on a plain elf, for a wardrobe tile. */
export const drawOutfit = api.drawOutfit;
/** The painted layers a look is drawn from, bottom to top: the browser and the server stack the same ones. */
export const layersFor = api.layersFor;
/** For tests only: draw from another list of layers, or null to go back to the real one. */
export const usePaint = api.usePaint;

/**
 * What a detective has earned, built from their progress. Always build a WardrobeState here.
 *
 * A wrong state fails shut and says nothing: hand normaliseLook a count of doors as text and it sees
 * no doors, so a saved outfit quietly becomes the starter kit. Building the state in one typed place
 * from progressOf is what stops that.
 */
export function wardrobeState(progress: Pick<Progress, "doorsDone" | "goldSeal">, wonRace: boolean): WardrobeState {
  return { doorsDone: progress.doorsDone, goldSeal: progress.goldSeal === true, wonRace: wonRace === true };
}
