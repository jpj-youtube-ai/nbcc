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
    expect(readinessOf(d, false)).toMatchObject({ toDo: 6, ready: false });
    expect(staffEveningOf(d)).toEqual({ clue1: null, clue2: null, clue3: null, reveal: null });
    expect(doorSeason(2026)).toEqual({ year: 2026, holidayDoors: [], schoolClueTime: "17:30", morningClueTime: "10:00" });
  });

  it("is ready when everything is in", () => {
    expect(readinessOf(fullDoor(), true)).toMatchObject({ toDo: 0, ready: true });
    const r = readinessOf(fullDoor(), false);
    expect(r.toDo).toBe(1);
    expect(r.items.find((i) => i.key === "picture")?.done).toBe(false);
    expect(r.items.map((i) => i.key)).toEqual(["place", "prize", "picture", "elf", "clues", "droppedOff"]);
    expect(READY_WORDS.elf).toBe("The elf and its tag");
  });

  it("checks each item", () => {
    const find = (d: DoorSetup, k: string) => readinessOf(d, true).items.find((i) => i.key === k)?.done;
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

  it("summarises", () => {
    expect(doorsSummary([{ setup: fullDoor(), hasPicture: true }, { setup: emptyDoor(8, "x"), hasPicture: false }]))
      .toEqual({ placesAgreed: 1, prizesChosen: 1, ready: 1 });
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
