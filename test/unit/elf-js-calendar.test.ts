// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { isOpen } from "../../src/elf/doors";
import { calendarStatus, renderCalendarPage } from "../../src/elf/pages/calendar";
import { doorDetail, doorTile, doorVersion } from "../../src/elf/pages/door";
import type { CalendarView, DoorView } from "../../src/elf/pages/types";
import type { ScrapPhoto } from "../../src/elf/scrapbook";
import { familyDoorView } from "../../src/elf/views";
import { AFTERNOON, at, calendarView } from "./elf-fixtures";

// NBCC Elf Detective School: the script that brings the public calendar to life. It runs here against
// the real page, drawn by the real renderer, with a pretend server answering. Every business and
// detective is invented (see elf-fixtures.ts).

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initCalendar } = require(resolve(ROOT, "assets/js/elf-calendar.js"));

interface Calendar {
  tick(): void;
  poll(): Promise<void>;
  ready: Promise<void>;
  stop(): void;
}

let cal: Calendar | null = null;
let clock = 0;
let calls: string[] = [];
/** What the pretend server holds now. The page was drawn from an earlier view. */
let server: CalendarView;
let me: { status: number; body: unknown };
let offline = false;
/** The places of the doors the family can see, by door: the family's own answers draw them (Plan 2c-1). */
let places = new Map<number, { name: string; town: string }>();
/** The photos on the family's own doors, by door. */
let ownPhotos = new Map<number, ScrapPhoto[]>();
/** What the family's own answers say instead of drawing, such as 404 while the shared calendar lags. */
let ownStatus = 200;
/** The family's answer cannot be reached at all, as when the network fails for that one request. */
let meOffline = false;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const door = (n: number) => $(`#door-${n}`);
const detail = (n: number) => $(`#case-${n}`);
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** Door n as the family's own answer draws it, from the pretend server's shared door, as GET /api/elf/me/door/:n
 *  does: only an open door whose place the family can see, with its place and photos laid on. */
function ownDoor(n: number): { tile: string; detail: string } | null {
  const shared = server.doors[n - 1];
  const place = places.get(n);
  if (!shared || !place || !isOpen(shared.state)) return null;
  const mine = familyDoorView(shared, { place, photos: ownPhotos.get(n) ?? [] });
  return { tile: doorTile(mine, server.now), detail: doorDetail(mine, { now: server.now, joinUrl: "/elf/join", hqUrl: "/elf/hq" }) };
}

function answer(url: string): { status: number; body: unknown } {
  const own = /^\/api\/elf\/me\/door\/(\d+)$/.exec(url);
  if (own) {
    const drawn = ownStatus === 200 ? ownDoor(Number(own[1])) : null;
    return drawn ? { status: 200, body: drawn } : { status: ownStatus === 200 ? 404 : ownStatus, body: { error: "Not found" } };
  }
  if (url === "/api/elf/me/doors") {
    if (ownStatus !== 200) return { status: ownStatus, body: { error: "Not found" } };
    const doors = [...places.keys()].sort((a, b) => a - b).flatMap((n) => {
      const drawn = ownDoor(n);
      return drawn ? [{ door: n, ...drawn }] : [];
    });
    return { status: 200, body: { doors } };
  }
  if (url === "/api/elf/calendar") {
    return {
      status: 200,
      body: {
        now: server.now.toISOString(),
        found: server.doors.filter((d) => d.state === "found").length,
        status: calendarStatus(server),
        doors: server.doors.map((d) => ({ door: d.door, v: doorVersion(d, server.now) })),
      },
    };
  }
  const one = /^\/api\/elf\/door\/(\d+)$/.exec(url);
  if (one) {
    const d = server.doors[Number(one[1]) - 1];
    return { status: 200, body: { tile: doorTile(d, server.now), detail: doorDetail(d, { now: server.now, joinUrl: "/elf/join", hqUrl: "/elf/hq" }) } };
  }
  if (url === "/api/elf/me") return me;
  return { status: 404, body: {} };
}

function load(view: CalendarView = calendarView(AFTERNOON), hash = ""): Calendar {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderCalendarPage(view), "text/html").documentElement.innerHTML;
  window.history.replaceState(null, "", `/elf${hash}`);
  server = view;
  calls = [];
  clock = 1_000_000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string) => {
    calls.push(url);
    const reply = () => {
      if (offline || (meOffline && url === "/api/elf/me")) return Promise.reject(new Error("offline"));
      const a = answer(url);
      return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
    };
    return reply();
  });
  cal = initCalendar(document, window, { now: () => clock }) as Calendar;
  return cal;
}

/** Door 7's elf is found on the pretend server, a few minutes after its clue. */
function findDoorSeven(): void {
  const now = at("2026-12-07T17:50:00.000Z");
  const found: Partial<DoorView> = {
    state: "found",
    place: { name: "The Toy Shop", town: "Troon" },
    found: { at: at("2026-12-07T17:47:00.000Z"), by: "Detective Sam Snowsleuth" },
    collage: ["/elf/pic/7.svg"],
    counts: { cracked: 31, visited: 1 },
    factLine: "Last Christmas, NBCC's elves sent out 7,657 Red Bags Full of Joy!",
  };
  server = calendarView(now, found);
}

