// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calendarStatus, renderCalendarPage } from "../../src/elf/pages/calendar";
import type { CalendarView } from "../../src/elf/pages/types";
import { AFTERNOON, at, calendarView as view } from "./elf-fixtures";

// NBCC Elf Detective School: the public calendar. Every business and detective here is invented
// (see elf-fixtures.ts).

const page = (v: CalendarView) => new DOMParser().parseFromString(renderCalendarPage(v), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("what Jaimie asked for on 4 October", () => {
  it("tells under 16s to bring a grown up, in How it works", () => {
    const how = new DOMParser().parseFromString(renderCalendarPage(view(AFTERNOON)), "text/html").querySelector(".elf-how")!;
    expect((how.textContent ?? "").replace(/\s+/g, " ")).toContain("Under 16? Bring a grown up with you to every hiding place.");
  });

  it("shows the countdown on today's door on a phone, in place of the word Today", () => {
    const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");
    expect(css).toMatch(/\.elf-door--today\.has-chip \.elf-door__foot \{[^}]*display:\s*inline-flex/);
    expect(css).toMatch(/\.elf-door--today \.elf-door__chip \{[^}]*display:\s*none/);
  });
});

/** The stylesheet with every "prefers-reduced-motion: no-preference" block taken out. */
function stillParts(source: string): string {
  let out = "";
  let from = 0;
  const marker = /@media[^{]*prefers-reduced-motion:\s*no-preference[^{]*\{/g;
  for (let m = marker.exec(source); m; m = marker.exec(source)) {
    out += source.slice(from, m.index);
    let depth = 1;
    let j = m.index + m[0].length;
    for (; j < source.length && depth > 0; j++) depth += source[j] === "{" ? 1 : source[j] === "}" ? -1 : 0;
    from = j;
    marker.lastIndex = j;
  }
  return out + source.slice(from);
}

// Jaimie, approving the paper plan on 4 November 2026: "when you say calendar, it looks like an
// advent calendar." Spec decision 13: one board, the doors cut into it, not a grid of cards.
describe("the advent calendar", () => {
  const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");

  // Jaimie, on the paper pictures (5 November 2026): the painting across the doors looked messy; the
  // calendar is NBCC's rich maroon, one solid colour.
  it("sets all 24 doors into one board of NBCC's solid rich maroon, with no painting across it", () => {
    const board = page(view(AFTERNOON)).querySelector(".elf-advent > #elf-board")!;
    expect(board).not.toBeNull();
    expect(board.querySelectorAll("a.elf-door").length).toBe(24);
    expect(css).not.toMatch(/rooftops|--elf-scene/);
    expect(css).toMatch(/\.elf-advent__card::before \{[^}]*background-color:\s*var\(--maroon\)/);
    expect(css).toMatch(/\.elf-door__flap \{[^}]*background-color:\s*var\(--maroon\)/);
  });

  it("ends with the big double doors in a row of their own", () => {
    const doors = [...page(view(AFTERNOON)).querySelectorAll("#elf-board a.elf-door")];
    expect(doors.map((a) => a.classList.contains("elf-door--double"))).toEqual(doors.map((_, i) => i === 23));
    expect(doors[22].classList.contains("elf-door--wide")).toBe(true);
    expect(css).toMatch(/\.elf-door--double \{[^}]*grid-column:\s*1 \/ -1/);
    expect(css).toMatch(/\.elf-door--wide \{[^}]*grid-column:\s*span 2/);
  });

  it("shows an open door standing open on its hinge, and swings it only for someone happy with motion", () => {
    const still = stillParts(css);
    expect(still).toMatch(/\.elf-door\.is-open \.elf-door__flap \{[^}]*rotateY\(-\d+deg\)/);
    expect(still).not.toMatch(/elf-swing/);
    expect(css).toMatch(/\.elf-door\.is-opening \.elf-door__flap \{[^}]*animation:\s*elf-swing/);
  });

  it("gives a family's own done doors the painted holly", () => {
    expect(css).toMatch(/\.elf-door\.is-done::after \{[^}]*\/assets\/img\/elf\/paper\/deco\/holly\.webp/);
  });
});

describe("the top of the calendar, in paper", () => {
  it("keeps the school's logo as the heading, with a torn label under it for the year's class", () => {
    const doc = page(view(AFTERNOON));
    expect(words(doc.querySelector("h1 + .elf-label"))).toBe("Class of 2026");
    expect(doc.querySelector(".elf-top .eyebrow")).toBeNull();
  });

  it("counts down on the candy cane strip, to the clue and to the first day", () => {
    const strip = page(view(AFTERNOON)).querySelector(".elf-status .elf-cane-strip")!;
    expect(strip.querySelector(".elf-cd")).not.toBeNull();
    expect(words(page(view(at("2026-11-08T09:00:00.000Z"))).querySelector(".elf-status .elf-cane-strip"))).toBe("23 sleeps to go");
  });

  it("puts today's news on a card sheet, and every way in on torn paper buttons", () => {
    const doc = page(view(AFTERNOON));
    expect(doc.querySelector(".elf-status")!.classList.contains("elf-card")).toBe(true);
    expect([...doc.querySelectorAll(".elf-top__actions a")].map((a) => a.className)).toEqual(["elf-btn elf-btn--crimson", "elf-btn"]);
    expect(doc.querySelector('.elf-join a[href="/elf/join"]')!.classList.contains("elf-btn")).toBe(true);
    expect(doc.querySelector(".site-main .btn")).toBeNull();
  });

  it("wears no old pills: the key's big prize is a paper chip", () => {
    const doc = page(view(AFTERNOON));
    expect(doc.querySelector(".elf-pill")).toBeNull();
    expect(words(doc.querySelector(".elf-legend .elf-chip"))).toBe("Big prize");
  });

  it("sets the one safety line on a taped kraft note", () => {
    const line = page(view(AFTERNOON)).querySelector(".elf-grown-up")!;
    expect([...line.classList]).toEqual(["elf-grown-up", "elf-note", "elf-note--kraft"]);
    expect(line.querySelector(".elf-tape")).not.toBeNull();
  });
});

describe("the calendar page", () => {
  it("is a whole page with one heading, the site's styles and its own", () => {
    const doc = page(view(AFTERNOON));
    expect(doc.querySelectorAll("h1").length).toBe(1);
    // The heading is the school's logo, which spells the name out.
    expect(doc.querySelector("h1 img")!.getAttribute("alt")).toBe("NBCC Elf Detective School");
    expect(words(doc.querySelector("h1"))).toBe("");
    expect(doc.title).toBe("Elf Detective School | Night Before Christmas Campaign");
    const sheets = [...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href"));
    expect(sheets).toEqual(["/assets/css/styles.css", "/assets/css/elf.css"]);
    expect(doc.querySelector('script[src="/assets/js/elf-calendar.js"]')).not.toBeNull();
  });

  it("tells the story in one line, with the building spelt the one way", () => {
    expect(words(page(view(AFTERNOON)).querySelector(".lede"))).toBe(
      "24 cheeky elves have escaped from the Elves' Workshop. Find them all by the Night Before Christmas.",
    );
  });

  it("shows all 24 doors in order, each followed by its own detail", () => {
    const board = page(view(AFTERNOON)).querySelector("#elf-board")!;
    const doors = [...board.querySelectorAll("a.elf-door")];
    expect(doors.map((a) => a.getAttribute("data-door"))).toEqual(Array.from({ length: 24 }, (_, i) => String(i + 1)));
    for (const a of doors) {
      const next = a.nextElementSibling!;
      expect(next.id).toBe(`case-${a.getAttribute("data-door")}`);
      expect(a.getAttribute("href")).toBe(`#${next.id}`);
    }
    expect(board.children.length).toBe(48);
  });

  it("tells the script where to ask for news, and nothing private", () => {
    const board = page(view(AFTERNOON)).querySelector("#elf-board")!;
    expect(board.getAttribute("data-feed")).toBe("/api/elf/calendar");
    expect(board.getAttribute("data-door-api")).toBe("/api/elf/door/");
    expect(board.getAttribute("data-me")).toBe("/api/elf/me");
  });

  it("tells the script the time on the server, so a countdown is right even if the phone's clock is wrong", () => {
    expect(page(view(AFTERNOON)).querySelector("#elf-board")!.getAttribute("data-now")).toBe("2026-12-07T15:00:00.000Z");
  });

  it("counts the elves found so far", () => {
    expect(words(page(view(AFTERNOON)).querySelector(".elf-tally"))).toBe("6 of 24 elves found");
    expect(words(page(view(at("2026-12-01T09:00:00.000Z"))).querySelector(".elf-tally"))).toBe("0 of 24 elves found");
  });

  // The places are secret (docs/superpowers/specs/2026-11-03-elf-detective-secret-places-design.md):
  // a place shows only on its own door once that door is open, so the page never lists them.
  it("never lists this year's hiding places", () => {
    const doc = page(view(AFTERNOON));
    expect(doc.querySelector(".elf-places")).toBeNull();
    expect(doc.querySelector(".elf-where")).toBeNull();
    expect(words(doc.body)).not.toContain("hiding places. Which elf is where");
  });

  it("asks people to join, with the price in the words the admin set", () => {
    const join = page(view(AFTERNOON, {}, { price: { from: "£2", suggested: "£6" } })).querySelector(".elf-join")!;
    expect(words(join)).toContain("Pay what you can");
    expect(words(join)).toContain("£6");
    expect(words(join)).toContain("£2");
    expect(join.querySelector('a[href="/elf/join"]')).not.toBeNull();
  });

  it("explains how it works in four steps", () => {
    const steps = page(view(AFTERNOON)).querySelectorAll(".elf-steps > li");
    expect(steps.length).toBe(4);
    expect(words(steps[2])).toContain("secret word");
  });

  it("can be listed by search engines", () => {
    expect(page(view(AFTERNOON)).querySelector('meta[name="robots"]')).toBeNull();
  });
});

describe("today's news at the top of the calendar", () => {
  it("counts the sleeps before the hunt starts", () => {
    const status = calendarStatus(view(at("2026-11-08T09:00:00.000Z")));
    expect(status.title).toBe("The hunt starts on Tuesday 1 December");
    expect(status.html).toContain("23 sleeps to go");
  });

  it("says one sleep, not one sleeps", () => {
    expect(calendarStatus(view(at("2026-11-30T20:00:00.000Z"))).html).toContain("1 sleep to go");
  });

  it("counts down to today's clue", () => {
    const status = calendarStatus(view(AFTERNOON));
    expect(status.title).toBe("Door 7 opens today");
    expect(status.html).toContain("Clue out at 5:30pm");
    expect(status.html).toContain('data-until="2026-12-07T17:30:00.000Z"');
    expect(status.html).toContain("2:30:00");
  });

  it("says the hunt is on, and names the elf but never the place", () => {
    const hunting = view(at("2026-12-07T18:00:00.000Z"), { state: "hunting", place: { name: "The Secret Cinema", town: "Ayr" } });
    const status = calendarStatus(hunting);
    expect(status.title).toBe("The hunt is on!");
    expect(status.html).toContain("Bauble");
    expect(renderCalendarPage(hunting)).not.toContain("Secret Cinema");
  });

  it("says who found today's elf and when the next clue comes", () => {
    const found = view(at("2026-12-07T19:00:00.000Z"), {
      state: "found",
      place: { name: "The Toy Shop", town: "Troon" },
      found: { at: at("2026-12-07T17:52:00.000Z"), by: "Detective Sam Snowsleuth", elfUrl: "/elf/pic/9.svg", photoUrl: null },
      counts: { cracked: 3, visited: 1 },
    });
    const status = calendarStatus(found);
    expect(status.title).toBe("Bauble has been found!");
    expect(status.html).toContain("Detective Sam Snowsleuth");
    expect(status.html).toContain("The Toy Shop, Troon");
    expect(status.html).toContain("Next clue: Tue 8 Dec at 5:30pm");
  });

  it("says a revealed elf is still waiting", () => {
    const revealed = view(at("2026-12-07T21:30:00.000Z"), { state: "revealed", place: { name: "The Toy Shop", town: "Troon" } });
    const status = calendarStatus(revealed);
    expect(status.title).toBe("Bauble is still waiting");
    expect(status.html).toContain("The Toy Shop, Troon");
  });

  it("looks ahead to the next clue on a morning before today's is out, when yesterday's is done", () => {
    const status = calendarStatus(view(at("2026-12-08T08:00:00.000Z")));
    expect(status.title).toBe("Door 8 opens today");
  });

  it("thanks everyone once every door is open", () => {
    const done = view(at("2026-12-25T10:00:00.000Z"));
    done.doors = done.doors.map((d) => ({
      ...d,
      state: "found" as const,
      place: { name: "Shop", town: "Ayr" },
      found: { at: d.clueAt, by: "Detective Ruby Tinselfoot", elfUrl: "/elf/pic/1.svg", photoUrl: null },
      counts: { cracked: 1, visited: 1 },
    }));
    expect(calendarStatus(done).title).toBe("Every elf is home");
  });
});

// Jaimie, on the paper pictures (5 November 2026): on a phone the doors were so small you had to zoom
// to see the picture behind one. Mobile first: big doors, like the wardrobe's door cards.
describe("the advent calendar at every width", () => {
  const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");

  it("hangs two doors to a row on a phone, and more only as the board itself widens", () => {
    expect(css).toMatch(/\.elf-board \{[^}]*--cols:\s*2;/);
    expect(css).toMatch(/\.elf-board \{[^}]*grid-template-columns:\s*repeat\(var\(--cols\), minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@container \(min-width: 480px\) \{\s*\.elf-board \{[^}]*--cols:\s*3;/);
    expect(css).toMatch(/@container \(min-width: 640px\) \{\s*\.elf-board \{[^}]*--cols:\s*4;/);
    expect(css).toMatch(/@container \(min-width: 900px\) \{\s*\.elf-board \{[^}]*--cols:\s*6;/);
    expect(css).not.toMatch(/--cols:\s*8/);
  });

  // The final review (5 November 2026) measured chips covering numbers on the old small doors. Every
  // door is now at least about 140 pixels wide, so its chip has room beside the number at every width.
  it("puts a door's chip beside its number at every width", () => {
    expect(css).not.toMatch(/@media \(min-width: 1180px\) \{[^@]*\.elf-door__chip/);
    expect(css).toMatch(/\n\.elf-door__chip \{[^}]*grid-row: 1;/);
    expect(css).toMatch(/\.elf-door__flap \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it("swings an open door almost flat, so the picture behind it fills the door", () => {
    const swung = stillParts(css).match(/\.elf-door\.is-open \.elf-door__flap \{[^}]*rotateY\(-(\d+)deg\)/);
    expect(Number(swung?.[1])).toBeGreaterThanOrEqual(76);
    expect(css).toMatch(/\.elf-door\.is-open \.elf-shot \{[^}]*object-fit:\s*contain/);
  });
});
