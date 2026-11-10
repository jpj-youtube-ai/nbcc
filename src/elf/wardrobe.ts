import { createRequire } from "node:module";
import { resolve } from "node:path";
import { isDoor } from "./calendar";
import type { DoorsDone } from "./progress";

// NBCC Elf Detective School: the elf wardrobe, as the server sees it. The design is
// docs/superpowers/specs/2026-11-04-elf-paper-design.md (the paper wardrobe: whole costumes and extras),
// which replaced decisions 14 and 15 of docs/superpowers/specs/2026-10-04-elf-detective-school-design.md.
//
// The wardrobe itself (who the elf can be, the costumes and extras, which door unlocks each costume,
// and which pictures draw a look) lives in ONE file that the browser also loads:
// assets/js/elf-wardrobe.js. The server reads that same file, the way src/fundraising/signers.ts reads
// the admin's list of signers, so the two can never disagree about what a detective may wear or how
// their elf looks. It ships with the app, next to the pages. It is read when this module is first
// loaded: if the file were missing the app would not start, which is the right failure for a file every
// elf screen needs.
//
// This module adds the types, and one function, wardrobeState, that turns the doors a detective has
// done into what the wardrobe needs to know. Everything in it is pure once the file is read.
// Unit tested in test/unit/elf-wardrobe.test.ts.

/** A hair colour: its fill, and the darker edge drawn round its swatch so it shows against any skin. */
export interface HairColour {
  readonly id: string;
  /** The word people read: "Red" (Jaimie, 3 November 2026: "use the word red or auburn"; the id stays "ginger" so saved looks keep it). */
  readonly name: string;
  readonly hex: string;
  readonly dark: string;
}

/** A scene, friend, frame, pair of glasses or bow tie: all there from sign up. */
export interface WardrobeItem {
  readonly id: string;
  /** The words people read: "River Ayr". */
  readonly name: string;
}

/** A whole hooded costume. Door 0 is from the start; any other unlocks once that door is done. */
export interface Costume extends WardrobeItem {
  readonly door: number;
}

/** A look. Under a costume only the skin shows; the rest is kept for when the costume comes off. */
export interface ElfLook {
  /** "sister" or "brother": which of the logo elf's family this is. */
  sibling: string;
  skin: string;
  hair: string;
  hairStyle: string;
  costume: string | null;
  scene: string;
  friend: string | null;
  frame: string | null;
  glasses: string | null;
  bow: string | null;
}

/** The doors a detective has done, as the wardrobe needs them. Build it with wardrobeState. */
export interface WardrobeState {
  /** Whole door numbers, 1 to 24, each once. A number given as text counts as no door at all. */
  doors: number[];
}

/** The pictures a look is drawn from, under assets/img/elf/paper/, in the order they go on the stage. */
export interface LookPictures {
  scene: string;
  body: string;
  glasses: string | null;
  bow: string | null;
  friend: string | null;
}

interface WardrobeApi {
  SIBLINGS: readonly WardrobeItem[];
  SKIN_TONES: readonly { readonly id: string; readonly hex: string }[];
  HAIR_COLOURS: readonly HairColour[];
  HAIR_STYLES: readonly WardrobeItem[];
  COSTUMES: readonly Costume[];
  SCENES: readonly WardrobeItem[];
  FRIENDS: readonly WardrobeItem[];
  FRAMES: readonly WardrobeItem[];
  GLASSES: readonly WardrobeItem[];
  BOWS: readonly WardrobeItem[];
  costumeUnlocked(costumeId: string, state: WardrobeState): boolean;
  inSentence(words: string): string;
  defaultLook(): ElfLook;
  normaliseLook(look: unknown, state: WardrobeState): ElfLook;
  lookPictures(look: unknown, state: WardrobeState): LookPictures;
  lookWords(look: unknown, state: WardrobeState): string;
}

const SCRIPT = resolve(__dirname, "../../assets/js/elf-wardrobe.js");
const api = createRequire(SCRIPT)(SCRIPT) as WardrobeApi;

export const SIBLINGS = api.SIBLINGS;
export const SKIN_TONES = api.SKIN_TONES;
export const HAIR_COLOURS = api.HAIR_COLOURS;
export const HAIR_STYLES = api.HAIR_STYLES;
export const COSTUMES = api.COSTUMES;
export const SCENES = api.SCENES;
export const FRIENDS = api.FRIENDS;
export const FRAMES = api.FRAMES;
export const GLASSES = api.GLASSES;
export const BOWS = api.BOWS;

/** Can this detective wear this costume? From the start, or once its door is done. */
export const costumeUnlocked = api.costumeUnlocked;
/** Words as they read in the middle of a sentence: a name keeps its capital, nothing else does. */
export const inSentence = api.inSentence;
/** What a brand new detective's elf looks like. */
export const defaultLook = api.defaultLook;
/** A look made safe to keep and to draw: anything unknown or still locked goes back to the start. */
export const normaliseLook = api.normaliseLook;
/** The pictures a look is drawn from, in the order they go on the stage. The look is made safe first. */
export const lookPictures = api.lookPictures;
/** A look in words, for anyone who cannot see the picture. Made safe first, so the words match. */
export const lookWords = api.lookWords;

/** How many favourite looks a detective keeps (Snap a photo on the wardrobe), and how many entries of a
 *  sent list are looked at, so a long list of rubbish costs nothing. */
export const FAVOURITES_KEPT = 3;
const FAVOURITES_READ = 20;

/**
 * Favourite looks made safe to keep and to show: entries that are not plain objects are dropped, each
 * look is made safe like any other, a look already in the list is kept once, and the first three are
 * kept (the page sends the newest first). Anything that is not a list is no favourites at all.
 */
export function normaliseFavourites(list: unknown, state: WardrobeState): ElfLook[] {
  if (!Array.isArray(list)) return [];
  const out: ElfLook[] = [];
  const seen = new Set<string>();
  for (const entry of list.slice(0, FAVOURITES_READ)) {
    if (out.length === FAVOURITES_KEPT) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const look = normaliseLook(entry, state);
    // A made safe look always has its parts in the same order, so its words are its identity.
    const key = JSON.stringify(look);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(look);
  }
  return out;
}

/**
 * The doors a detective has done: the family's cracked doors and the detective's own visits, each door
 * once, real doors only (1 to 24), in order. Always build a WardrobeState here.
 *
 * A wrong state fails shut and says nothing: hand normaliseLook a door as text and it sees no door, so
 * a saved costume quietly comes off. Building the state in one typed place is what stops that.
 */
export function wardrobeState(doors: DoorsDone): WardrobeState {
  const done = new Set([...(doors.cracked ?? []), ...(doors.visited ?? []), ...(doors.snow ?? [])].filter(isDoor));
  return { doors: [...done].sort((a, b) => a - b) };
}
