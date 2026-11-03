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
    expect(css).toMatch(/\.elf-door--today\.has-pill \.elf-door__foot \{[^}]*display:\s*block/);
    expect(css).toMatch(/\.elf-door--today \.elf-pill \{[^}]*display:\s*none/);
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
