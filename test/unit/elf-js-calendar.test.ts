// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { calendarStatus, renderCalendarPage } from "../../src/elf/pages/calendar";
import { doorDetail, doorTile, doorVersion } from "../../src/elf/pages/door";
import type { CalendarView, DoorView } from "../../src/elf/pages/types";
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

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const door = (n: number) => $(`#door-${n}`);
const detail = (n: number) => $(`#case-${n}`);
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function answer(url: string): { status: number; body: unknown } {
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
    if (offline) return Promise.reject(new Error("offline"));
    const a = answer(url);
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
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
