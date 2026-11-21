import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-646: where a live total's number comes from. The send reads UNCACHED (so a failure is a
// failure, not a zero); the preview, the test send and the checks read the public pages' cached
// numbers (a minute old at most, never a throw), and only the sources the newsletter uses.

const h = vi.hoisted(() => ({
  redNow: vi.fn(async () => ({ everyonePence: 1_560_000, byWorkshopPence: new Map() })),
  redCached: vi.fn(async () => ({ everyonePence: 1_560_000, byWorkshopPence: new Map() })),
  sleighNow: vi.fn(async () => ({ onlinePence: 1, cardPence: 2, bucketPence: 3, totalPence: 123_400, gifts: 9 })),
  sleighCached: vi.fn(async (): Promise<{ totalPence: number } | null> => ({ totalPence: 123_400 })),
}));
vi.mock("../../src/db/red-bag-workshops", () => ({ readRedBagWorkshopTotalsNow: h.redNow, redBagWorkshopTotals: h.redCached }));
vi.mock("../../src/db/sleigh", () => ({ readSleighTotalsNow: h.sleighNow, sleighTotals: h.sleighCached }));

import { readLiveNumberNow, liveNumbersCached } from "../../src/newsletter/live-numbers";

beforeEach(() => {
  for (const f of Object.values(h)) f.mockClear();
});

describe("readLiveNumberNow (the send's read)", () => {
  it("counts bags as the Workshop's sign does, one for every £50", async () => {
    expect(await readLiveNumberNow("redBag")).toBe(312);
    expect(h.redNow).toHaveBeenCalled();
    expect(h.redCached).not.toHaveBeenCalled();
  });

  it("gives the sleigh's total in pence", async () => {
    expect(await readLiveNumberNow("sleigh")).toBe(123_400);
    expect(h.sleighCached).not.toHaveBeenCalled();
  });

  it("lets a failure through, so the send can tell it from a zero", async () => {
    h.redNow.mockRejectedValueOnce(new Error("away"));
    await expect(readLiveNumberNow("redBag")).rejects.toThrow("away");
  });
});

describe("liveNumbersCached (the preview's read)", () => {
  it("reads only the sources asked for, from the cached readers", async () => {
    expect(await liveNumbersCached(["sleigh"])).toEqual({ sleigh: 123_400 });
    expect(h.redCached).not.toHaveBeenCalled();
    expect(await liveNumbersCached(["redBag", "sleigh"])).toEqual({ redBag: 312, sleigh: 123_400 });
    expect(h.redNow).not.toHaveBeenCalled();
    expect(await liveNumbersCached([])).toEqual({});
  });

  it("has no number for the sleigh when its cached read has nothing", async () => {
    h.sleighCached.mockResolvedValueOnce(null);
    expect(await liveNumbersCached(["sleigh"])).toEqual({ sleigh: null });
  });
});
