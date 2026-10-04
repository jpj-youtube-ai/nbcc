// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { doorDetail, doorKind, doorLabel, doorTile, doorVersion } from "../../src/elf/pages/door";
import type { DoorView } from "../../src/elf/pages/types";

// NBCC Elf Detective School: one door of the public calendar and its opened out detail. Every
// business, detective and address here is invented. It is Monday 7 December 2026, at 3pm.

const NOW = new Date("2026-12-07T15:00:00.000Z");
const CTX = { now: NOW, joinUrl: "/elf/join", hqUrl: "/elf/hq" };
const at = (iso: string) => new Date(iso);

function door(over: Partial<DoorView> = {}): DoorView {
  return {
    door: 9,
    state: "shut",
    clueAt: at("2026-12-09T17:30:00.000Z"),
    shapeUrl: null,
    bigPrize: false,
    teaser: null,
    elfName: "Snowdrop",
    place: null,
    found: null,
    counts: null,
    factLine: null,
    ...over,
  };
}

const TODAY = door({ door: 7, clueAt: at("2026-12-07T17:30:00.000Z"), elfName: "Bauble" });
const HUNTING = door({ door: 7, state: "hunting", clueAt: at("2026-12-07T14:00:00.000Z"), elfName: "Bauble" });
const TOMORROW = door({ door: 8, clueAt: at("2026-12-08T17:30:00.000Z"), elfName: "Cracker" });
const FOUND = door({
  door: 4,
  state: "found",
  clueAt: at("2026-12-04T17:30:00.000Z"),
  elfName: "Pudding",
  place: { name: "The Leisure Centre", town: "Irvine" },
  found: { at: at("2026-12-04T17:52:00.000Z"), by: "Detectives Finn Hollyhunt and Mia Gingersnap", elfUrl: "/elf/pic/d-41.svg", photoUrl: null },
  counts: { cracked: 172, visited: 51 },
  factLine: "Every Red Bag says: you have not been forgotten.",
});
const REVEALED = door({
  door: 6,
  state: "revealed",
  clueAt: at("2026-12-06T10:00:00.000Z"),
  elfName: "Holly",
  place: { name: "The Seaside Cafe", town: "Largs" },
  counts: { cracked: 96, visited: 12 },
  factLine: "NBCC helps people all over South West Scotland.",
});

const dom = (html: string) => new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html").getElementById("root")!;
const text = (html: string) => dom(html).textContent!.replace(/\s+/g, " ").trim();

describe("what kind of door it is today", () => {
  it("is found, revealed or hunting when its state says so", () => {
    expect(doorKind(FOUND, NOW)).toBe("found");
    expect(doorKind(REVEALED, NOW)).toBe("revealed");
    expect(doorKind(HUNTING, NOW)).toBe("hunting");
  });

  it("is today, tomorrow or later for a door that is still shut, by the day in London", () => {
    expect(doorKind(TODAY, NOW)).toBe("today");
    expect(doorKind(TOMORROW, NOW)).toBe("tomorrow");
    expect(doorKind(door(), NOW)).toBe("later");
    expect(doorKind(TOMORROW, at("2026-12-07T23:59:00.000Z"))).toBe("tomorrow");
    expect(doorKind(TOMORROW, at("2026-12-08T00:01:00.000Z"))).toBe("today");
  });
});

