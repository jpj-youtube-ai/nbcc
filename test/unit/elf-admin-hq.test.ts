import { describe, it, expect } from "vitest";
import { daysUntil, giftAidCouldAddPence, questsFor, tileFor, type HqNumbers } from "../../src/elf/admin-hq";

// Head Elf HQ's numbers, quests and pictures (docs/superpowers/specs/2026-11-05-elf-admin-design.md,
// decisions 4 and 5).
const NONE: HqNumbers = { families: 0, detectives: 0, namesToCheck: 0, waitingPayments: 0, entryPence: 0, giftPence: 0, giftAidPence: 0 };
const TILES = "/assets/img/elf/paper/tiles/costumes/";

describe("Needs you", () => {
  it("lists only the quests that apply, in order", () => {
    expect(questsFor({ ...NONE, namesToCheck: 6, waitingPayments: 2 }, true).map((q) => q.id)).toEqual(["names", "preview", "waiting"]);
    expect(questsFor({ ...NONE, waitingPayments: 2 }, false).map((q) => q.id)).toEqual(["waiting"]);
    expect(questsFor(NONE, false)).toEqual([]);
  });

  it("gives the names quest its count and the Families filter", () => {
    expect(questsFor({ ...NONE, namesToCheck: 6 }, false)[0]).toEqual({
      id: "names",
      count: 6,
      title: "First names to check",
      words: "Until you tick a name, the public sees only its first letter.",
      go: "families",
      button: "Check names",
      filter: "check",
    });
  });

  it("sends the preview quest to Settings, and gives the waiting one nothing to press", () => {
    const [preview, waiting] = questsFor({ ...NONE, waitingPayments: 3 }, true);
    expect(preview).toMatchObject({ id: "preview", count: null, title: "Your preview link is open", go: "settings", button: "End it", filter: null });
    expect(preview.words).toBe("Anyone holding it can see the school. End it when you have finished looking.");
    expect(waiting).toMatchObject({ id: "waiting", count: 3, title: "Payments not finished", go: null, button: null, filter: null });
    expect(waiting.words).toBe("Started over an hour ago and never paid: usually someone who changed their mind. Nothing to do.");
  });
});

describe("a detective's picture", () => {
  it("is the tile of the costume their look wears, in their skin", () => {
    expect(tileFor({ costume: "reindeer", skin: "s3" })).toBe(`${TILES}reindeer-s3.webp`);
    expect(tileFor({ costume: "highlandcow", skin: "s5", scene: "loch" })).toBe(`${TILES}highlandcow-s5.webp`);
  });

  it("is the detective costume when the look wears none, in their skin when it has one", () => {
    expect(tileFor({ costume: null, skin: "s2" })).toBe(`${TILES}detective-s2.webp`);
    expect(tileFor({ costume: "none", skin: "s4" })).toBe(`${TILES}detective-s4.webp`);
  });

  it("is the detective costume in the first skin when the look says nothing usable", () => {
    for (const look of [null, undefined, {}, "reindeer", 7, { costume: "../../etc", skin: "s9" }]) {
      expect(tileFor(look), JSON.stringify(look)).toBe(`${TILES}detective-s1.webp`);
    }
  });
});

describe("the days to the first clue", () => {
  const clue = new Date("2026-12-01T17:30:00.000Z");

  it("counts whole days in the UK", () => {
    expect(daysUntil(new Date("2026-11-05T19:00:00.000Z"), clue)).toBe(26);
    expect(daysUntil(new Date("2026-11-30T23:30:00.000Z"), clue)).toBe(1);
    expect(daysUntil(new Date("2026-12-01T00:30:00.000Z"), clue)).toBe(0);
  });

  it("never goes below 0", () => {
    expect(daysUntil(new Date("2026-12-09T10:00:00.000Z"), clue)).toBe(0);
  });
});

describe("what Gift Aid could add", () => {
  it("is a quarter of the gifts with Gift Aid, to the penny", () => {
    expect(giftAidCouldAddPence(21000)).toBe(5250);
    expect(giftAidCouldAddPence(1001)).toBe(250);
    expect(giftAidCouldAddPence(0)).toBe(0);
  });
});
