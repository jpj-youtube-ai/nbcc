import { describe, it, expect } from "vitest";
import { COLLAGE_MAX, collageOf, orderScrapbook, type ScrapElf } from "../../src/elf/scrapbook";

// NBCC Elf Detective School: the scrapbook's order. Everything here is invented.

const parts = { firstName: "Ruby", surname: "Tinselfoot" } as unknown as ScrapElf["detective"];
const elf = (visitId: number, countsFrom: string, found = false): ScrapElf => ({
  visitId,
  detective: parts,
  countsFrom: new Date(countsFrom),
  found,
  pictureUrl: `/elf/${visitId}.png`,
});

describe("the scrapbook", () => {
  it("puts the finder's elf first whatever its time, then the rest by time and visit", () => {
    const book = orderScrapbook(
      [elf(1, "2026-12-07T19:00:00Z"), elf(4, "2026-12-07T19:30:00Z"), elf(3, "2026-12-07T19:00:00Z"), elf(2, "2026-12-07T20:00:00Z", true)],
      [],
    );
    expect(book.elves.map((e) => e.visitId)).toEqual([2, 1, 3, 4]);
  });

  it("orders several finders by time then visit", () => {
    const book = orderScrapbook([elf(6, "2026-12-07T19:00:00Z", true), elf(5, "2026-12-07T19:00:00Z", true)], []);
    expect(book.elves.map((e) => e.visitId)).toEqual([5, 6]);
  });

  it("shuffles photos stably, by token, so the order says nothing about who sent what", () => {
    const zz = { token: "zz" + "1".repeat(20), url: "/p/zz" };
    const aa = { token: "aa" + "2".repeat(20), url: "/p/aa" };
    expect(orderScrapbook([], [zz, aa]).photos).toEqual([aa, zz]);
    expect(orderScrapbook([], [aa, zz]).photos).toEqual([aa, zz]);
  });

  it("counts elves and photos together", () => {
    const book = orderScrapbook([elf(1, "2026-12-07T19:00:00Z")], [{ token: "a", url: "/p/a" }, { token: "b", url: "/p/b" }]);
    expect(book.count).toBe(3);
  });
});

describe("the collage", () => {
  it("is the elves only, the finder's first, never a photo", () => {
    const book = orderScrapbook(
      [elf(1, "2026-12-07T19:00:00Z"), elf(2, "2026-12-07T20:00:00Z", true)],
      [{ token: "a", url: "/p/a" }, { token: "b", url: "/p/b" }],
    );
    expect(collageOf(book)).toEqual(["/elf/2.png", "/elf/1.png"]);
  });

  it("is at most three", () => {
    expect(COLLAGE_MAX).toBe(3);
    const book = orderScrapbook([1, 2, 3, 4].map((n) => elf(n, `2026-12-07T19:0${n}:00Z`)), []);
    expect(collageOf(book)).toHaveLength(3);
  });
});
