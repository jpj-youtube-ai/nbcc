import { describe, it, expect } from "vitest";
import { doorPost, postPicture, whenWords, yesterdayPost } from "../../src/elf/posts";

// NBCC Elf Detective School: the two daily social posts. Every family and place here is invented.

const EVENING = new Date("2026-12-07T17:30:00.000Z");
const MORNING = new Date("2026-12-05T10:00:00.000Z");
const RUBY = { firstName: "Ruby", surname: "Tinselfoot", approved: false };
const LEO = { firstName: "Leo", surname: "Frostwhistle", approved: true };
const PLACE = { name: "Pine Cone Café", town: "Snowford" };

describe("whenWords", () => {
  it("says tonight from midday and today before it", () => {
    expect(whenWords(EVENING)).toBe("tonight");
    expect(whenWords(MORNING)).toBe("today");
  });
});

describe("the door post", () => {
  it("says tonight with an evening", () => {
    expect(doorPost({ door: 8, clue1At: EVENING, joinUrl: "https://nbcc.scot/elf" })).toBe(
      "Door 8 of NBCC Elf Detective School opens tonight! The first clue comes out at 5:30pm in Detective HQ, with two more across the evening. Not a detective yet? Join at https://nbcc.scot/elf",
    );
  });

  it("says today and morning for a 10am clue, never tonight", () => {
    const p = doorPost({ door: 5, clue1At: MORNING, joinUrl: "https://nbcc.scot/elf" });
    expect(p).toContain("opens today");
    expect(p).toContain("across the morning");
    expect(p).not.toContain("tonight");
  });
});

// Plan 2c-1, Task 9: a family sees a door's place only once it has had its guess or been there, so the post
// staff copy to social media never names it. It says who found the elf, and, while having a go is open (until
// Christmas Day, ruling F6), that a family that missed it can still crack the case in Detective HQ.
describe("the yesterday post", () => {
  const base = { door: 7 as const, elfName: "Pip", state: "found" as const, finders: [RUBY], foundAt: EVENING, goneHome: false, goesOpen: true };
  const shown = { ...base, state: "revealed" as const, finders: [], foundAt: null };

  it("names the finder publicly, never the place, and says a family that missed it can still crack the case", () => {
    expect(yesterdayPost(base)).toBe("Door 7 is open! Detective R. Tinselfoot found Pip at 5:30pm. Missed it? You can still crack the case in Detective HQ, with one guess.");
  });

  it("uses the full name once a first name is ticked", () => {
    expect(yesterdayPost({ ...base, finders: [LEO] })).toContain("Detective Leo Frostwhistle found Pip");
  });

  it("says the first detective to find a door shown with nobody found still wins the prize", () => {
    expect(yesterdayPost(shown)).toBe(
      "Door 7 is open! Nobody has found Pip yet, so the first detective to find it still wins the prize. Missed it? You can still crack the case in Detective HQ, with one guess.",
    );
  });

  it("is null unless the door is open: while the place is hidden, on a snow day, and before", () => {
    for (const state of ["found-hidden", "snow", "hunting", "shut"] as const) expect(yesterdayPost({ ...base, state }), state).toBeNull();
  });

  // Ruling F6: having a go closes on Christmas Day, when the morning email still posts door 24.
  it("no longer offers to crack the case once having a go has closed", () => {
    expect(yesterdayPost({ ...base, goesOpen: false })).toBe("Door 7 is open! Detective R. Tinselfoot found Pip at 5:30pm.");
    expect(yesterdayPost({ ...shown, goesOpen: false })).toBe("Door 7 is open! Nobody has found Pip yet, so the first detective to find it still wins the prize.");
  });

  // As ruling F8 has it for the calendar: an elf that has gone home can no longer be found.
  it("never says the prize can still be won once the elf has gone home", () => {
    expect(yesterdayPost({ ...shown, goneHome: true })).toBe("Door 7 is open! Nobody found Pip in time. Missed it? You can still crack the case in Detective HQ, with one guess.");
  });

  // As the calendar names a finder it cannot read (DoorView.found.by): a found elf never reads as unfound.
  it("names a finder it cannot read as a detective", () => {
    expect(yesterdayPost({ ...base, finders: [] })).toBe("Door 7 is open! A detective found Pip at 5:30pm. Missed it? You can still crack the case in Detective HQ, with one guess.");
  });

  it("never names the place, whatever it is handed", () => {
    const handed = { ...base, place: PLACE } as Parameters<typeof yesterdayPost>[0];
    for (const o of [handed, { ...handed, state: "revealed" as const, finders: [], foundAt: null }]) {
      expect(yesterdayPost(o)).not.toContain("Pine Cone");
      expect(yesterdayPost(o)).not.toContain("Snowford");
    }
  });
});

describe("the post picture", () => {
  it("is null when there is no committed picture", () => {
    expect(postPicture(2026, 3, "https://nbcc.scot")).toBeNull();
  });
});
