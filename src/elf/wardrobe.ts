import { createRequire } from "node:module";
import { resolve } from "node:path";

// NBCC Elf Detective School: the elf wardrobe, as the server sees it. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decisions 14 and 15).
//
// The wardrobe itself (what there is to wear, how many doors unlock each thing, and how every piece
// and outfit is drawn) lives in ONE file that the browser also loads: assets/js/elf-wardrobe.js. The
// server reads that same file, the way src/fundraising/signers.ts reads the admin's list of signers,
// so the two can never disagree about what a detective may wear or how their elf looks. It ships
// with the app, next to the pages.
//
// This module adds the types and nothing else. Everything in it is pure once the file is read.
// Unit tested in test/unit/elf-wardrobe.test.ts.

export type SlotId = "hat" | "face" | "neck" | "top" | "feet" | "hand" | "extra";

export interface WardrobeSlot {
  id: SlotId;
  /** The heading people read: "Hats". */
  name: string;
  /** Can this slot be left empty? Hat, top and shoes cannot. */
  optional: boolean;
}

export interface WardrobeColour {
  id: string;
  /** The word people read: "Red". */
  name: string;
  /** How many doors done unlock it. 0 is the starter kit. */
  door: number;
  fill: string;
  dark: string;
}

export interface WardrobeStyle {
  id: string;
  slot: SlotId;
  /** The words people read: "Detective's hat". */
  name: string;
  /** The crop for a wardrobe tile, as an SVG viewBox. */
  box: string;
  colours: WardrobeColour[];
}

export interface WardrobeOutfit {
  id: string;
  name: string;
  /** How many doors done unlock it, for the outfits that come with doors. */
  doors?: number;
  /** The other way in: the gold seal, or winning a race. */
  special?: "gold-seal" | "race-win";
}

/** A piece being worn: the style and the colour. */
export type PieceChoice = [style: string, colour: string];

export interface ElfLook {
  skin: string;
  hair: string;
  hairStyle: string;
  /** A whole costume, or null to wear the pieces. */
  outfit: string | null;
  pieces: Record<SlotId, PieceChoice | null>;
}

/** What a detective has earned, as far as the wardrobe cares. */
export interface WardrobeState {
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
  /** False for an elf that is decoration, so screen readers skip it. */
  label?: false;
}

interface WardrobeApi {
  DOORS: number;
  SKIN_TONES: { id: string; hex: string }[];
  HAIR_COLOURS: { id: string; hex: string }[];
  HAIR_STYLES: { id: string; name: string }[];
  SLOTS: WardrobeSlot[];
  STYLES: WardrobeStyle[];
  OUTFITS: WardrobeOutfit[];
  pieceUnlocked(styleId: string, colourId: string, state: WardrobeState): boolean;
  outfitUnlocked(outfitId: string, state: WardrobeState): boolean;
  newlyUnlocked(before: WardrobeState, after: WardrobeState): Unlocks;
  pieceWords(styleId: string, colourId: string): string;
  defaultLook(): ElfLook;
  normaliseLook(look: unknown, state: WardrobeState): ElfLook;
  drawElf(look: unknown, state: WardrobeState, opts?: DrawOptions): string;
  drawPiece(styleId: string, colourId: string, size?: number): string;
  drawOutfit(outfitId: string, look: unknown, size?: number): string;
}

const SCRIPT = resolve(__dirname, "../../assets/js/elf-wardrobe.js");
const api = createRequire(SCRIPT)(SCRIPT) as WardrobeApi;

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
