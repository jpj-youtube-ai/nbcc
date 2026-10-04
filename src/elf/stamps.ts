import { isOpen, type DoorState } from "./doors";
import { NEAR_METRES, isNear, type LatLng } from "./distance";

// NBCC Elf Detective School: earning a candy cane stamp for visiting a hiding place. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Once a door is open, any detective who visits the place earns its stamp, any day until Christmas
// Eve. Stamps lead to graduation and to the grand prize, so a visit needs proof: the phone being
// near the place, or a photo taken there for anyone who would rather not share their location.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-stamps.test.ts.

export type StampRefusal = "door-not-open" | "no-detectives" | "not-your-detective" | "nothing-new" | "too-far" | "no-proof";

export type StampDecision =
  | { ok: true; detectiveIds: string[]; proof: "location" | "photo" }
  | { ok: false; reason: StampRefusal };

export interface StampContext {
  /** The state of the door for this place. */
  doorState: DoorState;
  /** Where the place is. */
  place: LatLng;
  /** Every detective in the visiting family. */
  familyDetectiveIds: readonly string[];
  /** The family's detectives who already have this stamp. */
  alreadyStamped: readonly string[];
  /** How close counts, when staff have changed it. */
  radiusMetres?: number;
}

export interface StampAttempt {
  /** The detectives who are there. */
  detectiveIds: readonly string[];
  /** The phone's position if it was shared, checked here and never kept. */
  location: LatLng | null;
  /** Was a photo taken at the place sent with it? */
  hasPhoto: boolean;
}

/** Does this visit earn stamps, for whom, and on what proof? A near phone is preferred to a photo. */
export function decideStamp(ctx: StampContext, attempt: StampAttempt): StampDecision {
  if (!isOpen(ctx.doorState)) return { ok: false, reason: "door-not-open" };
  if (attempt.detectiveIds.length === 0) return { ok: false, reason: "no-detectives" };
  if (!attempt.detectiveIds.every((id) => ctx.familyDetectiveIds.includes(id))) {
    return { ok: false, reason: "not-your-detective" };
  }
  const fresh = [...new Set(attempt.detectiveIds)].filter((id) => !ctx.alreadyStamped.includes(id));
  if (fresh.length === 0) return { ok: false, reason: "nothing-new" };
  if (attempt.location && isNear(ctx.place, attempt.location, ctx.radiusMetres ?? NEAR_METRES)) {
    return { ok: true, detectiveIds: fresh, proof: "location" };
  }
  if (attempt.hasPhoto) return { ok: true, detectiveIds: fresh, proof: "photo" };
  return { ok: false, reason: attempt.location ? "too-far" : "no-proof" };
}
