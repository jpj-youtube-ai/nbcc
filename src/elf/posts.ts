import type { Door } from "./calendar";
import { doorPicture } from "./door-setup";
import { isOpen, type DoorState } from "./doors";
import { detectiveNames, type DetectiveNameParts } from "./names";
import { clockWords } from "./words";

// NBCC Elf Detective School wave 2: the two social posts a day (docs/superpowers/plans/
// 2026-11-10-elf-wave-2-game-2.md, Task 2). Staff copy them from the 8am Elf HQ email. Pure text.
//
// "Tonight" only when the first clue is after midday; a morning clue is "today". A detective is
// named only through detectiveNames, so a first name nobody has ticked shows as its first letter.
// The yesterday post exists only once the door is open: it is null for a door whose finder has not yet
// let the place be shown ("found-hidden"), and for a snow day. It never names the place, which a family
// sees only once it has had its guess or been there (Plan 2c-1).

const LONDON_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" });

/** "tonight" when the clock in London says 12 or later, otherwise "today". */
export function whenWords(clue1At: Date): "tonight" | "today" {
  const hour = Number(LONDON_HOUR.formatToParts(clue1At).find((p) => p.type === "hour")?.value ?? "0");
  return hour >= 12 ? "tonight" : "today";
}

/** The post about the door that opens today. */
export function doorPost(o: { door: Door; clue1At: Date; joinUrl: string }): string {
  const when = whenWords(o.clue1At);
  const rest = when === "tonight" ? "evening" : "morning";
  return `Door ${o.door} of NBCC Elf Detective School opens ${when}! The first clue comes out at ${clockWords(o.clue1At)} in Detective HQ, with two more across the ${rest}. Not a detective yet? Join at ${o.joinUrl}`;
}

/** The post about yesterday's door, or null unless the door is open. Who found the elf, or that nobody has yet
 *  and its prize is still to be won (nobody did, once the elf has gone home: it can no longer be found); and,
 *  while having a go is open (`goesOpen`: until Christmas Day, ruling F6), that a family that missed it can
 *  still crack the case. A finder who cannot be named is "A detective", as on the calendar. */
export function yesterdayPost(o: {
  door: Door;
  elfName: string;
  state: DoorState;
  finders: DetectiveNameParts[];
  foundAt: Date | null;
  goneHome: boolean;
  goesOpen: boolean;
}): string | null {
  if (!isOpen(o.state)) return null;
  const elf = o.elfName;
  const missed = o.goesOpen ? " Missed it? You can still crack the case in Detective HQ, with one guess." : "";
  if (o.state === "found") {
    const by = detectiveNames(o.finders) || "A detective";
    const at = o.foundAt ? clockWords(o.foundAt) : "";
    return `Door ${o.door} is open! ${by} found ${elf}${at ? ` at ${at}` : ""}.${missed}`;
  }
  if (o.goneHome) return `Door ${o.door} is open! Nobody found ${elf} in time.${missed}`;
  return `Door ${o.door} is open! Nobody has found ${elf} yet, so the first detective to find it still wins the prize.${missed}`;
}

/** The committed picture for a door's post, on the site's own address, or null when the door has none
 *  of its own. None has: every door has the same present, so a post goes without a picture. */
export function postPicture(year: number, door: Door, siteOrigin: string): string | null {
  const path = doorPicture(year, door);
  return path === null ? null : `${siteOrigin.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}
