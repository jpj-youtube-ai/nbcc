// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { doorDetail, doorKind, doorLabel, doorTile, doorVersion, type DoorKind } from "../../src/elf/pages/door";
import type { DoorView } from "../../src/elf/pages/types";
import type { Scrapbook } from "../../src/elf/scrapbook";

// NBCC Elf Detective School: one door of the public calendar and its opened out detail. Every
// business, detective, prize and address here is invented. It is Monday 7 December 2026, at 3pm.

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
    prize: null,
    elfName: "Snowdrop",
    place: null,
    found: null,
    revealAt: null,
    counts: null,
    scrapbook: null,
    collage: [],
    goneHome: false,
    factLine: null,
    // December's doors on, as every state but a shut one needs.
    doorsOn: true,
    ...over,
  };
}

// The detectives on door 4: Finn and Mia found its elf together; Ruby (whose first name staff have not
// ticked yet) and Leo came after.
const FINN = { firstName: "Finn", surname: "Hollyhunt", approved: true };
const MIA = { firstName: "Mia", surname: "Gingersnap", approved: true };
const RUBY = { firstName: "Ruby", surname: "Tinselfoot", approved: false };
const LEO = { firstName: "Leo", surname: "Frostwhistle", approved: true };

/** Door 4's scrapbook: the finders' two elves, two more families' elves, and two photos in the
 *  shuffled order the server gives. */
const BOOK: Scrapbook = {
  elves: [
    { visitId: 41, detective: FINN, countsFrom: at("2026-12-04T19:00:00.000Z"), found: true, pictureUrl: "/elf/door/4/elf/41.png" },
    { visitId: 42, detective: MIA, countsFrom: at("2026-12-04T19:00:00.000Z"), found: true, pictureUrl: "/elf/door/4/elf/42.png" },
    { visitId: 43, detective: RUBY, countsFrom: at("2026-12-05T10:15:00.000Z"), found: false, pictureUrl: "/elf/door/4/elf/43.png" },
    { visitId: 44, detective: LEO, countsFrom: at("2026-12-05T11:00:00.000Z"), found: false, pictureUrl: "/elf/door/4/elf/44.png" },
  ],
  photos: [
    { token: "r8t2v6y3z5bc", url: "/elf/door/4/photo/r8t2v6y3z5bc.jpg" },
    { token: "k3m9p2x7w4qa", url: "/elf/door/4/photo/k3m9p2x7w4qa.jpg" },
  ],
  count: 6,
};
const PHOTO_URLS = BOOK.photos.map((p) => p.url);
const ELF_URLS = BOOK.elves.map((e) => e.pictureUrl);

const TODAY = door({ door: 7, clueAt: at("2026-12-07T17:30:00.000Z"), elfName: "Bauble" });
const HUNTING = door({ door: 7, state: "hunting", clueAt: at("2026-12-07T14:00:00.000Z"), elfName: "Bauble" });
const TOMORROW = door({ door: 8, clueAt: at("2026-12-08T17:30:00.000Z"), elfName: "Cracker" });
const FOUND_HIDDEN = door({
  door: 7,
  state: "found-hidden",
  clueAt: at("2026-12-07T17:30:00.000Z"),
  elfName: "Bauble",
  found: { at: at("2026-12-07T17:47:00.000Z"), by: "Detective R. Tinselfoot" },
  revealAt: at("2026-12-07T19:00:00.000Z"),
});
const SNOW = door({ door: 7, state: "snow", clueAt: at("2026-12-07T17:30:00.000Z"), elfName: "Bauble" });
const FOUND = door({
  door: 4,
  state: "found",
  clueAt: at("2026-12-04T17:30:00.000Z"),
  elfName: "Pudding",
  place: { name: "The Leisure Centre", town: "Irvine" },
  found: { at: at("2026-12-04T17:52:00.000Z"), by: "Detectives Finn Hollyhunt and Mia Gingersnap" },
  prize: "A pretend family trip to the pantomime",
  scrapbook: BOOK,
  collage: ELF_URLS.slice(0, 3),
  counts: { cracked: 172, visited: 51 },
  factLine: "Every Red Bag says: you have not been forgotten.",
});
const REVEALED = door({
  door: 6,
  state: "revealed",
  clueAt: at("2026-12-06T10:00:00.000Z"),
  elfName: "Holly",
  place: { name: "The Seaside Cafe", town: "Largs" },
  scrapbook: { elves: [], photos: [], count: 0 },
  counts: { cracked: 96, visited: 12 },
  factLine: "NBCC helps people all over South West Scotland.",
});