afterEach(() => {
  cal?.stop();
  cal = null;
  offline = false;
  me = { status: 401, body: {} };
  places = new Map();
  ownPhotos = new Map();
  ownStatus = 200;
  meOffline = false;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
me = { status: 401, body: {} };

describe("opening a door", () => {
  it("turns each door into a button that says whether its detail is open", () => {
    load();
    expect($("#elf-board").classList.contains("is-live")).toBe(true);
    for (const n of [1, 7, 24]) {
      expect(door(n).getAttribute("role")).toBe("button");
      expect(door(n).getAttribute("aria-expanded")).toBe("false");
      expect(door(n).getAttribute("aria-controls")).toBe(`case-${n}`);
    }
  });

  it("opens a door's detail when it is tapped, and closes it when it is tapped again", () => {
    load();
    click(door(4));
    expect(detail(4).classList.contains("is-open")).toBe(true);
    expect(door(4).getAttribute("aria-expanded")).toBe("true");
    click(door(4));
    expect(detail(4).classList.contains("is-open")).toBe(false);
    expect(door(4).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows one detail at a time", () => {
    load();
    click(door(4));
    click(door(9));
    expect(detail(4).classList.contains("is-open")).toBe(false);
    expect(door(4).getAttribute("aria-expanded")).toBe("false");
    expect(detail(9).classList.contains("is-open")).toBe(true);
  });

  it("opens from a tap on anything inside the door", () => {
    load();
    // An open door's room: the count of its pictures.
    click(door(4).querySelector(".elf-room__count")!);
    expect(detail(4).classList.contains("is-open")).toBe(true);
    click(door(9).querySelector(".elf-door__flap .elf-door__num")!);
    expect(detail(9).classList.contains("is-open")).toBe(true);
  });

  it("opens with the space bar and with Enter, as a button should", () => {
    load();
    door(4).dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(detail(4).classList.contains("is-open")).toBe(true);
    door(4).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(detail(4).classList.contains("is-open")).toBe(false);
  });

  it("opens the door named in the address when the page loads", () => {
    load(calendarView(AFTERNOON), "#case-4");
    expect(detail(4).classList.contains("is-open")).toBe(true);
    expect(door(4).getAttribute("aria-expanded")).toBe("true");
  });

  it("rattles a door that is still shut, and not one that is open", () => {
    load();
    click(door(9));
    expect(door(9).classList.contains("is-rattled")).toBe(true);
    click(door(4));
    expect(door(4).classList.contains("is-rattled")).toBe(false);
  });
});

describe("the countdown", () => {
  it("ticks down by the server's clock, not the phone's", () => {
    const calendar = load();
    const counts = [...document.querySelectorAll(".elf-cd")];
    expect(counts.length).toBeGreaterThanOrEqual(2);
    expect(counts.map((c) => c.textContent)).toEqual(counts.map(() => "2:30:00"));
    clock += 1000;
    calendar.tick();
    expect(counts.map((c) => c.textContent)).toEqual(counts.map(() => "2:29:59"));
  });

  // Final review, Important 1: the browser may keep the feed for 15 seconds, and a kept copy repeats an
  // earlier time. Setting the clock from it again would make every countdown jump back, so only a newer
  // time from the server moves the clock.
  it("follows only a newer time from the feed, so a copy the browser kept never makes a countdown jump", async () => {
    const calendar = load();
    await calendar.ready;
    const cd = () => $("#door-7 .elf-cd").textContent;
    expect(cd()).toBe("2:30:00");
    // Ten seconds on, the server answers with its own time.
    clock += 10_000;
    server = { ...server, now: new Date(AFTERNOON.getTime() + 10_000) };
    await calendar.poll();
    calendar.tick();
    expect(cd()).toBe("2:29:50");
    // Five seconds after that, the browser hands back the same answer from its cache.
    clock += 5_000;
    await calendar.poll();
    calendar.tick();
    expect(cd()).toBe("2:29:45");
    // A newer answer still moves the clock: this phone's clock has slipped a second behind.
    clock += 4_000;
    server = { ...server, now: new Date(AFTERNOON.getTime() + 20_000) };
    await calendar.poll();
    calendar.tick();
    expect(cd()).toBe("2:29:40");
  });

  it("stops at nought and asks for news the moment it gets there", async () => {
    const calendar = load();
    clock += 3 * 3600 * 1000;
    calendar.tick();
    expect($(".elf-cd").textContent).toBe("0:00");
    await flush();
    expect(calls).toContain("/api/elf/calendar");
  });
});

describe("news from the live feed", () => {
  it("fetches only the door that changed, and swings it open when its elf has been found", async () => {
    const calendar = load();
    await calendar.ready;
    calls = [];
    findDoorSeven();
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7"]);
    expect(door(7).classList.contains("is-open")).toBe(true);
    expect(door(7).classList.contains("is-opening")).toBe(true);
    expect(door(7).getAttribute("aria-label")).toContain("The Toy Shop, Troon");
    expect(words(detail(7))).toContain("Found by Detective Sam Snowsleuth at 5:47pm");
    expect(words($(".elf-tally"))).toBe("7 of 24 elves found");
  });

  it("changes today's news at the top to match", async () => {
    const calendar = load();
    expect(words($(".elf-status__title"))).toBe("Door 7 opens today");
    findDoorSeven();
    await calendar.poll();
    expect(words($(".elf-status__title"))).toBe("Bauble has been found!");
    expect(words($(".elf-status__body"))).toContain("Detective Sam Snowsleuth");
    expect($(".elf-status").classList.contains("elf-status--found")).toBe(true);
    expect($(".elf-status").classList.contains("elf-status--today")).toBe(false);
    // Still the paper card sheet it was drawn as.
    expect($(".elf-status").classList.contains("elf-card")).toBe(true);
  });

  it("keeps the door a button, and keeps its detail open, when it is drawn again", async () => {
    const calendar = load();
    click(door(7));
    findDoorSeven();
    await calendar.poll();
    expect(door(7).getAttribute("role")).toBe("button");
    expect(door(7).getAttribute("aria-expanded")).toBe("true");
    expect(detail(7).classList.contains("is-open")).toBe(true);
    click(door(7));
    expect(detail(7).classList.contains("is-open")).toBe(false);
  });

  it("asks for nothing more when nothing has changed", async () => {
    const calendar = load();
    await calendar.ready;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar"]);
  });

  it("changes nothing when the feed cannot be reached, and tries again later", async () => {
    const calendar = load();
    await calendar.ready;
    const before = $("#elf-board").innerHTML;
    offline = true;
    await calendar.poll();
    expect($("#elf-board").innerHTML).toBe(before);
    offline = false;
    findDoorSeven();
    await calendar.poll();
    expect(door(7).classList.contains("is-open")).toBe(true);
  });

  it("does not ask for news while the page is hidden", async () => {
    const calendar = load();
    await calendar.ready;
    calls = [];
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await calendar.poll();
    expect(calls).toEqual([]);
  });
});

/** The calendar with two photos in door 3's scrapbook, "mine0001" and "other002". */
function withPhotos(): CalendarView {
  const view = calendarView(AFTERNOON);
  const three = view.doors[2];
  three.scrapbook!.photos = [
    { token: "other002", url: "/elf/door/3/photo/other002.jpg" },
    { token: "mine0001", url: "/elf/door/3/photo/mine0001.jpg" },
  ];
  return view;
}

/** The calendar with door 4's elf at its real address, in its room and its scrapbook, and a photo. */
function withDoorElves(): CalendarView {
  const view = calendarView(AFTERNOON);
  const four = view.doors[3];
  const elf = "/elf/door/4/elf/41.png";
  four.collage = [elf];
  four.scrapbook = { elves: [{ ...four.scrapbook!.elves[0], pictureUrl: elf }], photos: [{ token: "k3m9p2x7w4qa", url: "/elf/door/4/photo/k3m9p2x7w4qa.jpg" }], count: 2 };
  return view;
}

// Final review, Important 5: the server draws the elves on the doors one at a time and says it is busy
// (503) when too many are waiting. An elf picture that fails is asked for again a little later, twice
// at most. A photo is never asked for again: it is there, or it is not.
describe("a door elf that could not be drawn just now", () => {
  it("is asked for again after two seconds, then after five more, and then left", () => {
    vi.useFakeTimers();
    try {
      load(withDoorElves());
      const img = detail(4).querySelector<HTMLImageElement>(".elf-collage img")!;
      expect(img.getAttribute("src")).toBe("/elf/door/4/elf/41.png");
      img.dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(1999);
      expect(img.getAttribute("src")).toBe("/elf/door/4/elf/41.png");
      vi.advanceTimersByTime(1);
      expect(img.getAttribute("src")).toBe("/elf/door/4/elf/41.png?try=1");
      img.dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(4999);
      expect(img.getAttribute("src")).toBe("/elf/door/4/elf/41.png?try=1");
      vi.advanceTimersByTime(1);
      expect(img.getAttribute("src")).toBe("/elf/door/4/elf/41.png?try=2");
      img.dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(60_000);
      expect(img.getAttribute("src")).toBe("/elf/door/4/elf/41.png?try=2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is asked for again in an open door's room too, and a photo never is", () => {
    vi.useFakeTimers();
    try {
      load(withDoorElves());
      const mini = door(4).querySelector<HTMLImageElement>(".elf-mini img")!;
      mini.dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(2000);
      expect(mini.getAttribute("src")).toBe("/elf/door/4/elf/41.png?try=1");
      const photo = detail(4).querySelector<HTMLImageElement>(".elf-photos img")!;
      photo.dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(10_000);
      expect(photo.getAttribute("src")).toBe("/elf/door/4/photo/k3m9p2x7w4qa.jpg");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("shutting a door from its scrapbook", () => {
  it("shuts the scrapbook and puts focus back on the door", () => {
    load();
    click(door(4));
    expect(detail(4).classList.contains("is-open")).toBe(true);
    click(detail(4).querySelector(".elf-book__close a")!);
    expect(detail(4).classList.contains("is-open")).toBe(false);
    expect(door(4).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(door(4));
  });
});

describe("the family's own photo", () => {
  const photos = [{ door: 3, token: "mine0001", status: "approved" }];

  it("is marked Your photo in the open door's scrapbook, and no other photo is", async () => {
    me = { status: 200, body: { doors: [], photos } };
    const calendar = load(withPhotos());
    await calendar.ready;
    const mine = detail(3).querySelector<HTMLElement>('figure[data-token="mine0001"]')!;
    expect(words(mine)).toContain("Your photo");
    expect(mine.querySelector("button")!.textContent).toBe("Take it down");
    const other = detail(3).querySelector<HTMLElement>('figure[data-token="other002"]')!;
    expect(words(other)).toBe("");
    expect(other.querySelector("button")).toBeNull();
  });

  it("is taken down with a DELETE, and the door is fetched again", async () => {
    me = { status: 200, body: { doors: [], photos } };
    const calendar = load(withPhotos());
    await calendar.ready;
    server.doors[2].scrapbook!.photos = [{ token: "other002", url: "/elf/door/3/photo/other002.jpg" }];
    const requests: { url: string; method: string }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = (window as any).fetch as (url: string, init?: RequestInit) => Promise<unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "DELETE") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      return before(url, init);
    });
    click(detail(3).querySelector("figure[data-token] button")!);
    await flush();
    expect(requests).toEqual([
      { url: "/api/elf/door/3/photo", method: "DELETE" },
      { url: "/api/elf/door/3", method: "GET" },
    ]);
    expect(detail(3).querySelector('figure[data-token="mine0001"]')).toBeNull();
    expect(detail(3).querySelector('figure[data-token="other002"]')).not.toBeNull();
    expect(detail(3).querySelector("figure button")).toBeNull();
  });

  it("says the photo is down, and leaves the door, when only the fetch of the door fails", async () => {
    me = { status: 200, body: { doors: [], photos } };
    const calendar = load(withPhotos());
    await calendar.ready;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      return Promise.reject(new Error("offline"));
    });
    click(detail(3).querySelector("figure[data-token] button")!);
    await flush();
    const mine = detail(3).querySelector<HTMLElement>('figure[data-token="mine0001"]')!;
    expect(words(mine)).toContain("Your photo has been taken down.");
    expect(words(mine)).not.toContain("could not");
    expect(mine.querySelector("button")).toBeNull();
  });

  it("is not marked for a visitor who is not signed in", async () => {
    const calendar = load(withPhotos());
    await calendar.ready;
    expect(detail(3).querySelector("figure[data-token] button")).toBeNull();
  });
});

describe("a family's own marks", () => {
  it("are laid over the board for a family that is signed in", async () => {
    me = {
      status: 200,
      body: { doors: [{ door: 1, cracked: true, visited: true }, { door: 2, cracked: true, visited: false }, { door: 4, cracked: false, visited: true }] },
    };
    const calendar = load();
    await calendar.ready;
    expect(door(1).querySelectorAll(".elf-door__marks .elf-mark").length).toBe(2);
    expect(door(2).querySelectorAll(".elf-door__marks .elf-mark").length).toBe(1);
    expect(door(2).querySelector(".elf-door__marks .elf-mark--cracked")).not.toBeNull();
    expect(door(4).querySelector(".elf-door__marks .elf-mark--cracked")).toBeNull();
    expect(door(9).querySelectorAll(".elf-door__marks .elf-mark").length).toBe(0);
  });

  it("give each door the family has done, cracked or visited, the painted holly", async () => {
    me = {
      status: 200,
      body: {
        doors: [
          { door: 1, cracked: true, visited: true },
          { door: 2, cracked: true, visited: false },
          { door: 4, cracked: false, visited: true },
          { door: 5, cracked: false, visited: false },
        ],
      },
    };
    const calendar = load();
    await calendar.ready;
    expect([1, 2, 4].map((n) => door(n).classList.contains("is-done"))).toEqual([true, true, true]);
    expect([3, 5, 9].map((n) => door(n).classList.contains("is-done"))).toEqual([false, false, false]);
  });

  // Final review, Important 3: a snow day counts as done for everyone, so its door wears the holly too.
  it("give a snowed in door the painted holly too, with no mark of its own", async () => {
    const view = calendarView(AFTERNOON);
    view.doors[4] = { ...view.doors[4], state: "snow", place: null, found: null, scrapbook: null, collage: [], counts: null, factLine: null };
    me = { status: 200, body: { doors: [{ door: 5, cracked: false, visited: false, snow: true }] } };
    const calendar = load(view);
    await calendar.ready;
    expect(door(5).classList.contains("is-done")).toBe(true);
    expect(door(5).querySelectorAll(".elf-door__marks .elf-mark").length).toBe(0);
    expect([3, 6, 9].map((n) => door(n).classList.contains("is-done"))).toEqual([false, false, false]);
  });

  it("are read out with the door", async () => {
    me = { status: 200, body: { doors: [{ door: 1, cracked: true, visited: true }, { door: 2, cracked: true, visited: false }] } };
    const calendar = load();
    await calendar.ready;
    expect(door(1).getAttribute("aria-label")).toMatch(/You cracked it\. You have been there\.$/);
    expect(door(2).getAttribute("aria-label")).toMatch(/You cracked it\.$/);
  });

  it("tell the family what is left to do at each open door", async () => {
    me = {
      status: 200,
      body: { doors: [{ door: 1, cracked: true, visited: true }, { door: 2, cracked: true, visited: false }, { door: 4, cracked: false, visited: true }] },
    };
    const calendar = load();
    await calendar.ready;
    const mine = (n: number) => detail(n).querySelector<HTMLElement>(".elf-detail__mine")!;
    expect(words(mine(1))).toBe("Your family cracked this case and has been there. Both marks collected.");
    // Final review, minor 12: an open door can be visited any day in December, as the calendar's steps say.
    expect(words(mine(2))).toBe("Your family cracked this case. Visit any day in December for your candy cane too.");
    expect(words(mine(4))).toBe("Your family has been there. Candy cane collected.");
    expect(words(mine(3))).toBe("Not done yet. Visit any day in December for your candy cane.");
    expect(mine(1).hidden).toBe(false);
    expect(mine(9).hidden).toBe(true);
    // The general hint would only repeat the family's own line, so it steps aside.
    expect(detail(1).querySelector<HTMLElement>(".elf-detail__hint")!.hidden).toBe(true);
  });

  // Plan 2a's final review, parked for Plan 2b Task 7: an open door whose elf has gone home has nothing
  // left to find, and its scrapbook says so. The family's own line never invites a visit there; it says
  // only what the family collected, and nothing when they collected nothing.
  it("never invite a visit to a door whose elf has gone home, and say only what the family collected", async () => {
    const view = calendarView(AFTERNOON);
    for (const n of [1, 2, 3, 4]) view.doors[n - 1] = { ...view.doors[n - 1], goneHome: true };
    me = {
      status: 200,
      body: { doors: [{ door: 1, cracked: true, visited: true }, { door: 2, cracked: true, visited: false }, { door: 4, cracked: false, visited: true }] },
    };
    const calendar = load(view);
    await calendar.ready;
    const mine = (n: number) => detail(n).querySelector<HTMLElement>(".elf-detail__mine")!;
    for (const n of [1, 2, 3, 4]) {
      expect(words(detail(n))).not.toContain("Visit any day in December");
      // The scrapbook's own gone home line stays where it is.
      const gone = detail(n).querySelector<HTMLElement>(".elf-book__gone")!;
      expect(words(gone)).toContain("has gone home now, so there is nothing to find there.");
      expect(gone.hidden).toBe(false);
    }
    expect(words(mine(1))).toBe("Your family cracked this case and has been there. Both marks collected.");
    expect(words(mine(2))).toBe("Your family cracked this case.");
    expect(words(mine(4))).toBe("Your family has been there. Candy cane collected.");
    expect(mine(3).hidden).toBe(true);
    expect(words(mine(3))).toBe("");
    // A door whose elf is still there still says what is left to do.
    expect(words(mine(5))).toBe("Not done yet. Visit any day in December for your candy cane.");
  });

  it("stay on a door when the live feed draws it again", async () => {
    me = { status: 200, body: { doors: [{ door: 7, cracked: true, visited: false }] } };
    const calendar = load();
    await calendar.ready;
    findDoorSeven();
    await calendar.poll();
    expect(door(7).querySelectorAll(".elf-door__marks .elf-mark").length).toBe(1);
    expect(door(7).classList.contains("is-done")).toBe(true);
    expect(words(detail(7).querySelector(".elf-detail__mine"))).toContain("Your family cracked this case.");
  });

  it("leave the board as it is for a visitor who is not signed in", async () => {
    const calendar = load();
    await calendar.ready;
    expect(document.querySelectorAll(".elf-door__marks .elf-mark").length).toBe(0);
    expect(document.querySelectorAll(".elf-door.is-done").length).toBe(0);
    expect([...document.querySelectorAll<HTMLElement>(".elf-detail__mine")].every((p) => p.hidden)).toBe(true);
  });
});

// ---- a family's own places (Plan 2c-1, Task 8) -----------------------------------------------------------
//
// The calendar everyone shares names no place before Christmas Day. A door whose place a signed in family can
// see (it guessed there, or one of its detectives typed the tag word) is drawn from the family's own answer
// instead: one door from GET /api/elf/me/door/:n, more than one from GET /api/elf/me/doors, never one request a
// door (the rulings on Plan 2c-1, from Task 5's report). It keeps the shared calendar's fingerprint, so the feed
// is still compared with the shared calendar. Bauble, door 7's elf, was found at 5:47pm on Monday 7 December
// and its place, Corner Bakehouse in Snowford, is shown at 7pm. Every place and detective here is invented.

const CORNER = { name: "Corner Bakehouse", town: "Snowford" };
const SEVEN_05 = at("2026-12-07T19:05:00.000Z");
const FINDER = { firstName: "Ruby", surname: "Tinselfoot", approved: true };
const ELF_71 = { visitId: 71, detective: FINDER, countsFrom: at("2026-12-07T17:47:00.000Z"), found: true, pictureUrl: "/elf/door/7/elf/71.png" };
const ELF_72 = { visitId: 72, detective: { firstName: "Sam", surname: "Example", approved: true }, countsFrom: at("2026-12-07T19:15:00.000Z"), found: false, pictureUrl: "/elf/door/7/elf/72.png" };

/** The calendar at `now` once door 7's place is shown, as everyone shares it before Christmas Day: door 7 found,
 *  with no place, its finder's elf, and a go in Detective HQ. */
function sharedSeven(now: Date, over: Partial<DoorView> = {}): CalendarView {
  return calendarView(now, {
    state: "found",
    found: { at: at("2026-12-07T17:47:00.000Z"), by: "Detective R. Tinselfoot" },
    counts: { cracked: 3, visited: 1 },
    scrapbook: { elves: [ELF_71], photos: [], count: 1 },
    collage: [ELF_71.pictureUrl],
    goUrl: "/elf/hq/door/7",
    ...over,
  });
}

/** Another detective's elf at door 3, whose place the families in these tests cannot see. */
const ELF_33 = { visitId: 33, detective: { firstName: "Sam", surname: "Example", approved: true }, countsFrom: at("2026-12-07T19:10:00.000Z"), found: false, pictureUrl: "/elf/door/3/elf/33.png" };

/** The calendar at 6:59:50pm: door 7's elf was found at 5:47pm, and its place is shown at 7pm. */
const beforeSeven = (): CalendarView =>
  calendarView(at("2026-12-07T18:59:50.000Z"), {
    state: "found-hidden",
    found: { at: at("2026-12-07T17:47:00.000Z"), by: "Detective R. Tinselfoot" },
    revealAt: at("2026-12-07T19:00:00.000Z"),
  });

/** The pretend server a little later: another detective's elf has joined door 7's scrapbook. */
function secondElfOnSeven(): void {
  server = sharedSeven(at("2026-12-07T19:20:00.000Z"), { scrapbook: { elves: [ELF_71, ELF_72], photos: [], count: 2 }, collage: [ELF_71.pictureUrl, ELF_72.pictureUrl] });
}

/** The family's answer while December's doors are on. */
const meOn = (o: { known?: number[]; goes?: number[]; doors?: unknown[]; photos?: unknown[] } = {}) => ({
  status: 200,
  body: { doors: o.doors ?? [], photos: o.photos ?? [], known: o.known ?? [], goes: o.goes ?? [] },
});

/** Words that would tell a family something went wrong. */
const TROUBLE = /could not|went wrong|try again|not found/i;

describe("a family's own places", () => {
  it("draw a door the family can see from its own answer, never from the calendar everyone shares, keeping the shared fingerprint", async () => {
    places.set(7, CORNER);
    me = meOn({ known: [7] });
    const calendar = load(sharedSeven(SEVEN_05));
    const served = door(7).getAttribute("data-v");
    expect(words(detail(7))).not.toContain("Corner Bakehouse");
    await calendar.ready;
    expect(calls).toEqual(["/api/elf/me", "/api/elf/me/door/7"]);
    expect(words(detail(7))).toContain("Corner Bakehouse, Snowford");
    expect(door(7).getAttribute("aria-label")).toContain("Corner Bakehouse, Snowford");
    // The family knows where the elf was, so its door offers no go.
    expect(detail(7).querySelector(".elf-book__go")).toBeNull();
    expect(door(7).getAttribute("data-v")).toBe(served);
    expect(served).toBe(doorVersion(server.doors[6], server.now));
    // Still a button that opens its detail.
    expect(door(7).getAttribute("role")).toBe("button");
  });

  it("draw every door the family can see from one answer when it can see more than one", async () => {
    const view = sharedSeven(SEVEN_05);
    // Door 3 as the calendar everyone shares draws it before Christmas Day: no place, and a go.
    view.doors[2] = { ...view.doors[2], place: null, goUrl: "/elf/hq/door/3" };
    places.set(3, { name: "Mistletoe Mill", town: "Exampleton" });
    places.set(7, CORNER);
    me = meOn({ known: [3, 7] });
    const calendar = load(view);
    const served = [door(3).getAttribute("data-v"), door(7).getAttribute("data-v")];
    await calendar.ready;
    expect(calls).toEqual(["/api/elf/me", "/api/elf/me/doors"]);
    expect(words(detail(3))).toContain("Mistletoe Mill, Exampleton");
    expect(words(detail(7))).toContain("Corner Bakehouse, Snowford");
    expect([door(3).getAttribute("data-v"), door(7).getAttribute("data-v")]).toEqual(served);
  });

  it("ask for nothing more on a poll whose fingerprints are the same", async () => {
    places.set(7, CORNER);
    me = meOn({ known: [7] });
    const calendar = load(sharedSeven(SEVEN_05));
    await calendar.ready;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar"]);
    expect(words(detail(7))).toContain("Corner Bakehouse");
  });

  it("draw a door again from the family's own answer when the feed says it has changed, with the shared calendar's newer fingerprint", async () => {
    places.set(7, CORNER);
    me = meOn({ known: [7] });
    const calendar = load(sharedSeven(SEVEN_05));
    await calendar.ready;
    calls = [];
    secondElfOnSeven();
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/door/7"]);
    expect(door(7).getAttribute("data-v")).toBe(doorVersion(server.doors[6], server.now));
    expect(words(detail(7))).toContain("Corner Bakehouse");
    expect(detail(7).querySelectorAll(".elf-collage figure").length).toBe(2);
    // And then nothing more, until it changes again.
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar"]);
  });

  it("draw a door again from the family's own answer when the family takes its photo down", async () => {
    places.set(7, CORNER);
    const other = { token: "other002", url: "/elf/door/7/photo/other002.jpg" };
    ownPhotos.set(7, [other, { token: "mine0001", url: "/elf/door/7/photo/mine0001.jpg" }]);
    me = meOn({ known: [7], doors: [{ door: 7, cracked: false, visited: true }], photos: [{ door: 7, token: "mine0001", status: "approved" }] });
    const calendar = load(sharedSeven(SEVEN_05));
    await calendar.ready;
    expect(words(detail(7).querySelector('figure[data-token="mine0001"]'))).toContain("Your photo");
    ownPhotos.set(7, [other]);
    const requests: { url: string; method: string }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = (window as any).fetch as (url: string, init?: RequestInit) => Promise<unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "DELETE") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      return before(url, init);
    });
    click(detail(7).querySelector("figure[data-token] button")!);
    await flush();
    expect(requests).toEqual([
      { url: "/api/elf/door/7/photo", method: "DELETE" },
      { url: "/api/elf/me/door/7", method: "GET" },
    ]);
    expect(detail(7).querySelector('figure[data-token="mine0001"]')).toBeNull();
    expect(detail(7).querySelector('figure[data-token="other002"]')).not.toBeNull();
    expect(words(detail(7))).toContain("Corner Bakehouse");
  });

  // The rulings on Plan 2c-1, from Task 5's report: the family's own answer follows the calendar everyone shares,
  // which is kept for up to 15 seconds, so for a moment after a door opens it may not have the door yet.
  it("leave a door as it was served while the family's answer has not got it yet, and ask again on each poll, saying nothing", async () => {
    places.set(7, CORNER);
    me = meOn({ known: [7] });
    ownStatus = 404;
    const calendar = load(sharedSeven(SEVEN_05));
    const served = door(7).getAttribute("data-v");
    await calendar.ready;
    expect(calls).toEqual(["/api/elf/me", "/api/elf/me/door/7"]);
    expect(words(detail(7))).not.toContain("Corner Bakehouse");
    expect(door(7).getAttribute("data-v")).toBe(served);
    expect(words($("#elf-board"))).not.toMatch(TROUBLE);
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/door/7"]);
    expect(words(detail(7))).not.toContain("Corner Bakehouse");
    // The shared calendar has caught up: the family's door comes, and then nothing more is asked.
    ownStatus = 200;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/door/7"]);
    expect(words(detail(7))).toContain("Corner Bakehouse");
    expect(door(7).getAttribute("data-v")).toBe(served);
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar"]);
  });

  it("leave every door as it was served when the one answer with all of them fails", async () => {
    const view = sharedSeven(SEVEN_05);
    view.doors[2] = { ...view.doors[2], place: null, goUrl: "/elf/hq/door/3" };
    places.set(3, { name: "Mistletoe Mill", town: "Exampleton" });
    places.set(7, CORNER);
    me = meOn({ known: [3, 7] });
    ownStatus = 500;
    const calendar = load(view);
    const served = [door(3).getAttribute("data-v"), door(7).getAttribute("data-v")];
    await calendar.ready;
    expect(words(detail(3))).not.toContain("Mistletoe Mill");
    expect(words(detail(7))).not.toContain("Corner Bakehouse");
    expect([door(3).getAttribute("data-v"), door(7).getAttribute("data-v")]).toEqual(served);
    expect(words($("#elf-board"))).not.toMatch(TROUBLE);
    // The next poll asks again, for both at once.
    ownStatus = 200;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/doors"]);
    expect(words(detail(3))).toContain("Mistletoe Mill");
    expect(words(detail(7))).toContain("Corner Bakehouse");
  });

  it("keep a changed door as it was while the family's answer has not got it yet, and draw it on the next poll", async () => {
    places.set(7, CORNER);
    me = meOn({ known: [7] });
    const calendar = load(sharedSeven(SEVEN_05));
    await calendar.ready;
    const drawn = door(7).getAttribute("data-v");
    secondElfOnSeven();
    ownStatus = 404;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/door/7"]);
    expect(door(7).getAttribute("data-v")).toBe(drawn);
    expect(words(detail(7))).toContain("Corner Bakehouse");
    expect(detail(7).querySelectorAll(".elf-collage figure").length).toBe(1);
    ownStatus = 200;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/door/7"]);
    expect(door(7).getAttribute("data-v")).toBe(doorVersion(server.doors[6], server.now));
    expect(detail(7).querySelectorAll(".elf-collage figure").length).toBe(2);
  });

  it("give up on the family's answer after a minute, and draw a changed door as the calendar everyone shares does, until it changes again", async () => {
    places.set(7, CORNER);
    me = meOn({ known: [7] });
    const calendar = load(sharedSeven(SEVEN_05));
    await calendar.ready;
    secondElfOnSeven();
    ownStatus = 404;
    await calendar.poll();
    clock += 30_000;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/door/7"]);
    clock += 31_000;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/door/7", "/api/elf/door/7"]);
    expect(door(7).getAttribute("data-v")).toBe(doorVersion(server.doors[6], server.now));
    expect(words(detail(7))).not.toContain("Corner Bakehouse");
    expect(words($("#elf-board"))).not.toMatch(TROUBLE);
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar"]);
  });

  // Ruling F5 on Plan 2c-1, narrowed in Task 8's fix round: tonight's door opens while the page is open, so it is in
  // neither of the lists the page loaded with. When a door the family cannot see turns open (its kind moves from one
  // with no place to found or revealed), the family's answer is read again before the door is drawn: the shared
  // door is fetched first, and its kind is what shows it opening.
  it("read the family's answer again when tonight's door opens, and draw it from the family's own answer once it can see the place", async () => {
    places.set(7, CORNER);
    me = meOn();
    const calendar = load(beforeSeven());
    await calendar.ready;
    expect(calls).toEqual(["/api/elf/me"]);
    // 7pm: the place is shown, and this family guessed, so it can see it now.
    server = sharedSeven(at("2026-12-07T19:00:05.000Z"));
    me = meOn({ known: [7] });
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7", "/api/elf/me", "/api/elf/me/door/7"]);
    expect(words(detail(7))).toContain("Corner Bakehouse, Snowford");
    expect(door(7).getAttribute("data-v")).toBe(doorVersion(server.doors[6], server.now));
    expect(door(7).classList.contains("is-opening")).toBe(true);
    expect(detail(7).querySelector(".elf-book__go")).toBeNull();
  });

  it("read the family's answer again when tonight's door opens, and draw the shared door it fetched, with Have a go, for a family that did not guess", async () => {
    me = meOn();
    const calendar = load(beforeSeven());
    await calendar.ready;
    server = sharedSeven(at("2026-12-07T19:00:05.000Z"));
    me = meOn({ goes: [7] });
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7", "/api/elf/me"]);
    const go = detail(7).querySelector<HTMLElement>(".elf-book__go")!;
    expect(go.hidden).toBe(false);
    expect(words(go)).toBe("Where was Bauble hiding? Crack the case in Detective HQ to find out. Have a go");
    expect(detail(7).querySelector<HTMLElement>(".elf-detail__mine")!.hidden).toBe(true);
    expect(door(7).getAttribute("data-v")).toBe(doorVersion(server.doors[6], server.now));
    expect(words(detail(7))).not.toContain("Corner Bakehouse");
  });

  it("lay the family's fresh marks on every door when its answer is read again as tonight's door opens", async () => {
    places.set(7, CORNER);
    me = meOn();
    const calendar = load(beforeSeven());
    await calendar.ready;
    expect(door(3).querySelectorAll(".elf-door__marks .elf-mark").length).toBe(0);
    // One of the family's detectives has been to door 3 since the page was loaded.
    server = sharedSeven(at("2026-12-07T19:00:05.000Z"));
    me = meOn({ known: [7], doors: [{ door: 3, cracked: false, visited: true }] });
    await calendar.poll();
    expect(door(3).querySelectorAll(".elf-door__marks .elf-mark").length).toBe(1);
    expect(words(detail(3).querySelector(".elf-detail__mine"))).toBe("Your family has been there. Candy cane collected.");
  });

  it("read nothing more when a new elf joins an open door the family cannot see", async () => {
    me = meOn({ goes: [7] });
    const calendar = load(sharedSeven(SEVEN_05));
    await calendar.ready;
    const three = server.doors[2];
    server = { ...server, doors: server.doors.map((d) => (d.door === 3 ? { ...three, scrapbook: { elves: [...three.scrapbook!.elves, ELF_33], photos: [], count: 2 } } : d)) };
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/3"]);
    expect(detail(3).querySelectorAll(".elf-collage figure").length).toBe(2);
  });

  it("read nothing more when today's door is found while its place is still hidden", async () => {
    me = meOn();
    const calendar = load(calendarView(at("2026-12-07T17:45:00.000Z"), { state: "hunting" }));
    await calendar.ready;
    server = calendarView(at("2026-12-07T17:48:00.000Z"), {
      state: "found-hidden",
      found: { at: at("2026-12-07T17:47:00.000Z"), by: "Detective R. Tinselfoot" },
      revealAt: at("2026-12-07T19:00:00.000Z"),
    });
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7"]);
    expect(door(7).getAttribute("data-kind")).toBe("found-hidden");
  });

  // From the review of Task 8, Important 2: an answer that cannot be read just as tonight's door opens is asked for
  // again, or the door would open without the family's place, or without its Have a go line, until a reload.
  it("leave tonight's door exactly as it was while the family's answer cannot be read as it opens, and read it again on the next poll", async () => {
    places.set(7, CORNER);
    me = meOn();
    const calendar = load(beforeSeven());
    await calendar.ready;
    const was = door(7).outerHTML + detail(7).outerHTML;
    server = sharedSeven(at("2026-12-07T19:00:05.000Z"));
    me = { status: 500, body: {} };
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7", "/api/elf/me"]);
    expect(door(7).outerHTML + detail(7).outerHTML).toBe(was);
    expect(words($("#elf-board"))).not.toMatch(TROUBLE);
    // The next poll: the answer comes, and this family guessed.
    me = meOn({ known: [7] });
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7", "/api/elf/me", "/api/elf/me/door/7"]);
    expect(words(detail(7))).toContain("Corner Bakehouse, Snowford");
    expect(door(7).getAttribute("data-v")).toBe(doorVersion(server.doors[6], server.now));
  });

  it("leave tonight's door as it was while the family's answer cannot be read, then show Have a go once it says the family may have a go", async () => {
    me = meOn();
    const calendar = load(beforeSeven());
    await calendar.ready;
    const was = door(7).outerHTML + detail(7).outerHTML;
    server = sharedSeven(at("2026-12-07T19:00:05.000Z"));
    // A network failure this time, rather than an answer that is not 200.
    meOffline = true;
    await calendar.poll();
    expect(door(7).outerHTML + detail(7).outerHTML).toBe(was);
    expect(words($("#elf-board"))).not.toMatch(TROUBLE);
    meOffline = false;
    me = meOn({ goes: [7] });
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7", "/api/elf/me"]);
    expect(detail(7).querySelector<HTMLElement>(".elf-book__go")!.hidden).toBe(false);
    expect(detail(7).querySelector<HTMLElement>(".elf-detail__mine")!.hidden).toBe(true);
  });

  it.each([
    ["an answer that is not 200", false],
    ["a network failure", true],
  ])("give up after a minute when the family's answer still cannot be read (%s), and draw tonight's door as the calendar everyone shares does", async (_how, network) => {
    me = meOn();
    const calendar = load(beforeSeven());
    await calendar.ready;
    server = sharedSeven(at("2026-12-07T19:00:05.000Z"));
    me = { status: 500, body: {} };
    meOffline = network;
    await calendar.poll();
    clock += 30_000;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7", "/api/elf/me"]);
    expect(door(7).getAttribute("data-kind")).toBe("found-hidden");
    clock += 31_000;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7", "/api/elf/me"]);
    expect(door(7).getAttribute("data-kind")).toBe("found");
    expect(door(7).getAttribute("data-v")).toBe(doorVersion(server.doors[6], server.now));
    expect(words($("#elf-board"))).not.toMatch(TROUBLE);
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar"]);
  });

  // Ruling F15 on Plan 2c-1: door 5 as the calendar everyone shares draws it before Christmas Day, with no place and
  // a go; the fixture's past doors carry a place, as a family's own doors do, and offer none.
  it("keep the calendar's Have a go line on a door the family may still have a go at, with no line of its own", async () => {
    const view = calendarView(AFTERNOON);
    view.doors[4] = { ...view.doors[4], place: null, goUrl: "/elf/hq/door/5" };
    me = meOn({ goes: [5] });
    const calendar = load(view);
    await calendar.ready;
    const mine5 = detail(5).querySelector<HTMLElement>(".elf-detail__mine")!;
    const go5 = detail(5).querySelector<HTMLElement>(".elf-book__go")!;
    expect(mine5.hidden).toBe(true);
    expect(words(mine5)).toBe("");
    expect(go5.hidden).toBe(false);
    expect(go5.querySelector('a[href="/elf/hq/door/5"]')).not.toBeNull();
    // A door the family may not have a go at still says what is left to do there.
    expect(detail(4).querySelector<HTMLElement>(".elf-detail__mine")!.hidden).toBe(false);
  });

  // Ruling F4 on Plan 2c-1: with December's doors off the family's answer has no `known` nor `goes`, and the page
  // asks for nothing it did not ask for before.
  it("ask for nothing new with December's doors off: no family's door, and no second read of its answer", async () => {
    me = { status: 200, body: { doors: [{ door: 1, cracked: true, visited: false }], photos: [] } };
    const calendar = load();
    await calendar.ready;
    expect(calls).toEqual(["/api/elf/me"]);
    calls = [];
    findDoorSeven();
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7"]);
    // As before: an open door's hint steps aside for the family's own line.
    expect(detail(1).querySelector<HTMLElement>(".elf-detail__hint")!.hidden).toBe(true);
  });

  it("ask for no family's door on a calendar drawn with December's doors off, whatever the family's answer says", async () => {
    // An answer from the moment the doors were switched off, while the page was drawn with them off.
    places.set(7, CORNER);
    me = meOn({ known: [7], goes: [5] });
    const calendar = load({ ...sharedSeven(SEVEN_05), doorsOn: false });
    await calendar.ready;
    expect(calls).toEqual(["/api/elf/me"]);
    expect(words(detail(7))).not.toContain("Corner Bakehouse");
    calls = [];
    secondElfOnSeven();
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/7"]);
    // The family's line still steps in on door 5, as before.
    expect(detail(5).querySelector<HTMLElement>(".elf-detail__mine")!.hidden).toBe(false);
  });

  // The rulings on Plan 2c-1, from Task 5's review: from Christmas Day until 1 January the calendar everyone shares
  // carries every place and photo itself.
  it("ask for none of the family's doors from Christmas Day until 1 January, nor its answer again", async () => {
    const christmas = calendarView(at("2026-12-25T10:00:00.000Z"));
    christmas.doors[6] = { ...christmas.doors[6], place: CORNER };
    places.set(7, CORNER);
    me = meOn({ known: [7] });
    const calendar = load(christmas);
    await calendar.ready;
    expect(calls).toEqual(["/api/elf/me"]);
    expect(words(detail(7))).toContain("Corner Bakehouse");
    // A new elf on door 7, whose place the family can see, and on door 3, whose place it cannot.
    const later = at("2026-12-25T10:20:00.000Z");
    const more = (d: DoorView): DoorView => ({ ...d, scrapbook: { elves: [...d.scrapbook!.elves, ELF_72], photos: [], count: 2 } });
    server = { ...christmas, now: later, doors: christmas.doors.map((d) => (d.door === 3 || d.door === 7 ? more(d) : d)) };
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/door/3", "/api/elf/door/7"]);
    expect(words(detail(7))).toContain("Corner Bakehouse");
  });

  it("start the minute afresh after Christmas: a door still owed as Christmas Day began is not given up on at once on 1 January", async () => {
    const eve = calendarView(at("2026-12-24T23:59:30.000Z"));
    eve.doors[6] = { ...eve.doors[6], place: null, goUrl: "/elf/hq/door/7" };
    places.set(7, CORNER);
    me = meOn({ known: [7] });
    ownStatus = 404;
    const calendar = load(eve);
    await calendar.ready;
    // Christmas Day: the calendar everyone shares carries door 7's place itself.
    server = { ...eve, now: at("2026-12-25T00:00:10.000Z"), doors: eve.doors.map((d) => (d.door === 7 ? { ...d, place: CORNER, goUrl: null } : d)) };
    await calendar.poll();
    expect(words(detail(7))).toContain("Corner Bakehouse");
    // 1 January: the place leaves the shared calendar, and for a moment the family's answer has not got door 7.
    server = { ...server, now: at("2027-01-01T00:00:10.000Z"), doors: server.doors.map((d) => (d.door === 7 ? { ...d, place: null } : d)) };
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/door/7"]);
    expect(words(detail(7))).toContain("Corner Bakehouse");
    ownStatus = 200;
    calls = [];
    await calendar.poll();
    expect(calls).toEqual(["/api/elf/calendar", "/api/elf/me/door/7"]);
    expect(words(detail(7))).toContain("Corner Bakehouse, Snowford");
  });

  it("draw the doors the family can see from its own answers again from 1 January, as the places leave the calendar everyone shares, reading its answer no more", async () => {
    const lastNight = calendarView(at("2026-12-31T23:59:50.000Z"));
    lastNight.doors[6] = { ...lastNight.doors[6], place: CORNER };
    places.set(7, CORNER);
    me = meOn({ known: [7] });
    const calendar = load(lastNight);
    await calendar.ready;
    expect(calls).toEqual(["/api/elf/me"]);
    // Midnight as 1 January begins: the calendar everyone shares names no place again. Every door changes, and none
    // turns open, so the family's answer is not read again.
    server = { ...lastNight, now: at("2027-01-01T00:00:10.000Z"), doors: lastNight.doors.map((d) => ({ ...d, place: null })) };
    calls = [];
    await calendar.poll();
    expect(calls[0]).toBe("/api/elf/calendar");
    expect(calls).not.toContain("/api/elf/me");
    expect(calls).toContain("/api/elf/me/door/7");
    expect(calls).not.toContain("/api/elf/door/7");
    expect(calls).toContain("/api/elf/door/3");
    expect(words(detail(7))).toContain("Corner Bakehouse, Snowford");
    expect(words(detail(3))).not.toContain("Shop number 3");
  });
});
