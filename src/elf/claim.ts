import { isClaimable, type DoorState } from "./doors";

// NBCC Elf Detective School: claiming an elf. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Each elf wears a tag with a secret word. The finder scans the business's poster and types the
// word, so an elf can only be claimed by someone holding it: a photo of the poster passed round
// online is not enough. One elf per family, so that more families win.
//
// These functions say whether a claim is valid. Which valid claim was FIRST is settled where the
// claims are stored, by the order they arrive; `earliest` states the same rule for anything working
// from a list.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-claim.test.ts.

/** The secret word as it is compared: letters and digits only, in lower case. */
export function normaliseWord(typed: string): string {
  return String(typed ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export type ClaimRefusal =
  | "too-early"
  | "already-found"
  | "no-detectives"
  | "not-your-detective"
  | "wrong-word"
  | "already-won";
export type ClaimDecision = { ok: true } | { ok: false; reason: ClaimRefusal };

export interface ClaimContext {
  /** The state of the door whose elf is being claimed. */
  doorState: DoorState;
  /** The word on this elf's tag. */
  secretWord: string;
  /** Every detective in the claiming family. */
  familyDetectiveIds: readonly string[];
  /** Has this family already won an elf this year? */
  familyHasWon: boolean;
}

export interface ClaimAttempt {
  /** The detectives who are there. */
  detectiveIds: readonly string[];
  /** The word they typed. */
  word: string;
}

/** Is this claim valid? The word is checked before the one elf per family rule, so a family that has
 *  already won is told so kindly rather than told their word is wrong. */
export function decideClaim(ctx: ClaimContext, attempt: ClaimAttempt): ClaimDecision {
  if (ctx.doorState === "shut") return { ok: false, reason: "too-early" };
  if (!isClaimable(ctx.doorState)) return { ok: false, reason: "already-found" };
  if (attempt.detectiveIds.length === 0) return { ok: false, reason: "no-detectives" };
  if (!attempt.detectiveIds.every((id) => ctx.familyDetectiveIds.includes(id))) {
    return { ok: false, reason: "not-your-detective" };
  }
  const want = normaliseWord(ctx.secretWord);
  if (want === "" || normaliseWord(attempt.word) !== want) return { ok: false, reason: "wrong-word" };
  if (ctx.familyHasWon) return { ok: false, reason: "already-won" };
  return { ok: true };
}

/** Of several claims on one door, the first: the earliest, and on a tie the one that arrived first. */
export function earliest<T extends { at: Date }>(claims: readonly T[]): T | null {
  let first: T | null = null;
  for (const claim of claims) {
    if (first === null || claim.at.getTime() < first.at.getTime()) first = claim;
  }
  return first;
}
