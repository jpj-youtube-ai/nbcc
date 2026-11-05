import { COSTUMES, SKIN_TONES } from "./wardrobe";

// NBCC Elf Detective School: Head Elf HQ's numbers, its quests and a detective's picture, worked out
// from what the database counts. Design: docs/superpowers/specs/2026-11-05-elf-admin-design.md
// (decisions 4 and 5). Pure: no pool, no clock. Unit tested in test/unit/elf-admin-hq.test.ts.

/** A part of Head Elf HQ, as its menu tile names it. */
export type HqTab = "hq" | "families" | "money" | "settings";

/** What HQ counts: active families that have not been removed, and their paid orders. */
export interface HqNumbers {
  families: number;
  detectives: number;
  /** Active detectives whose first name has not been ticked to show in public. */
  namesToCheck: number;
  /** Payments started over an hour ago and never finished. */
  waitingPayments: number;
  entryPence: number;
  giftPence: number;
  /** The part of the gifts that came with Gift Aid. */
  giftAidPence: number;
}

/** One line of Needs you: something waiting for a person, and where to sort it. */
export interface Quest {
  id: "names" | "preview" | "waiting";
  count: number | null;
  title: string;
  words: string;
  go: HqTab | null;
  button: string | null;
  /** The Families filter the button opens with. */
  filter: "check" | null;
}

/** Needs you, in order, each only when it applies. */
export function questsFor(n: HqNumbers, previewOn: boolean): Quest[] {
  const quests: Quest[] = [];
  if (n.namesToCheck > 0) {
    quests.push({
      id: "names",
      count: n.namesToCheck,
      title: "First names to check",
      words: "Until you tick a name, the public sees only its first letter.",
      go: "families",
      button: "Check names",
      filter: "check",
    });
  }
  if (previewOn) {
    quests.push({
      id: "preview",
      count: null,
      title: "Your preview link is open",
      words: "Anyone holding it can see the school. End it when you have finished looking.",
      go: "settings",
      button: "End it",
      filter: null,
    });
  }
  if (n.waitingPayments > 0) {
    quests.push({
      id: "waiting",
      count: n.waitingPayments,
      title: "Payments not finished",
      words: "Started over an hour ago and never paid: usually someone who changed their mind. Nothing to do.",
      go: null,
      button: null,
      filter: null,
    });
  }
  return quests;
}

const TILES = "/assets/img/elf/paper/tiles/costumes/";
const COSTUME_IDS: ReadonlySet<string> = new Set(COSTUMES.map((c: { id: string }) => c.id));
const SKIN_IDS: ReadonlySet<string> = new Set(SKIN_TONES.map((s: { id: string }) => s.id));

/** A detective's picture: the tile of the costume their look wears, in their skin. A look with no
 *  costume wears the detective's own; anything unusable is the detective costume in the first skin. */
export function tileFor(look: unknown): string {
  const l = look && typeof look === "object" ? (look as { costume?: unknown; skin?: unknown }) : {};
  const costume = typeof l.costume === "string" && COSTUME_IDS.has(l.costume) ? l.costume : "detective";
  const skin = typeof l.skin === "string" && SKIN_IDS.has(l.skin) ? l.skin : "s1";
  return `${TILES}${costume}-${skin}.webp`;
}

const ukDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** The day a moment falls on in the UK, as a count of days. */
function dayNumber(d: Date): number {
  const p = Object.fromEntries(ukDay.formatToParts(d).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000;
}

/** Whole UK days from now until then, never below 0. */
export function daysUntil(now: Date, then: Date): number {
  return Math.max(0, dayNumber(then) - dayNumber(now));
}

/** What claiming Gift Aid on these gifts could add: a quarter, to the penny. */
export function giftAidCouldAddPence(giftAidPence: number): number {
  return Math.round(Math.max(0, giftAidPence) / 4);
}
