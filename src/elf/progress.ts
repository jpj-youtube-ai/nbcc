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

const doorSet = (doors: readonly number[]): Set<number> => new Set(doors.filter(isDoor));

/** The rank a number of doors done has earned. */
export function rankAt(doorsDone: number): Rank {
  let rank: Rank = RANKS[0].rank;
  for (const r of RANKS) {
    if (doorsDone >= r.at) rank = r.rank;
  }
  return rank;
}

/** Everything about a detective's progress, from the doors they have cracked and the doors they have visited. */
export function progressOf(crackedDoors: readonly number[], visitedDoors: readonly number[]): Progress {
  const cracked = doorSet(crackedDoors);
  const visited = doorSet(visitedDoors);
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

/** The ranks newly reached going from one count of doors done to another, in order. */
export function promotionsBetween(before: number, after: number): Rank[] {
  return RANKS.filter((r) => r.at > before && r.at <= after).map((r) => r.rank);
}
