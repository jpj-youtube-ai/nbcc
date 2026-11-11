import { describe, it, expect } from "vitest";
import { ELF_LINKS_AT, elfLinksLive } from "../../src/elf/links-at";

// The moment the main site starts linking to Elf Detective School: 10am UK time on Friday 13 November
// 2026, when the big push starts. Elf Detective School is switched on the evening before, so people with
// the link can look around and enrol, but nothing on the site links to it until then. Pure, so every
// side of the moment is checked here; the pages that wait for it are in elf-promo-routes.test.ts.

/** The moment on a clock in London, part by part. */
const london = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );

describe("the moment the site starts linking to Elf Detective School", () => {
  it("is 10am in London on Friday 13 November 2026, which is 10:00 UTC with the clocks gone back", () => {
    expect(ELF_LINKS_AT.toISOString()).toBe("2026-11-13T10:00:00.000Z");
    expect(london(ELF_LINKS_AT)).toEqual({ weekday: "Friday", day: "13", month: "November", year: "2026", hour: "10", minute: "00" });
  });

  it("has not come a moment before", () => {
    expect(elfLinksLive(new Date("2026-11-11T22:00:00Z"))).toBe(false);
    expect(elfLinksLive(new Date("2026-11-13T09:59:59.999Z"))).toBe(false);
  });

  it("has come on the dot, and stays come", () => {
    expect(elfLinksLive(new Date("2026-11-13T10:00:00.000Z"))).toBe(true);
    expect(elfLinksLive(new Date("2026-12-24T10:00:00Z"))).toBe(true);
  });

  it("has not come for a time that makes no sense, so nothing appears by accident", () => {
    expect(elfLinksLive(new Date("not a time"))).toBe(false);
  });
});
