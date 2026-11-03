import { describe, it, expect } from "vitest";
import { calendarViewFor, hqViewFor, lookFromForm, wardrobeViewFor, type FamilyRow } from "../../src/elf/views";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { defaultLook } from "../../src/elf/wardrobe";

// NBCC Elf Detective School: turning what the database holds into what the screens show. Every
// family here is invented.

const SETTINGS = { ...ELF_DEFAULTS, schoolOn: true };
const FAMILY: FamilyRow = {
  id: 3,
  grownUpName: "Sam Example",
  detectives: [
    { id: 100, firstName: "Ruby", surname: "Tinselfoot", nameApproved: false, badgeNumber: 1, look: null, fresh: [] },
    { id: 101, firstName: "Leo", surname: "Frostwhistle", nameApproved: true, badgeNumber: 42, look: null, fresh: ["bow:gold"] },
  ],
};

describe("Detective HQ before school starts", () => {
  const view = hqViewFor({ family: FAMILY, settings: SETTINGS, now: new Date("2026-11-13T09:00:00.000Z") });

  it("has no case today, and counts down to the first clue on Tuesday 1 December at 5:30pm", () => {
    expect(view.today).toBeNull();
    expect(view.nextClueAt?.toISOString()).toBe("2026-12-01T17:30:00.000Z");
  });

  it("greets the grown up by first name and shows each detective in full to their own family", () => {
    expect(view.familyName).toBe("Sam");
    expect(view.detectives.map((d) => d.name)).toEqual(["Detective Ruby Tinselfoot", "Detective Leo Frostwhistle"]);
    expect(view.detectives.map((d) => d.badgeNumber)).toEqual(["EDS 0001", "EDS 0042"]);
  });

  it("starts every detective as a Trainee, six doors from Junior Detective", () => {
    for (const d of view.detectives) {
      expect(d.rank).toBe("Trainee");
      expect(d.doorsDone).toBe(0);
      expect(d.next).toEqual({ rank: "Junior Detective", toGo: 6 });
    }
  });

  it("points at each detective's own elf and wardrobe", () => {
    expect(view.detectives[0].elfUrl).toBe("/elf/hq/elf/100.svg");
    expect(view.detectives[0].wardrobeUrl).toBe("/elf/hq/wardrobe/100");
    expect(view.detectives[1].newThings).toBe(1);
  });
});

describe("the wardrobe", () => {
  it("is built from what the detective has earned on the server, and a missing look is the starter elf", () => {
    const view = wardrobeViewFor({ detective: FAMILY.detectives[0], settings: SETTINGS });
    expect(view.state).toEqual({ doorsDone: 0, goldSeal: false, wonRace: false });
    expect(view.look).toEqual(defaultLook());
    expect(view.saveUrl).toBe("/api/elf/look");
    expect(view.calendarUrl).toBe("/elf");
  });
});

describe("a look from the plain form", () => {
  it("reads the skin, hair, outfit and each piece as style and colour", () => {
    const look = lookFromForm({ skin: "s2", hair: "ginger", hairStyle: "bunches", outfit: "", "piece-hat": "elf:red", "piece-face": "" });
    expect(look).toMatchObject({ skin: "s2", hair: "ginger", hairStyle: "bunches", outfit: null });
    expect((look.pieces as Record<string, unknown>).hat).toEqual(["elf", "red"]);
    expect((look.pieces as Record<string, unknown>).face).toBeNull();
  });
});

describe("the public calendar before December", () => {
  const view = calendarViewFor({ settings: SETTINGS, now: new Date("2026-11-20T10:00:00.000Z") });

  it("has 24 doors, every one shut, with nothing about where any elf hides", () => {
    expect(view.doors.length).toBe(24);
    for (const d of view.doors) {
      expect(d.state).toBe("shut");
      expect(d.place).toBeNull();
      expect(d.found).toBeNull();
    }
  });

  it("counts down to door 1's first clue, at 5:30pm on Tuesday 1 December, and weekend doors at 10am", () => {
    expect(view.doors[0].clueAt.toISOString()).toBe("2026-12-01T17:30:00.000Z");
    // Saturday 5 December
    expect(view.doors[4].clueAt.toISOString()).toBe("2026-12-05T10:00:00.000Z");
  });

  it("shows the price the admin set, as words", () => {
    expect(view.price).toEqual({ from: "£1", suggested: "£5" });
    expect(view.joinUrl).toBe("/elf/join");
    expect(view.hqUrl).toBe("/elf/hq");
  });
});