describe("how a door is read out", () => {
  it("says the day and the time for a door that is still shut", () => {
    expect(doorLabel(door(), NOW)).toBe("Door 9, shut. Clue out Wed 9 Dec at 5:30pm.");
    expect(doorLabel(TOMORROW, NOW)).toBe("Door 8, tomorrow. Clue out at 5:30pm.");
    expect(doorLabel(TODAY, NOW)).toBe("Door 7, today. Clue out at 5:30pm.");
  });

  it("mentions a big prize", () => {
    expect(doorLabel(door({ bigPrize: true }), NOW)).toBe("Door 9, shut. Clue out Wed 9 Dec at 5:30pm. Big prize.");
  });

  it("says the hunt is on, and never where", () => {
    expect(doorLabel(HUNTING, NOW)).toBe("Door 7. The hunt is on.");
  });

  it("says where and who for a found door", () => {
    expect(doorLabel(FOUND, NOW)).toBe(
      "Door 4, found. The Leisure Centre, Irvine. Found by Detectives Finn Hollyhunt and Mia Gingersnap.",
    );
  });

  it("says the elf is still waiting at a revealed door", () => {
    expect(doorLabel(REVEALED, NOW)).toBe("Door 6, not found yet. Holly is waiting at The Seaside Cafe, Largs.");
  });
});

describe("a door on the board", () => {
  it("is a link to its own detail, so it works with no script", () => {
    const a = dom(doorTile(door(), NOW)).querySelector("a")!;
    expect(a.getAttribute("href")).toBe("#case-9");
    expect(a.id).toBe("door-9");
    expect(a.getAttribute("aria-label")).toBe(doorLabel(door(), NOW));
    expect(a.dataset.door).toBe("9");
    expect(a.dataset.kind).toBe("later");
  });

  it("shows its number, the carved shape and its day while it is shut", () => {
    const tile = dom(doorTile(door(), NOW));
    expect(tile.querySelector(".elf-door__num")!.textContent).toBe("9");
    expect(tile.querySelector(".elf-carve")).not.toBeNull();
    expect(tile.querySelector(".elf-pill")).toBeNull();
    expect(text(doorTile(door(), NOW))).toContain("Wed");
  });

  it("carves the mystery star when no shape has been uploaded, and the shape when one has", () => {
    expect(dom(doorTile(door(), NOW)).querySelector(".elf-carve")!.getAttribute("style")).toBeNull();
    const shaped = dom(doorTile(door({ shapeUrl: "/elf/shape/9.png?v=3" }), NOW)).querySelector(".elf-carve")!;
    expect(shaped.getAttribute("style")).toBe("--shape:url('/elf/shape/9.png?v=3')");
  });

  it("falls back to the mystery star for a shape address that is not one of the site's own", () => {
    for (const bad of ["https://example.com/x.png", "//example.com/x.png", "/a.png');background:url('/b", "javascript:alert(1)", ""]) {
      expect(dom(doorTile(door({ shapeUrl: bad }), NOW)).querySelector(".elf-carve")!.getAttribute("style"), bad).toBeNull();
    }
  });

  it("wears a pill for today, tomorrow, the hunt and a big prize", () => {
    const pill = (d: DoorView) => dom(doorTile(d, NOW)).querySelector(".elf-pill")?.textContent ?? null;
    expect(pill(TODAY)).toBe("Today");
    expect(pill(TOMORROW)).toBe("Tomorrow");
    expect(pill(HUNTING)).toBe("Hunt on");
    expect(pill(door({ bigPrize: true }))).toBe("Big prize");
    expect(pill(door({ door: 8, clueAt: TOMORROW.clueAt, bigPrize: true }))).toBe("Tomorrow");
  });

  it("counts down to today's clue", () => {
    const cd = dom(doorTile(TODAY, NOW)).querySelector(".elf-cd")!;
    expect(cd.textContent).toBe("2:30:00");
    expect(cd.getAttribute("data-until")).toBe("2026-12-07T17:30:00.000Z");
  });

  it("opens to the winner's elf, the place and a Found pill", () => {
    const tile = dom(doorTile(FOUND, NOW));
    const a = tile.querySelector("a")!;
    expect(a.classList.contains("is-open")).toBe(true);
    expect(tile.querySelector(".elf-pill")!.textContent).toBe("Found");
    const img = tile.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/elf/pic/d-41.svg");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("width")).not.toBeNull();
    expect(img.getAttribute("height")).not.toBeNull();
    expect(text(doorTile(FOUND, NOW))).toContain("The Leisure Centre");
    expect(tile.querySelector(".elf-carve")).toBeNull();
  });

  it("shows the winner's photo instead once there is one", () => {
    const withPhoto = { ...FOUND, found: { ...FOUND.found!, photoUrl: "/elf/photo/88.jpg" } };
    expect(dom(doorTile(withPhoto, NOW)).querySelector("img")!.getAttribute("src")).toBe("/elf/photo/88.jpg");
  });

  it("opens a revealed door too, with the place and the elf still to find", () => {
    const tile = dom(doorTile(REVEALED, NOW));
    expect(tile.querySelector("a")!.classList.contains("is-open")).toBe(true);
    expect(tile.querySelector(".elf-pill")!.textContent).toBe("Still here");
    expect(text(doorTile(REVEALED, NOW))).toContain("The Seaside Cafe");
  });

  it("never names the place while the door is shut or the elf is hunted, even if it is given one", () => {
    const leaky = { place: { name: "The Secret Cinema", town: "Ayr" } };
    for (const d of [door(leaky), { ...TODAY, ...leaky }, { ...HUNTING, ...leaky }]) {
      expect(doorTile(d, NOW)).not.toContain("Secret Cinema");
      expect(doorDetail(d, CTX)).not.toContain("Secret Cinema");
      expect(doorLabel(d, NOW)).not.toContain("Secret Cinema");
    }
  });

  it("escapes everything that comes from data", () => {
    const nasty = door({
      state: "found",
      elfName: "<b>Elf</b>",
      place: { name: '<img src=x onerror="alert(1)">', town: "A&B" },
      found: { at: NOW, by: "<script>alert(1)</script>", elfUrl: '/elf/pic/x.svg"><script>', photoUrl: null },
      counts: { cracked: 1, visited: 1 },
      factLine: "<i>fact</i>",
      teaser: "<u>tease</u>",
    });
    for (const html of [doorTile(nasty, NOW), doorDetail(nasty, CTX)]) {
      const root = dom(html);
      expect(root.querySelector("script, i, u")).toBeNull();
      // The only bold words are the screen's own, never the elf's name from the data.
      expect([...root.querySelectorAll("b")].map((b) => b.textContent)).not.toContain("Elf");
      expect(root.querySelectorAll("img").length).toBe(0);
      expect(root.querySelector("[onerror]")).toBeNull();
      expect(root.textContent).toContain("<img src=x");
    }
  });
});

