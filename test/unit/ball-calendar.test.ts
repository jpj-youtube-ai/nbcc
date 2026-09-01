import { describe, it, expect } from "vitest";
import {
  buildBallCalendar,
  parseArrivalHour,
  icsEscape,
  fold,
} from "../../src/ball/calendar";

// TASK-337: the add-to-calendar file.

const build = (arrivalTime: string | null = null) =>
  buildBallCalendar({
    arrivalTime,
    location: "The Park Hotel, Rugby Park, Kilmarnock",
    url: "https://nbcc.scot/ball",
    uid: "ball-2026@nbcc.scot",
  });

describe("reading a clock time out of what staff typed", () => {
  // Admin holds free text, because the venue confirms late and a date picker cannot express
  // "to be confirmed". The calendar file needs a real hour out of it.
  it.each([
    ["From 7pm, to be confirmed", 19, 0],
    ["7pm", 19, 0],
    ["7.30pm", 19, 30],
    ["7:30pm", 19, 30],
    ["19:00", 19, 0],
    ["Doors 6.45pm", 18, 45],
    ["12pm", 12, 0],
  ])("reads %s as %s:%s", (text, hour, minute) => {
    expect(parseArrivalHour(text)).toEqual({ hour, minute });
  });

  // A bare small number is an evening event. Nobody arrives at a Festive Ball at 7am.
  it("assumes the evening when nobody wrote am or pm", () => {
    expect(parseArrivalHour("7")).toEqual({ hour: 19, minute: 0 });
    expect(parseArrivalHour("7.30")).toEqual({ hour: 19, minute: 30 });
  });

  // Falling back beats guessing: an entry at the advertised hour is recoverable, an entry at the
  // wrong hour sends someone to a hotel at the wrong time and they trust it over the page.
  it.each([[null], [""], ["to be confirmed"], ["99:99"], ["evening"]])(
    "falls back to 7pm for %s",
    (text) => {
      expect(parseArrivalHour(text as string | null)).toEqual({ hour: 19, minute: 0 });
    },
  );

  it("does not read midnight as noon", () => {
    expect(parseArrivalHour("12am")).toEqual({ hour: 0, minute: 0 });
  });
});

describe("escaping, per RFC 5545", () => {
  it("escapes commas and semicolons, which appear in the venue address", () => {
    expect(icsEscape("The Park Hotel, Rugby Park; Kilmarnock")).toBe(
      "The Park Hotel\\, Rugby Park\\; Kilmarnock",
    );
  });

  // Backslash has to go first. Escaping it last would run back over the backslashes the comma
  // and semicolon rules had just introduced and double every one of them.
  it("escapes a backslash without mangling the escapes around it", () => {
    expect(icsEscape("a\\b,c")).toBe("a\\\\b\\,c");
  });

  it("turns real newlines into the literal escape", () => {
    expect(icsEscape("one\ntwo")).toBe("one\\ntwo");
  });
});

describe("line folding", () => {
  it("leaves a short line alone", () => {
    expect(fold("SUMMARY:Ball")).toBe("SUMMARY:Ball");
  });

  it("folds a long line with a leading space, as the spec requires", () => {
    const folded = fold("X:" + "a".repeat(200));
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBe(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
  });

  it("loses nothing when unfolded again", () => {
    const original = "X:" + "abcdefghij".repeat(30);
    const unfolded = fold(original).split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join("");
    expect(unfolded).toBe(original);
  });
});

describe("the file itself", () => {
  const ics = build("From 7pm, to be confirmed");

  it("is a calendar with one event", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  // Some clients reject a file that uses bare newlines, and the failure is silent: the download
  // works and nothing appears in the diary.
  it("uses CRLF everywhere, with no bare newline anywhere", () => {
    expect(ics.split("\r\n").join("")).not.toContain("\n");
  });

  it("puts the ball on the right evening", () => {
    expect(ics).toContain("DTSTART:20261107T190000Z");
    expect(ics).toContain("DTEND:20261108T000000Z");
  });

  it("follows the arrival time staff set", () => {
    expect(build("7.30pm")).toContain("DTSTART:20261107T193000Z");
  });

  it("names the event and the venue", () => {
    expect(ics).toContain("SUMMARY:NBCC Festive Ball 2026");
    expect(ics).toContain("The Park Hotel");
  });

  // Regenerated on every request. A DTSTAMP of "now" makes each download look like an edit of
  // the last one, and some clients will prompt about the change.
  it("is byte-identical when built twice", () => {
    expect(build("7pm")).toBe(build("7pm"));
  });

  it("says the timings are still to be confirmed, like the page does", () => {
    expect(ics).toMatch(/confirmed nearer the night/i);
  });

  it("does not promise drinks it is not giving", () => {
    expect(ics).toMatch(/welcome drink/i);
  });
});
