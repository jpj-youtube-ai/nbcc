import { describe, it, expect } from "vitest";
import {
  emptyDoor,
  doorSeason,
  staffEveningOf,
  readinessOf,
  doorsSummary,
  prizeListText,
  doorWeekday,
  doorPicture,
  READY_WORDS,
  type DoorSetup,
} from "../../src/elf/door-setup";

function fullDoor(): DoorSetup {
  return {
    ...emptyDoor(7, "abc"),
    placeName: "Pine Cone Café",
    placeTown: "Ayr",
    placeAddress: "1 Example Street",
    prize: "A wooden sledge",
    elfName: "Twinkle",
    tagWord: "SNOWBALL 472",
    clues: [
      { n: 1, words: "One", hasPicture: false, pictureAlt: null },
      { n: 2, words: "Two", hasPicture: false, pictureAlt: null },
      { n: 3, words: "Three", hasPicture: false, pictureAlt: null },
    ],
    droppedOffAt: new Date("2026-12-01T10:00:00Z"),
  };
}

describe("door setup", () => {
  it("starts empty", () => {
    const d = emptyDoor(7, "abc");
    expect(d.prizeShowOff).toBe(false);
    expect(d.names).toEqual([]);
    expect(d.clues.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(readinessOf(d)).toMatchObject({ toDo: 5, ready: false });
    expect(staffEveningOf(d)).toEqual({ clue1: null, clue2: null, clue3: null, reveal: null });
    expect(doorSeason(2026)).toEqual({ year: 2026, holidayDoors: [], schoolClueTime: "17:30", morningClueTime: "10:00" });
  });

  // 12 November 2026: every door carries the same present, so no door waits on a picture of its own.
  it("is ready with its place, prize, elf and tag, three clues and dropped off ticked, and no door picture", () => {
    const r = readinessOf(fullDoor());
    expect(r).toMatchObject({ toDo: 0, ready: true });
    expect(r.items.map((i) => i.key)).toEqual(["place", "prize", "elf", "clues", "droppedOff"]);
  });

  it("is not ready while any one of them is missing", () => {
    for (const missing of [{ placeAddress: null }, { prize: null }, { tagWord: "SNOWBALL" }, { droppedOffAt: null }] as Partial<DoorSetup>[]) {
      expect(readinessOf({ ...fullDoor(), ...missing }), JSON.stringify(missing)).toMatchObject({ toDo: 1, ready: false });
    }
  });

  it("has words for everything a door needs, and a door picture is not one of them", () => {
    expect(Object.keys(READY_WORDS)).toEqual(["place", "prize", "elf", "clues", "droppedOff"]);
    // The 8am email lists what is left in these words, so every item has some.
    for (const i of readinessOf(emptyDoor(7, "abc")).items) expect(READY_WORDS[i.key], i.key).toMatch(/^[A-Z]/);
    expect(READY_WORDS.elf).toBe("The elf and its tag");
  });

  it("checks each item", () => {
    const find = (d: DoorSetup, k: string) => readinessOf(d).items.find((i) => i.key === k)?.done;
    expect(find({ ...fullDoor(), placeAddress: null }, "place")).toBe(false);
    expect(find({ ...fullDoor(), tagWord: "SNOWBALL" }, "elf")).toBe(false);
    expect(find({ ...fullDoor(), clues: [{ n: 1, words: "   ", hasPicture: false, pictureAlt: null }, { n: 2, words: "a", hasPicture: false, pictureAlt: null }, { n: 3, words: "b", hasPicture: false, pictureAlt: null }] }, "clues")).toBe(false);
    // a clue that is a picture only is done
    const pictureOne = { n: 1 as const, words: null, hasPicture: true, pictureAlt: "A pretend picture" };
    expect(find({ ...fullDoor(), clues: [pictureOne, ...fullDoor().clues.slice(1)] }, "clues")).toBe(true);
  });

  it("starts with nothing found, snowed in or gone home", () => {
    const d = emptyDoor(7, "abc");
    expect([d.foundAt, d.foundFamilyId, d.snowDayAt, d.snowDayBy, d.goneHomeAt, d.goneHomeBy]).toEqual([null, null, null, null, null, null]);
    expect(d.clues[0]).toEqual({ n: 1, words: null, hasPicture: false, pictureAlt: null });
  });

  it("summarises, counting a door with everything in as ready", () => {
    expect(doorsSummary([fullDoor(), emptyDoor(8, "x")])).toEqual({ placesAgreed: 1, prizesChosen: 1, ready: 1 });
  });

  it("lists prizes in door order", () => {
    expect(prizeListText([{ door: 2, prize: null }, { door: 1, prize: "A wooden sledge" }]))
      .toBe("Door 1: A wooden sledge\nDoor 2: No prize yet");
  });

  it("knows weekdays and pictures", () => {
    expect(doorWeekday(2026, 1)).toBe("Tue");
    expect(doorWeekday(2026, 7)).toBe("Mon");
    expect(doorPicture(2026, 7)).toBeNull();
    expect(doorPicture(2026, 7, { "2026-7": "/x.webp" })).toBe("/x.webp");
  });
});
