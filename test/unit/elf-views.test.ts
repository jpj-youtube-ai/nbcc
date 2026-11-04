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
  email: "sam@example.com",
  detectives: [
    { id: 100, firstName: "Ruby", surname: "Tinselfoot", nameApproved: false, badgeNumber: 1, look: null, fresh: [], favourites: [] },
    { id: 101, firstName: "Leo", surname: "Frostwhistle", nameApproved: true, badgeNumber: 42, look: null, fresh: ["tree"], favourites: [] },
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
    expect(view.detectives[0].elfUrl).toBe("/elf/hq/elf/100.png");
    expect(view.detectives[0].wardrobeUrl).toBe("/elf/hq/wardrobe/100");
    expect(view.detectives[1].newThings).toBe(1);
  });
});

describe("the wardrobe", () => {
  it("is built from the doors the detective has done on the server, and a missing look is the starting elf", () => {
    const view = wardrobeViewFor({ detective: FAMILY.detectives[0], settings: SETTINGS });
    expect(view.state).toEqual({ doors: [] });
    expect(view.look).toEqual(defaultLook());
    expect(view.favourites).toEqual([]);
    expect(view.saveUrl).toBe("/api/elf/look");
    expect(view.calendarUrl).toBe("/elf");
  });

  it("makes the saved look safe, so an old layered look shows as the start with its own skin and hair", () => {
    const old = { sibling: "brother", skin: "s4", hair: "black", hairStyle: "curly", outfit: "tree", pieces: { hat: ["bobble", "red"] } };
    const view = wardrobeViewFor({ detective: { ...FAMILY.detectives[0], look: old }, settings: SETTINGS });
    expect(view.look).toEqual({ ...defaultLook(), sibling: "brother", skin: "s4", hair: "black", hairStyle: "curly" });
  });

  it("shows the saved favourite looks, made safe", () => {
    const favourites = [{ ...defaultLook(), scene: "largs" }, "junk", { ...defaultLook(), costume: "santa" }];
    const view = wardrobeViewFor({ detective: { ...FAMILY.detectives[0], favourites }, settings: SETTINGS });
    expect(view.favourites).toEqual([{ ...defaultLook(), scene: "largs" }, defaultLook()]);
  });
});

describe("a look from the plain form", () => {
  it("reads who the elf is, the costume and every extra, with an empty choice as none", () => {
    const look = lookFromForm({ sibling: "brother", skin: "s2", hair: "ginger", hairStyle: "bunches", costume: "", scene: "ayr", friend: "robin", frame: "", glasses: "specs-gold", bow: "" });
    expect(look).toEqual({ sibling: "brother", skin: "s2", hair: "ginger", hairStyle: "bunches", costume: null, scene: "ayr", friend: "robin", frame: null, glasses: "specs-gold", bow: null });
  });

  it("reads only words, never anything else the form sends", () => {
    const look = lookFromForm({ costume: ["tree"], scene: { x: 1 }, friend: 7 });
    expect(look).toMatchObject({ costume: null, scene: "", friend: null });
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
