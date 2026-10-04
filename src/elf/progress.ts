import { DOOR_COUNT, isDoor } from "./calendar";

// NBCC Elf Detective School: how far a detective has got. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md (decision 8).
//
// The hiding places are spread across the whole area, so only very keen families will visit all 24.
// A door therefore counts when it is cracked OR visited, and promotions come along the way, so every
// child has something to aim for. Two finishes: Graduate for all 24 doors done either way, and the
// gold seal for visiting all 24 places, which is what leads to the grand prize.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-progress.test.ts.

export const RANKS = [
  { rank: "Trainee", at: 0 },
  { rank: "Junior Detective", at: 6 },
  { rank: "Detective", at: 12 },
  { rank: "Senior Detective", at: 18 },
  { rank: "Graduate", at: 24 },
] as const;

export type Rank = (typeof RANKS)[number]["rank"];

export interface Progress {
  /** Doors cracked or visited, each counted once. */
  doorsDone: number;
  cracked: number;
  visited: number;
  rank: Rank;
  /** All 24 doors done, either way. */
  graduate: boolean;
  /** All 24 places visited. */
  goldSeal: boolean;
  /** The next promotion and how many doors away it is, or null for a Graduate. */
  next: { rank: Rank; at: number; toGo: number } | null;
}

/** The doors a detective has done, as two named lists. A list that is missing counts as empty, which
 *  is what a database gives for no rows. */
export interface DoorsDone {
  /** The doors whose place the family guessed before the door opened. */
  cracked: readonly number[] | null | undefined;
  /** The doors whose place the detective has a stamp for. */
  visited: readonly number[] | null | undefined;
}

const doorSet = (doors: readonly number[] | null | undefined): Set<number> => new Set((doors ?? []).filter(isDoor));

/** The rank a number of doors done has earned. A count below nothing, or that is not a number, is a
 *  Trainee; a count above 24 is still a Graduate. */
export function rankAt(doorsDone: number): Rank {
  let rank: Rank = RANKS[0].rank;
  for (const r of RANKS) {
    if (doorsDone >= r.at) rank = r.rank;
  }
  return rank;
}

/** Everything about a detective's progress. The two lists are named, not passed in order, so they
 *  cannot be swapped by mistake: swapped, 24 cracked doors would look like the gold seal. */
export function progressOf(doors: DoorsDone): Progress {
  const cracked = doorSet(doors.cracked);
  const visited = doorSet(doors.visited);
  const doorsDone = new Set([...cracked, ...visited]).size;
  const upcoming = RANKS.find((r) => r.at > doorsDone) ?? null;
  return {
    doorsDone,
    cracked: cracked.size,
    visited: visited.size,
    rank: rankAt(doorsDone),
    graduate: doorsDone >= DOOR_COUNT,
    goldSeal: visited.size >= DOOR_COUNT,
    next: upcoming ? { rank: upcoming.rank, at: upcoming.at, toGo: upcoming.at - doorsDone } : null,
  };
}

/** The ranks newly reached going from one count of doors done to another, in order. Both counts are
 *  `progressOf(...).doorsDone`. Trainee is never listed: every detective starts as one. */
export function promotionsBetween(before: number, after: number): Rank[] {
  return RANKS.filter((r) => r.at > 0 && r.at > before && r.at <= after).map((r) => r.rank);
}