const dom = (html: string) => new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html").getElementById("root")!;
const text = (html: string) => dom(html).textContent!.replace(/\s+/g, " ").trim();
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("what kind of door it is today", () => {
  it("is found, found with its place hidden, revealed, a snow day or hunting when its state says so", () => {
    expect(doorKind(FOUND, NOW)).toBe("found");
    expect(doorKind(FOUND_HIDDEN, NOW)).toBe("found-hidden");
    expect(doorKind(REVEALED, NOW)).toBe("revealed");
    expect(doorKind(SNOW, NOW)).toBe("snow");
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

  it("says who found an elf whose place is still hidden, and when the place is shown", () => {
    expect(doorLabel(FOUND_HIDDEN, NOW)).toBe("Door 7, found. Found by Detective R. Tinselfoot. The hiding place is shown at 7pm.");
  });

  it("says a snow day's elf got snowed in", () => {
    expect(doorLabel(SNOW, NOW)).toBe("Door 7, snow day. Bauble got snowed in.");
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

// Review focus 3: GET /api/elf/door/:n and the feed carry the tile and the detail, so a door that is
// not open must never carry its place, its scrapbook or a photo, whatever the view holds.
describe("a door that is not open, over every kind", () => {
  const LEAKY: Partial<DoorView> = {
    place: { name: "The Secret Cinema", town: "Ayr" },
    scrapbook: BOOK,
    collage: ELF_URLS.slice(0, 3),
    prize: "A pretend secret prize",
    counts: { cracked: 3, visited: 2 },
    factLine: "Practice clue 1: it lives where the kettle lives",
  };
  /** Each kind of door that is not open, as the view gives it. */
  const KINDS: [DoorKind, DoorView][] = [
    ["later", door()],
    ["tomorrow", TOMORROW],
    ["today", TODAY],
    ["hunting", HUNTING],
    ["found-hidden", FOUND_HIDDEN],
    ["snow", SNOW],
  ];

  it.each(KINDS)("%s: never shows the place, the scrapbook, a photo, the counts or the fact", (kind, base) => {
    const d = { ...base, ...LEAKY };
    expect(doorKind(d, NOW)).toBe(kind);
    // Not even in its version: the feed would change when a hidden field did.
    expect(doorVersion(d, NOW)).toBe(doorVersion(base, NOW));
    for (const said of [doorTile(d, NOW), doorDetail(d, CTX), doorLabel(d, NOW)]) {
      expect(said).not.toContain("Secret Cinema");
      expect(said).not.toMatch(/photo/i);
      for (const url of [...ELF_URLS, ...PHOTO_URLS]) expect(said).not.toContain(url);
      expect(said).not.toContain("kettle");
      expect(said).not.toContain("secret prize");
      expect(said).not.toContain("cracked this case");
      expect(said).not.toMatch(/elf-room|elf-book|elf-pol/);
    }
  });

  it("and the two open kinds do show their place", () => {
    for (const d of [{ ...FOUND, ...LEAKY, state: "found" as const }, { ...REVEALED, ...LEAKY }]) {
      expect(doorTile(d, NOW)).toContain("Secret Cinema");
      expect(doorDetail(d, CTX)).toContain("Secret Cinema");
    }
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

  it("shows its number, the shape cut out of it and its day while it is shut", () => {
    const tile = dom(doorTile(door(), NOW));
    expect(tile.querySelector(".elf-door__num")!.textContent).toBe("9");
    expect(tile.querySelector(".elf-carve")).not.toBeNull();
    expect(tile.querySelector(".elf-door__chip")).toBeNull();
    expect(text(doorTile(door(), NOW))).toContain("Wed");
  });

  // The advent calendar (Jaimie, 4 November 2026: "when you say calendar, it looks like an advent
  // calendar"): every door is cut into the one painted board, as a card door on a hinge.
  it("is a card door on a hinge, with a paper pull tab and its number printed on it", () => {
    for (const d of [door(), TODAY, HUNTING, TOMORROW, FOUND_HIDDEN, SNOW, FOUND, REVEALED]) {
      const a = dom(doorTile(d, NOW)).querySelector("a")!;
      const flaps = a.querySelectorAll(":scope > .elf-door__flap");
      expect(flaps.length, `door ${d.door}`).toBe(1);
      expect(flaps[0].getAttribute("aria-hidden")).toBe("true");
      expect(flaps[0].querySelectorAll(".elf-door__tab").length).toBe(1);
      expect(flaps[0].querySelector(".elf-door__num")!.textContent).toBe(String(d.door));
    }
  });

  // Jaimie, 5 November 2026: the board is solid maroon now, so a door no longer carries a piece of a
  // painting, and needs no place in one.
  it("carries no piece of a painting", () => {
    expect(dom(doorTile(door(), NOW)).querySelector("a")!.hasAttribute("style")).toBe(false);
  });

  it("is bright while it is shut, never faint, with its day on a paper chip", () => {
    for (const d of [door(), TOMORROW]) {
      const a = dom(doorTile(d, NOW)).querySelector("a")!;
      expect(a.className).not.toMatch(/faint|dim|muted|locked/);
      expect(a.querySelector(".elf-door__date")!.classList.contains("elf-chip")).toBe(true);
    }
    expect(dom(doorTile(door(), NOW)).querySelector(".elf-door__date")!.textContent).toBe("Wed 5:30pm");
  });

  it("stands open on its hinge once its place is shown, and is shut before, a snow day and a hidden find too", () => {
    const open = (d: DoorView) => dom(doorTile(d, NOW)).querySelector("a")!.classList.contains("is-open");
    expect([FOUND, REVEALED].map(open)).toEqual([true, true]);
    expect([door(), TODAY, HUNTING, TOMORROW, FOUND_HIDDEN, SNOW].map(open)).toEqual([false, false, false, false, false, false]);
  });

  it("glows gold with the painted bow on today's door, while its elf is hunted, and while its find is hidden", () => {
    for (const d of [TODAY, HUNTING, FOUND_HIDDEN]) {
      const a = dom(doorTile(d, NOW)).querySelector("a")!;
      expect(a.classList.contains("elf-door--gold")).toBe(true);
      const bow = a.querySelector("img.elf-door__bow")!;
      expect(bow.getAttribute("src")).toBe("/assets/img/elf/paper/deco/bow-gold.webp");
      expect(bow.getAttribute("alt")).toBe("");
      expect([bow.getAttribute("width"), bow.getAttribute("height")]).toEqual(["480", "361"]);
    }
    for (const d of [door(), TOMORROW, SNOW, FOUND, REVEALED]) {
      const a = dom(doorTile(d, NOW)).querySelector("a")!;
      expect(a.classList.contains("elf-door--gold")).toBe(false);
      expect(a.querySelector(".elf-door__bow")).toBeNull();
    }
  });

  it("makes door 24 the big double doors and door 23 a wide door, and every other door a single one", () => {
    const big = dom(doorTile(door({ door: 24, clueAt: at("2026-12-24T10:00:00.000Z") }), NOW)).querySelector("a")!;
    expect(big.classList.contains("elf-door--double")).toBe(true);
    const flaps = [...big.querySelectorAll(":scope > .elf-door__flap")];
    expect(flaps.map((f) => [...f.classList].filter((c) => c.startsWith("elf-door__flap--")))).toEqual([["elf-door__flap--left"], ["elf-door__flap--right"]]);
    for (const f of flaps) expect(f.querySelectorAll(".elf-door__tab").length).toBe(1);
    expect(big.querySelectorAll(".elf-door__num").length).toBe(1);
    expect(dom(doorTile(door({ door: 23 }), NOW)).querySelector("a")!.classList.contains("elf-door--wide")).toBe(true);
    for (const n of [1, 9, 22]) {
      const a = dom(doorTile(door({ door: n }), NOW)).querySelector("a")!;
      expect(a.classList.contains("elf-door--wide") || a.classList.contains("elf-door--double"), `door ${n}`).toBe(false);
    }
  });

  it("carves the stylesheet's present when a door has no shape of its own, and the shape when one has", () => {
    expect(dom(doorTile(door(), NOW)).querySelector(".elf-carve")!.getAttribute("style")).toBeNull();
    const shaped = dom(doorTile(door({ shapeUrl: "/elf/shape/9.png?v=3" }), NOW)).querySelector(".elf-carve")!;
    expect(shaped.getAttribute("style")).toBe("--shape:url('/elf/shape/9.png?v=3')");
  });

  it("falls back to the stylesheet's present for a shape address that is not one of the site's own", () => {
    for (const bad of ["https://example.com/x.png", "//example.com/x.png", "/a.png');background:url('/b", "javascript:alert(1)", ""]) {
      expect(dom(doorTile(door({ shapeUrl: bad }), NOW)).querySelector(".elf-carve")!.getAttribute("style"), bad).toBeNull();
    }
  });

  it("wears a paper chip for today, tomorrow, the hunt, a hidden find, a snow day, a revealed elf and a big prize", () => {
    const chip = (d: DoorView) => dom(doorTile(d, NOW)).querySelector(".elf-door__chip");
    const said = (d: DoorView) => chip(d)?.textContent ?? null;
    expect(said(TODAY)).toBe("Today");
    expect(said(TOMORROW)).toBe("Tomorrow");
    expect(said(HUNTING)).toBe("Hunt on");
    expect(said(FOUND_HIDDEN)).toBe("Found");
    expect(said(SNOW)).toBe("Snow day");
    expect(said(REVEALED)).toBe("Still here");
    expect(said(door({ bigPrize: true }))).toBe("Big prize");
    expect(said(door({ door: 8, clueAt: TOMORROW.clueAt, bigPrize: true }))).toBe("Tomorrow");
    for (const d of [TODAY, TOMORROW, HUNTING, FOUND_HIDDEN, SNOW, REVEALED]) expect(chip(d)!.classList.contains("elf-chip")).toBe(true);
    for (const d of [TODAY, HUNTING, FOUND]) expect(dom(doorTile(d, NOW)).querySelector(".elf-pill")).toBeNull();
  });

  it("counts down to today's clue", () => {
    const cd = dom(doorTile(TODAY, NOW)).querySelector(".elf-cd")!;
    expect(cd.textContent).toBe("2:30:00");
    expect(cd.getAttribute("data-until")).toBe("2026-12-07T17:30:00.000Z");
  });

  it("escapes everything that comes from data", () => {
    const nasty = door({
      state: "found",
      elfName: "<b>Elf</b>",
      place: { name: '<img src=x onerror="alert(1)">', town: "A&B" },
      found: { at: NOW, by: "<script>alert(1)</script>" },
      prize: "<i>prize</i>",
      collage: ['/elf/pic/x.svg"><script>'],
      scrapbook: {
        elves: [{ visitId: 1, detective: { firstName: "<u>Rubes</u>", surname: "<b>Tinselfoot</b>", approved: true }, countsFrom: NOW, found: true, pictureUrl: '/elf/x.png"><script>' }],
        photos: [{ token: '"><i>x', url: "javascript:alert(1)" }],
        count: 2,
      },
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
    // A name that fails the checks is never shown at all.
    expect(text(doorDetail(nasty, CTX))).toContain("A detective");
    expect(doorDetail(nasty, CTX)).not.toContain("Rubes");
  });
});

describe("an open door on the board", () => {
  it("shows the room behind it: up to three elves from its collage, never a photo, and how many pictures", () => {
    const many = { ...FOUND, collage: [...ELF_URLS, "/elf/door/4/elf/45.png"] };
    const room = dom(doorTile(many, NOW)).querySelector(".elf-room")!;
    const pics = [...room.querySelectorAll("img")];
    expect(pics.map((img) => img.getAttribute("src"))).toEqual(ELF_URLS.slice(0, 3));
    for (const img of pics) {
      expect(img.closest(".elf-room__pics .elf-mini")).not.toBeNull();
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("width")).toMatch(/^\d+$/);
      expect(img.getAttribute("height")).toMatch(/^\d+$/);
    }
    expect(room.querySelector(".elf-room__count")!.textContent).toBe("6");
    expect(room.querySelector(".elf-room__count")!.classList.contains("elf-chip")).toBe(true);
    for (const url of PHOTO_URLS) expect(doorTile(many, NOW)).not.toContain(url);
    expect(doorTile(many, NOW)).not.toMatch(/photo/i);
  });

  it("shows one elf on its own when that is all it has", () => {
    const one = { ...FOUND, collage: [ELF_URLS[0]], scrapbook: { elves: BOOK.elves.slice(0, 1), photos: [], count: 1 } };
    const room = dom(doorTile(one, NOW)).querySelector(".elf-room")!;
    expect(room.querySelectorAll(".elf-mini").length).toBe(1);
    expect(room.querySelector(".elf-room__count")!.textContent).toBe("1");
  });

  it("names its place in the room, with its number, behind the door that has swung away", () => {
    const tile = dom(doorTile(FOUND, NOW));
    expect(words(tile.querySelector(".elf-room .elf-door__place"))).toBe("The Leisure Centre");
    expect(words(tile.querySelector(".elf-room__num"))).toBe("4");
    // Behind the door, not on it.
    expect(tile.querySelector(".elf-door__flap .elf-room, .elf-door__flap .elf-mini, .elf-door__flap .elf-door__chip")).toBeNull();
    expect(tile.querySelector(".elf-carve")).toBeNull();
  });

  it("shows the prize's shape behind a revealed door with no elves yet, and that the elf is still here", () => {
    const tile = dom(doorTile(REVEALED, NOW));
    expect(tile.querySelector("a")!.classList.contains("is-open")).toBe(true);
    expect(tile.querySelector(".elf-room .elf-carve")).not.toBeNull();
    expect(tile.querySelector(".elf-room img")).toBeNull();
    // Nothing to count yet.
    expect(tile.querySelector(".elf-room__count")).toBeNull();
    expect(text(doorTile(REVEALED, NOW))).toContain("The Seaside Cafe");
  });

  it("leaves a place for the family's own marks, which the page's script fills in", () => {
    expect(dom(doorTile(FOUND, NOW)).querySelector(".elf-door__marks")).not.toBeNull();
    expect(dom(doorTile(TODAY, NOW)).querySelector(".elf-door__marks")).not.toBeNull();
  });
});

describe("a door whose elf is found while its place is still hidden", () => {
  const SIX_10 = at("2026-12-07T18:10:00.000Z");

  it("stays shut and gold, with a Found chip and who found it at its foot", () => {
    const tile = dom(doorTile(FOUND_HIDDEN, SIX_10));
    expect(tile.querySelector("a")!.classList.contains("is-open")).toBe(false);
    expect(words(tile.querySelector(".elf-door__chip"))).toBe("Found");
    expect(words(tile.querySelector(".elf-door__foot"))).toBe("Found by Detective R. Tinselfoot");
    expect(tile.querySelector(".elf-door__flap .elf-carve")).not.toBeNull();
  });

  it("says who found it and when, when the place is shown, and that the guessing goes on", () => {
    const html = doorDetail(FOUND_HIDDEN, { ...CTX, now: SIX_10 });
    expect(words(dom(html).querySelector("h3"))).toBe("Bauble has been found!");
    expect(text(html)).toContain("Found by Detective R. Tinselfoot at 5:47pm. The hiding place is shown at 7pm.");
    expect(text(html)).toContain("Clues are still coming out in Detective HQ, and you can still lock in your guess.");
    expect(dom(html).querySelector('a[href="/elf/hq"]')).not.toBeNull();
  });
});

describe("a snow day", () => {
  it("wears a Snow day chip and a paper snowflake, and stays shut", () => {
    const tile = dom(doorTile(SNOW, NOW));
    expect(words(tile.querySelector(".elf-door__chip"))).toBe("Snow day");
    expect(tile.querySelector(".elf-door__face .elf-snowflake")).not.toBeNull();
    expect(tile.querySelector("img")).toBeNull();
    expect(tile.querySelector("a")!.classList.contains("is-open")).toBe(false);
  });

  it("says its elf got snowed in, and that the door counts as done for everyone", () => {
    const html = doorDetail(SNOW, CTX);
    expect(words(dom(html).querySelector("h3"))).toBe("Bauble got snowed in");
    expect(text(html)).toContain("This door could not open today, so it counts as done for every detective. The hunt goes on tomorrow.");
    expect(dom(html).querySelector(".elf-snowflake")).not.toBeNull();
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

  it("is a taped note, whatever the door is doing", () => {
    for (const d of [door(), TODAY, HUNTING, FOUND_HIDDEN, SNOW, FOUND, REVEALED]) {
      const section = dom(doorDetail(d, CTX)).querySelector("section")!;
      expect(section.classList.contains("elf-note"), `door ${d.door}`).toBe(true);
      expect(section.querySelector(":scope > .elf-tape")!.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("tells a shut door's day and time, and invites a guess at the shape cut out of the door", () => {
    const said = text(doorDetail(door(), CTX));
    expect(said).toContain("Door 9");
    expect(said).toContain("Still shut");
    expect(said).toContain("Clue out Wed 9 Dec at 5:30pm");
    expect(said).toContain("Look at the shape cut out of the door. Can you guess the prize?");
  });

  it("shows a big prize on a paper chip, and its way to the clue on a torn paper button", () => {
    const big = dom(doorDetail({ ...HUNTING, bigPrize: true, teaser: "Something with two wheels" }, CTX));
    expect(big.querySelector(".elf-pill")).toBeNull();
    expect(big.querySelector(".elf-chip")!.textContent).toBe("Big prize");
    expect(big.querySelector('a[href="/elf/hq"]')!.className).toBe("elf-btn elf-btn--crimson elf-btn--s");
    expect(big.querySelector(".btn")).toBeNull();
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

  it("counts down to today's clue and explains the race and the guess", () => {
    const html = doorDetail(TODAY, CTX);
    expect(text(html)).toContain("Today's elf is hiding");
    expect(text(html)).toContain("Clue out at 5:30pm");
    expect(dom(html).querySelector(".elf-cd")!.textContent).toBe("2:30:00");
    // Decision 1: the finder wins the prize, and the elf stays at its place (final review, Important 7).
    expect(text(html)).toContain(
      "Then the race is on. The first detective to find the elf and type the word on its tag wins the prize. The elf stays there for everyone else to find.",
    );
    expect(text(html)).not.toContain("wins it");
    // A guess counts until the hiding place is shown, not until the elf is found.
    expect(text(html)).toContain("Type in your guess at Detective HQ before the hiding place is shown. Get it right and you have cracked the case.");
    expect(text(html)).not.toContain("before anyone finds it");
  });

  // Final review, Important 7: with December's doors off nothing a family sees may differ from wave 1,
  // and today's door shows on the calendar then too.
  it("reads exactly as wave 1's today's door did while December's doors are off", () => {
    const html = doorDetail({ ...TODAY, doorsOn: false }, CTX);
    expect(text(html)).toContain("Then the race is on. The first detective to find the elf and read its secret word wins it.");
    expect(text(html)).toContain("Lock in your guess before anyone finds it to crack the case.");
    expect(text(html)).not.toContain("Type in your guess");
    expect(text(html)).not.toContain("wins the prize");
    // Every other part of it is the same as with the doors on.
    expect(dom(html).querySelector(".elf-cd")!.textContent).toBe("2:30:00");
    expect(dom(html).querySelector('a[href="/elf/hq"]')).not.toBeNull();
  });

  it("says the hunt is on and sends detectives to their clue", () => {
    const html = doorDetail(HUNTING, CTX);
    expect(text(html)).toContain("The hunt is on");
    expect(text(html)).toContain("Bauble");
    expect(dom(html).querySelector('a[href="/elf/hq"]')).not.toBeNull();
    expect(dom(html).querySelector('a[href="/elf/join"]')).not.toBeNull();
  });

  // Final review, Important 7, decision 1: the finder wins the prize; the elf stays at its place.
  it("says the first detective to type the word wins the prize, and the elf stays there", () => {
    const said = text(doorDetail(HUNTING, CTX));
    expect(said).toContain("The first detective to find the elf and type the word on its tag wins the prize. Bauble stays there for everyone else to find.");
    expect(said).not.toContain("wins it");
  });

  it("leaves a place for the family's own line, which the page's script fills in", () => {
    expect(dom(doorDetail(FOUND, CTX)).querySelector(".elf-detail__mine")).not.toBeNull();
  });
});

describe("an open door's scrapbook", () => {
  const book = (d: DoorView = FOUND) => dom(doorDetail(d, CTX));

  it("is headed with the door, its day and its place", () => {
    const b = book();
    expect(b.querySelector("section")!.classList.contains("elf-book")).toBe(true);
    expect(words(b.querySelector(".elf-detail__meta"))).toBe("Door 4 · Friday 4 December");
    expect(words(b.querySelector("h3"))).toBe("The Leisure Centre, Irvine");
  });

  it("says who found the elf and when, beside a paper rosette", () => {
    const found = book().querySelector(".elf-book__found")!;
    expect(words(found)).toContain("Found by Detectives Finn Hollyhunt and Mia Gingersnap at 5:52pm");
    expect(found.querySelector(".elf-rosette")).not.toBeNull();
  });

  // The coordinator's ruling: once its elf is found, the prize is named on every door, whether or not
  // staff ticked Show it off.
  it("names the prize cut into the door once its elf is found, with or without Show it off", () => {
    expect(FOUND.bigPrize).toBe(false);
    expect(words(book())).toContain("Detectives Finn Hollyhunt and Mia Gingersnap won the prize cut into this door: A pretend family trip to the pantomime.");
    expect(words(book({ ...FOUND, prize: "A pretend sledge." }))).toContain("won the prize cut into this door: A pretend sledge.");
    expect(words(book({ ...FOUND, prize: null }))).not.toContain("won the prize");
  });

  it("puts everyone who found the elf in a row first, one polaroid each with its detective name, the finders first with the rosette", () => {
    const b = book();
    const heading = b.querySelector(".elf-book__heading")!;
    expect(heading.tagName).toBe("H4");
    expect(words(heading)).toBe("Everyone who found this elf 6 pictures");
    const pols = [...b.querySelectorAll(".elf-collage > .elf-pol")];
    expect(pols.map((p) => words(p.querySelector("figcaption")))).toEqual([
      "Detective Finn Hollyhunt",
      "Detective Mia Gingersnap",
      "Detective R. Tinselfoot",
      "Detective Leo Frostwhistle",
    ]);
    expect(pols.map((p) => p.querySelector("img")!.getAttribute("src"))).toEqual(ELF_URLS);
    expect(pols.map((p) => p.classList.contains("elf-pol--first"))).toEqual([true, true, false, false]);
    for (const p of pols.slice(0, 2)) {
      expect(p.querySelector(".elf-rosette")).not.toBeNull();
      expect(words(p.querySelector(".elf-pol__seal"))).toBe("FOUND FIRST!");
    }
    for (const p of pols.slice(2)) expect(p.querySelector(".elf-pol__seal, .elf-rosette")).toBeNull();
  });

  it("puts the photos in a row of their own, in the order given, with no words of any kind", () => {
    const b = book();
    const headings = [...b.querySelectorAll(".elf-book__heading")].map(words);
    expect(headings[1]).toBe("Photos from the door");
    const photos = [...b.querySelectorAll(".elf-photos > .elf-pol")];
    expect(photos.map((p) => p.querySelector("img")!.getAttribute("src"))).toEqual(PHOTO_URLS);
    for (const p of photos) {
      expect(words(p)).toBe("");
      expect(p.querySelector("figcaption")).toBeNull();
      expect(p.querySelector("img")!.getAttribute("alt")).toBe("");
      for (const el of [p, ...p.querySelectorAll("*")]) {
        for (const name of ["title", "aria-label", "aria-labelledby", "aria-describedby"]) expect(el.hasAttribute(name), name).toBe(false);
      }
    }
    // No detective's name in the row of photos, and no photo in the row of names.
    expect(words(b.querySelector(".elf-photos"))).toBe("");
    for (const url of PHOTO_URLS) expect(b.querySelector(".elf-collage")!.innerHTML).not.toContain(url);
  });

  it("leaves the family's own photo for the calendar's script to mark, drawing it like every other", () => {
    const html = doorDetail(FOUND, CTX);
    expect(html).not.toContain("Your photo");
    expect(html).not.toContain("Take it down");
    expect(html).not.toContain("elf-pol--mine");
    // The script finds the family's photo by its token, which is already in its address.
    expect([...book().querySelectorAll(".elf-photos > .elf-pol")].map((p) => p.getAttribute("data-token"))).toEqual(BOOK.photos.map((p) => p.token));
  });

  it("says one picture, not one pictures, and leaves out a row with nothing in it", () => {
    const one = book({ ...FOUND, scrapbook: { elves: BOOK.elves.slice(0, 1), photos: [], count: 1 } });
    expect(words(one.querySelector(".elf-book__heading"))).toBe("Everyone who found this elf 1 picture");
    expect(one.querySelector(".elf-photos")).toBeNull();
    expect(words(one)).not.toContain("Photos from the door");
  });

  it("tells families the elf is still there to visit, or that it has gone home", () => {
    expect(words(book())).toContain("The elf is still at The Leisure Centre. Visit to add your picture.");
    const gone = words(book({ ...FOUND, goneHome: true }));
    expect(gone).toContain("Pudding has gone home now, so there is nothing to find there. The pictures stay.");
    expect(gone).not.toContain("Visit to add your picture");
  });

  // Final review, minor 12: the counts are of families (doorCounts counts a family once, however many
  // detectives it has), so the words say families.
  it("keeps the counts, of families, and the fact for children", () => {
    const said = words(book());
    expect(said).toContain("172 families cracked this case");
    expect(said).not.toContain("detectives cracked");
    expect(said).toContain("51 have been there since");
    expect(said).toContain("Every Red Bag says: you have not been forgotten.");
    const one = words(book({ ...FOUND, counts: { cracked: 1, visited: 1 } }));
    expect(one).toContain("1 family cracked this case");
    expect(one).toContain("1 has been there since");
    expect(words(book({ ...FOUND, counts: { cracked: 0, visited: 0 } }))).toContain("Nobody cracked this case");
  });

  it("closes with a torn paper button back to its own door", () => {
    const close = book().querySelector(".elf-book__close a")!;
    expect(words(close)).toBe("Close door 4");
    expect(close.getAttribute("href")).toBe("#door-4");
    expect(close.classList.contains("elf-btn")).toBe(true);
  });

  it("is a scrapbook for a revealed door too: the elf still there to be won, and no rosette", () => {
    const visited = { ...REVEALED, scrapbook: { elves: [{ ...BOOK.elves[3], found: false }], photos: [], count: 1 } };
    const b = book(visited);
    expect(b.querySelector("section")!.classList.contains("elf-book")).toBe(true);
    // Decision 1: the prize is what is won (final review, Important 7).
    expect(words(b)).toContain(
      "Nobody found Holly in time, so here is the hiding place. Holly is still there, and the first detective to type the word on its tag wins the prize.",
    );
    expect(words(b.querySelector("h3"))).toBe("The Seaside Cafe, Largs");
    expect(b.querySelector(".elf-pol--first, .elf-pol__seal")).toBeNull();
    expect(words(b)).not.toContain("Found by");
    // A revealed door with nobody's elf yet has no empty rows.
    expect(book(REVEALED).querySelector(".elf-collage, .elf-photos")).toBeNull();
  });

  // Final review, minor 11: once its elf has gone home, a revealed door no longer says the elf is still
  // there to be won: only that nobody found it in time, and that it has gone home.
  it("leaves the race out of a revealed door whose elf has gone home", () => {
    const gone = words(book({ ...REVEALED, goneHome: true }));
    expect(gone).toContain("Nobody found Holly in time, so here is the hiding place.");
    expect(gone).not.toContain("first detective");
    expect(gone).not.toContain("is still there");
    expect(gone).toContain("Holly has gone home now, so there is nothing to find there. The pictures stay.");
    expect(gone).not.toContain("Visit to add your picture");
  });

  it("does without a scrapbook the view did not give", () => {
    const bare = book({ ...FOUND, scrapbook: null });
    expect(bare.querySelector(".elf-collage, .elf-photos")).toBeNull();
    expect(words(bare)).toContain("Found by Detectives Finn Hollyhunt and Mia Gingersnap at 5:52pm");
  });
});

describe("a door's version for the live feed", () => {
  it("changes when the door changes state, is found, or its collage changes", () => {
    const versions = [
      doorVersion(TODAY, NOW),
      doorVersion(HUNTING, NOW),
      doorVersion(FOUND_HIDDEN, NOW),
      doorVersion(SNOW, NOW),
      doorVersion({ ...FOUND, door: 7 }, NOW),
      doorVersion({ ...FOUND, door: 7, collage: ["/elf/door/7/elf/9.png"] }, NOW),
      doorVersion({ ...REVEALED, door: 7 }, NOW),
      doorVersion({ ...REVEALED, door: 7, collage: ["/elf/door/7/elf/9.png"] }, NOW),
    ];
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("changes when an open door's scrapbook, prize or elves' home changes", () => {
    const base = doorVersion(FOUND, NOW);
    expect(doorVersion({ ...FOUND, scrapbook: { ...BOOK, photos: BOOK.photos.slice(0, 1), count: 5 } }, NOW)).not.toBe(base);
    expect(doorVersion({ ...FOUND, prize: "A pretend sledge" }, NOW)).not.toBe(base);
    expect(doorVersion({ ...FOUND, goneHome: true }, NOW)).not.toBe(base);
  });

  // December's doors switched on change what today's door says, so the feed draws it again.
  it("changes when December's doors are switched on", () => {
    expect(doorVersion({ ...TODAY, doorsOn: false }, NOW)).not.toBe(doorVersion(TODAY, NOW));
  });

  it("changes when tomorrow becomes today, and not otherwise as time passes", () => {
    expect(doorVersion(TOMORROW, NOW)).toBe(doorVersion(TOMORROW, at("2026-12-07T23:00:00.000Z")));
    expect(doorVersion(TOMORROW, NOW)).not.toBe(doorVersion(TOMORROW, at("2026-12-08T00:01:00.000Z")));
  });

  it("is short, and safe to put in a page", () => {
    for (const d of [TODAY, HUNTING, FOUND_HIDDEN, SNOW, FOUND, REVEALED]) expect(doorVersion(d, NOW)).toMatch(/^[a-z0-9]{1,16}$/);
  });
});
