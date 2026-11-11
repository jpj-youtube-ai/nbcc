import type { DetectiveNameParts } from "./names";

// NBCC Elf Detective School: the order of a door's scrapbook. Pure, no pool, no clock.
// Unit tested in test/unit/elf-scrapbook.test.ts.

export interface ScrapElf {
  visitId: number;
  detective: DetectiveNameParts;
  /** When this elf's visit counts from (the time the place was shown, or the visit, if later). */
  countsFrom: Date;
  /** Is this the elf of the family that found the door's elf? */
  found: boolean;
  pictureUrl: string;
}

export interface ScrapPhoto {
  /** The random token that is the photo's address. */
  token: string;
  url: string;
}

export interface Scrapbook {
  elves: ScrapElf[];
  photos: ScrapPhoto[];
  count: number;
}

/** The most elf pictures a door tile's mini collage shows. */
export const COLLAGE_MAX = 3;

/** Elves with the finder's first, then by the time they count from and visit; photos in a stable
 *  shuffle (sorted by token), so the order says nothing about which photo came from which family. */
export function orderScrapbook(elves: readonly ScrapElf[], photos: readonly ScrapPhoto[]): Scrapbook {
  const orderedElves = [...elves].sort(
    (a, b) => Number(b.found) - Number(a.found) || a.countsFrom.getTime() - b.countsFrom.getTime() || a.visitId - b.visitId,
  );
  const orderedPhotos = [...photos].sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
  return { elves: orderedElves, photos: orderedPhotos, count: orderedElves.length + orderedPhotos.length };
}

/** Up to COLLAGE_MAX elf pictures, the finder's first. Never a photo. */
export function collageOf(book: Scrapbook): string[] {
  return book.elves.slice(0, COLLAGE_MAX).map((e) => e.pictureUrl);
}
