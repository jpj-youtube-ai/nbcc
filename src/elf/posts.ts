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
// The yesterday post exists only once the place is public: it is null for a door whose finder has
// not yet let the place be shown ("found-hidden"), for a snow day, and for a door with no place.

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

/** The post about yesterday's door, or null while its place is not public. */
export function yesterdayPost(o: {
  door: Door;
  elfName: string;
  state: DoorState;
  finders: DetectiveNameParts[];
  foundAt: Date | null;
  place: { name: string; town: string } | null;
}): string | null {
  if (!isOpen(o.state) || !o.place) return null;
  const where = `${o.place.name}, ${o.place.town}`;
  const elf = o.elfName;
  if (o.state === "found" && o.finders.length > 0 && o.foundAt) {
    const by = detectiveNames(o.finders);
    return `Door ${o.door} is open! ${by} found ${elf} at ${where} at ${clockWords(o.foundAt)}. ${elf} stays there all December: call in, type the word on the tag for a candy cane stamp, and add your picture to the door.`;
  }
  return `Door ${o.door} is open! Nobody found ${elf} in time, so ${elf} is waiting at ${where}. The first detective to type the word on its tag wins the prize.`;
}

/** The committed picture for a door's post, on the site's own address, or null when the door has none
 *  of its own. None has: every door has the same present, so a post goes without a picture. */
export function postPicture(year: number, door: Door, siteOrigin: string): string | null {
  const path = doorPicture(year, door);
  return path === null ? null : `${siteOrigin.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}
