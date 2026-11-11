import { describe, it, expect, vi } from "vitest";
import { CALENDAR_CACHE_MS, makePublicCalendar } from "../../src/elf/public-calendar";
import type { CalendarView } from "../../src/elf/pages/types";

// NBCC Elf Detective School: the public calendar is the same for every visitor, so it is built at most
// once every 15 seconds in the process and shared between everyone who asks in that time. A build
// that is still going is waited for, never started again.

const at = (iso: string) => new Date(iso);
const START = at("2026-12-07T17:47:00.000Z");
const later = (ms: number) => new Date(START.getTime() + ms);

/** A pretend calendar, told apart by the moment it was built for. */
const viewAt = (now: Date) => ({ year: 2026, now, doors: [], price: { from: "£1", suggested: "£5" }, joinUrl: "/elf/join", hqUrl: "/elf/hq" }) as CalendarView;

describe("the public calendar's cache", () => {
  it("keeps a calendar for 15 seconds", () => {
    expect(CALENDAR_CACHE_MS).toBe(15_000);
  });

  it("builds once for five visitors inside 15 seconds, all of them handed the same calendar", async () => {
    const load = vi.fn(async (now: Date) => viewAt(now));
    const calendar = makePublicCalendar({ load });
    const views = [];
    for (const ms of [0, 1_000, 5_000, 10_000, 14_900]) views.push(await calendar.get(later(ms)));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(START);
    for (const v of views) expect(v.now).toEqual(START);
  });

  it("builds again for a visitor 15.1 seconds after the last build", async () => {
    const load = vi.fn(async (now: Date) => viewAt(now));
    const calendar = makePublicCalendar({ load });
    await calendar.get(START);
    const fresh = await calendar.get(later(15_100));
    expect(load).toHaveBeenCalledTimes(2);
    expect(fresh.now).toEqual(later(15_100));
  });

  it("hands two visitors who arrive during one build the same build, and starts no second one", async () => {
    let finish: (v: CalendarView) => void = () => undefined;
    const load = vi.fn(() => new Promise<CalendarView>((resolve) => (finish = resolve)));
    const calendar = makePublicCalendar({ load });
    const first = calendar.get(START);
    const second = calendar.get(later(200));
    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    finish(viewAt(START));
    expect(await second).toBe(await first);
  });

  it("keeps no failed build: the next visitor starts a new one", async () => {
    const load = vi.fn<(now: Date) => Promise<CalendarView>>().mockRejectedValueOnce(new Error("the database is away")).mockImplementation(async (now) => viewAt(now));
    const calendar = makePublicCalendar({ load });
    await expect(calendar.get(START)).rejects.toThrow("the database is away");
    const view = await calendar.get(later(1_000));
    expect(load).toHaveBeenCalledTimes(2);
    expect(view.now).toEqual(later(1_000));
  });

  it("builds again when the clock reads earlier than the last build, rather than hand back a calendar from the future", async () => {
    const load = vi.fn(async (now: Date) => viewAt(now));
    const calendar = makePublicCalendar({ load });
    await calendar.get(later(10_000));
    const view = await calendar.get(START);
    expect(load).toHaveBeenCalledTimes(2);
    expect(view.now).toEqual(START);
  });
});
