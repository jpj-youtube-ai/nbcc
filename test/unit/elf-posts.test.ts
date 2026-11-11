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

describe("the yesterday post", () => {
  const base = { door: 7 as const, elfName: "Pip", state: "found" as const, finders: [RUBY], foundAt: EVENING, place: PLACE };

  it("names the finder publicly and the place, for a found door", () => {
    expect(yesterdayPost(base)).toBe(
      "Door 7 is open! Detective R. Tinselfoot found Pip at Pine Cone Café, Snowford at 5:30pm. Pip stays there all December: call in, type the word on the tag for a candy cane stamp, and add your picture to the door.",
    );
  });

  it("uses the full name once a first name is ticked", () => {
    expect(yesterdayPost({ ...base, finders: [LEO] })).toContain("Detective Leo Frostwhistle found Pip");
  });

  it("reads differently for a revealed door", () => {
    expect(yesterdayPost({ ...base, state: "revealed", finders: [], foundAt: null })).toBe(
      "Door 7 is open! Nobody found Pip in time, so Pip is waiting at Pine Cone Café, Snowford. The first detective to type the word on its tag wins the prize.",
    );
  });

  it("is null while the place is hidden, on a snow day and with no place", () => {
    expect(yesterdayPost({ ...base, state: "found-hidden" })).toBeNull();
    expect(yesterdayPost({ ...base, state: "snow" })).toBeNull();
    expect(yesterdayPost({ ...base, place: null })).toBeNull();
  });
});

describe("the post picture", () => {
  it("is null when there is no committed picture", () => {
    expect(postPicture(2026, 3, "https://nbcc.scot")).toBeNull();
  });
});
