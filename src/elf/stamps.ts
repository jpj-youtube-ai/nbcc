import { allInFamily, chosenDetectives } from "./detectives";
import { isOpen, type DoorState } from "./doors";
import { isLatLng, isNear, type LatLng } from "./distance";

// NBCC Elf Detective School: earning a candy cane stamp for visiting a hiding place. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Once a door is open, any detective who visits the place earns its stamp, any day until Christmas
// Eve. Stamps lead to graduation and to the grand prize, so a visit needs proof: the phone being
// near the place, or a photo taken there for anyone who would rather not share their location.
//
// Both proofs are the family's word, sent by their own phone, and a determined cheat can fake
// either. They are there to make a real visit the easy thing to do, not to catch a liar. The grand
// prize is judged, not handed out for stamps, so a faked stamp wins nothing by itself.
//
// This says whether one visit earns stamps. The rest is for whoever calls it:
//   - the family, the place, the door's state and the stamps already held come from the server,
//     never from the form;
//   - `hasPhoto` is true only when the server received a picture with this request and it passed
//     the picture checks;
//   - one stamp for each detective at each door must also be guarded where stamps are stored,
//     because two requests can pass this check in the same moment;
//   - stamps stop after Christmas Eve, which this cannot know: it is told no time.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-stamps.test.ts.

export type StampRefusal =
  | "door-not-open"
  | "no-detectives"
  | "not-your-detective"
  | "nothing-new"
  | "too-far"
  | "place-unknown"
  | "no-proof";

export type StampDecision =
  | { ok: true; detectiveIds: string[]; proof: "location" | "photo" }
  | { ok: false; reason: StampRefusal };

export interface StampContext {
  /** The state of the door for this place, worked out at the moment of the visit. */
  doorState: DoorState;
  /** Where the place is, as two numbers. A database can hand a position over as text: that is not
   *  a position, and a location shared against it is answered `place-unknown`. */
  place: LatLng;
  /** Every detective in the visiting family. */
  familyDetectiveIds: readonly (string | number)[];
  /** The family's detectives who already have this stamp. */
  alreadyStamped: readonly (string | number)[] | null;
  /** How close counts, when staff have changed it. Anything that is not a sensible distance is ignored. */
  radiusMetres?: number | null;
}

export interface StampAttempt {
  /** The detectives ticked on the form, as it arrived. Made safe by chosenDetectives. */
  detectiveIds: unknown;
  /** The phone's position if it was shared, checked here and never kept. */
  location: LatLng | null;
  /** True only when the server received a picture with this request. Never the form's own say so. */
  hasPhoto: boolean;
}

/** Does this visit earn stamps, for whom, and on what proof? A near phone is preferred to a photo.
 *  The detectives named in a yes are text ids, each once. */
export function decideStamp(ctx: StampContext, attempt: StampAttempt): StampDecision {
  if (!isOpen(ctx.doorState)) return { ok: false, reason: "door-not-open" };
  const chosen = chosenDetectives(attempt.detectiveIds);
  if (chosen.length === 0) return { ok: false, reason: "no-detectives" };
  if (!allInFamily(chosen, ctx.familyDetectiveIds)) return { ok: false, reason: "not-your-detective" };
  const stamped = new Set((ctx.alreadyStamped ?? []).map((id) => String(id)));
  const fresh = chosen.filter((id) => !stamped.has(id));
  if (fresh.length === 0) return { ok: false, reason: "nothing-new" };
  // A position that is not on the globe counts as not shared.
  const shared = isLatLng(attempt.location) ? attempt.location : null;
  const placeKnown = isLatLng(ctx.place);
  if (shared && placeKnown && isNear(ctx.place, shared, ctx.radiusMetres)) {
    return { ok: true, detectiveIds: fresh, proof: "location" };
  }
  if (attempt.hasPhoto === true) return { ok: true, detectiveIds: fresh, proof: "photo" };
  if (!shared) return { ok: false, reason: "no-proof" };
  return { ok: false, reason: placeKnown ? "too-far" : "place-unknown" };
}
