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
    expect(words(mine(2))).toBe("Your family cracked this case. Visit before the Night Before Christmas for your candy cane too.");
    expect(words(mine(4))).toBe("Your family has been there. Candy cane collected.");
    expect(words(mine(3))).toBe("Not done yet. Visit before the Night Before Christmas for your candy cane.");
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
