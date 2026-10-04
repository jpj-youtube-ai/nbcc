import { allInFamily, chosenDetectives } from "./detectives";
import { isClaimable, type DoorState } from "./doors";

// NBCC Elf Detective School: claiming an elf. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Each elf wears a tag with a secret word. The finder scans the business's poster and types the
// word, so an elf can only be claimed by someone holding it: a photo of the poster passed round
// online is not enough. One elf per family, so that more families win.
//
// The order of the checks is part of the rule. Every business keeps its poster up all month, and a
// poster is only a link, so anyone can try a word at any place from home. A wrong word therefore
// gets the same answer whether or not an elf is hiding there today: trying a made up word at all 24
// places finds nothing out. Only the right word, which means holding the elf, is ever told that it
// is too early. The claim screen must look the same at every place too: it never says which door a
// place belongs to.
//
// That leaves guessing the word itself, and a right guess is confirmed even on a day the elf is not
// out. Two things make it hopeless. A family gets six wrong tries at a place (only a `wrong-word`
// answer counts as one). And a tag's word must carry at least three numbers, picked at random,
// because the list of word ideas is public: six tries at tens of thousands of words.
//
// These functions say whether one claim is valid. Three things must ALSO be guarded where claims
// are stored, because several requests can pass this check in the same moment: one winner per door
// (the first to arrive), one win per family, and the count of wrong tries. Take a try in one step,
// before the word is checked, or a burst of requests would each read the same count.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-claim.test.ts.

/** How many wrong words a family may type at one place. After that, staff sort it out by hand. */
export const MAX_WRONG_WORDS = 6;

/** The secret word as it is compared: wide letters made plain and accents folded away, then letters
 *  and digits only, in lower case. */
export function normaliseWord(typed: string): string {
  return String(typed ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Can this word go on an elf's tag? It needs a letter and at least three numbers, like
 *  "Snowball 472". The numbers matter: the list of word ideas is public (SECRET_WORD_IDEAS in
 *  src/elf/names.ts), so a word on its own, or with one number, could be guessed from home. */
export function isUsableSecretWord(word: string): boolean {
  const tidy = normaliseWord(word);
  return /[a-z]/.test(tidy) && (tidy.match(/[0-9]/g) ?? []).length >= 3;
}

export type ClaimRefusal =
  | "already-found"
  | "no-detectives"
  | "not-your-detective"
  | "too-many-tries"
  | "wrong-word"
  | "too-early"
  | "already-won";
export type ClaimDecision = { ok: true; detectiveIds: string[] } | { ok: false; reason: ClaimRefusal };

export interface ClaimContext {
  /** The state of the place's door, worked out at the moment of the claim. */
  doorState: DoorState;
  /** The word on this elf's tag. */
  secretWord: string;
  /** Every detective in the claiming family. */
  familyDetectiveIds: readonly (string | number)[];
  /** Has this family already won an elf this year? */
  familyHasWon: boolean;
  /** How many wrong words this family has already typed at this place. */
  wrongTries: number;
}

export interface ClaimAttempt {
  /** The detectives ticked on the form, as it arrived. Made safe by chosenDetectives. */
  detectiveIds: unknown;
  /** The word they typed. */
  word: string;
}

/** Is this claim valid? When it is, the answer names the detectives who made it, as text ids, each once. */
export function decideClaim(ctx: ClaimContext, attempt: ClaimAttempt): ClaimDecision {
  // A found door is public knowledge, so saying so gives nothing away.
  if (ctx.doorState === "found") return { ok: false, reason: "already-found" };
  const chosen = chosenDetectives(attempt.detectiveIds);
  if (chosen.length === 0) return { ok: false, reason: "no-detectives" };
  if (!allInFamily(chosen, ctx.familyDetectiveIds)) return { ok: false, reason: "not-your-detective" };
  // A count that is missing, or is not a number, refuses. A database hands a count over as text, so
  // whoever calls this must turn it into a number first.
  if (typeof ctx.wrongTries !== "number" || !(ctx.wrongTries < MAX_WRONG_WORDS)) {
    return { ok: false, reason: "too-many-tries" };
  }
  // The word comes before the door's state: see the note at the top of this file.
  const want = normaliseWord(ctx.secretWord);
  if (want === "" || normaliseWord(attempt.word) !== want) return { ok: false, reason: "wrong-word" };
  // A found door was answered above, so a door that cannot be claimed here is one still shut.
  if (!isClaimable(ctx.doorState)) return { ok: false, reason: "too-early" };
  if (ctx.familyHasWon) return { ok: false, reason: "already-won" };
  return { ok: true, detectiveIds: chosen };
}