describe("a door's detail", () => {
  it("is a section the door points at, with the door's heading", () => {
    const section = dom(doorDetail(door(), CTX)).querySelector("section")!;
    expect(section.id).toBe("case-9");
    expect(section.classList.contains("elf-detail")).toBe(true);
    const heading = section.querySelector("h3")!;
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("tells a shut door's day and time, and invites a guess at the carving", () => {
    const words = text(doorDetail(door(), CTX));
    expect(words).toContain("Door 9");
    expect(words).toContain("Still shut");
    expect(words).toContain("Clue out Wed 9 Dec at 5:30pm");
    expect(words).toContain("Can you guess the prize?");
  });

  it("teases tomorrow's prize and a big prize in the staff's own words", () => {
    expect(text(doorDetail(TOMORROW, CTX))).toContain("Tomorrow's prize");
    const big = text(doorDetail(door({ bigPrize: true, teaser: "Something with two wheels" }), CTX));
    expect(big).toContain("One of our biggest prizes");
    expect(big).toContain("Something with two wheels");
  });

  it("keeps a big prize's ribbon words and teaser on its own day, shut or hunted", () => {
    const big = { bigPrize: true, teaser: "Something with two wheels" };
    expect(doorLabel({ ...HUNTING, ...big }, NOW)).toBe("Door 7. The hunt is on. Big prize.");
    for (const d of [TODAY, HUNTING]) {
      const said = text(doorDetail({ ...d, ...big }, CTX));
      expect(said).toContain("Big prize: Something with two wheels");
      expect(text(doorDetail(d, CTX))).not.toContain("Big prize");
    }
  });

  it("still draws a door whose clue time is not a real date, with no countdown", () => {
    const broken = door({ door: 7, clueAt: new Date("not a date"), elfName: "Bauble" });
    expect(() => doorTile(broken, NOW)).not.toThrow();
    expect(() => doorDetail(broken, CTX)).not.toThrow();
    expect(doorTile(broken, NOW)).not.toContain("elf-cd");
  });

  it("counts down to today's clue and explains the race", () => {
    const html = doorDetail(TODAY, CTX);
    expect(text(html)).toContain("Today's elf is hiding");
    expect(text(html)).toContain("Clue out at 5:30pm");
    expect(dom(html).querySelector(".elf-cd")!.textContent).toBe("2:30:00");
    expect(text(html)).toContain("secret word");
  });

  it("says the hunt is on and sends detectives to their clue", () => {
    const html = doorDetail(HUNTING, CTX);
    expect(text(html)).toContain("The hunt is on");
    expect(text(html)).toContain("Bauble");
    expect(dom(html).querySelector('a[href="/elf/hq"]')).not.toBeNull();
    expect(dom(html).querySelector('a[href="/elf/join"]')).not.toBeNull();
  });

  it("tells the whole story of a found door", () => {
    const html = doorDetail(FOUND, CTX);
    const words = text(html);
    expect(words).toContain("Door 4");
    expect(words).toContain("Fri 4 Dec");
    expect(words).toContain("found at 5:52pm");
    expect(dom(html).querySelector("h3")!.textContent).toBe("The Leisure Centre, Irvine");
    expect(words).toContain("Found first by Detectives Finn Hollyhunt and Mia Gingersnap");
    expect(words).toContain("172 detectives cracked this case");
    expect(words).toContain("51 have been there since");
    expect(words).toContain("Every Red Bag says: you have not been forgotten.");
  });

  it("says one detective, not one detectives", () => {
    const one = { ...FOUND, counts: { cracked: 1, visited: 1 } };
    const words = text(doorDetail(one, CTX));
    expect(words).toContain("1 detective cracked this case");
    expect(words).toContain("1 has been there since");
  });

  it("says a revealed elf is still there to be won", () => {
    const words = text(doorDetail(REVEALED, CTX));
    expect(words).toContain("The Seaside Cafe, Largs");
    expect(words).toContain("Holly is still waiting");
    expect(words).toContain("first detective");
  });

  it("leaves a place for the family's own marks, which the page's script fills in", () => {
    expect(dom(doorDetail(FOUND, CTX)).querySelector(".elf-detail__mine")).not.toBeNull();
    expect(dom(doorTile(FOUND, NOW)).querySelector(".elf-door__marks")).not.toBeNull();
  });
});

describe("a door's version for the live feed", () => {
  it("changes when the door changes state, is found, or gains a photo", () => {
    const versions = [
      doorVersion(TODAY, NOW),
      doorVersion(HUNTING, NOW),
      doorVersion({ ...FOUND, door: 7 }, NOW),
      doorVersion({ ...FOUND, door: 7, found: { ...FOUND.found!, photoUrl: "/elf/photo/88.jpg" } }, NOW),
      doorVersion({ ...REVEALED, door: 7 }, NOW),
    ];
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("changes when tomorrow becomes today, and not otherwise as time passes", () => {
    expect(doorVersion(TOMORROW, NOW)).toBe(doorVersion(TOMORROW, at("2026-12-07T23:00:00.000Z")));
    expect(doorVersion(TOMORROW, NOW)).not.toBe(doorVersion(TOMORROW, at("2026-12-08T00:01:00.000Z")));
  });

  it("is short, and safe to put in a page", () => {
    for (const d of [TODAY, HUNTING, FOUND, REVEALED]) expect(doorVersion(d, NOW)).toMatch(/^[a-z0-9]{1,16}$/);
  });
});
