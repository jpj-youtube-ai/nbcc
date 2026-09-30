import { describe, it, expect, vi } from "vitest";
import { createSwitchCache } from "../../src/analytics/switch-cache";
import { pulseLimiter } from "../../src/analytics/limiter";
import { retentionCutoff } from "../../src/analytics/retention";

// TASK-479: the switch is read at most every 30 seconds, not on every event.

describe("createSwitchCache", () => {
  it("reads the switch once and keeps the answer for the time it is given", async () => {
    const read = vi.fn(async () => true);
    const cache = createSwitchCache({ ttlMs: 30_000, read });
    expect(await cache.isOn(0)).toBe(true);
    expect(await cache.isOn(29_999)).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await cache.isOn(30_000)).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads every time when given no time to keep it", async () => {
    const read = vi.fn(async () => false);
    const cache = createSwitchCache({ ttlMs: 0, read });
    await cache.isOn(0);
    await cache.isOn(0);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("counts a failed read as off, and tries again next time", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(true);
    const cache = createSwitchCache({ ttlMs: 30_000, read });
    expect(await cache.isOn(0)).toBe(false);
    expect(await cache.isOn(1)).toBe(true);
  });

  it("forgets its answer when told the switch has changed", async () => {
    let on = false;
    const cache = createSwitchCache({ ttlMs: 30_000, read: async () => on });
    expect(await cache.isOn(0)).toBe(false);
    on = true;
    cache.forget();
    expect(await cache.isOn(1)).toBe(true);
  });
});

describe("pulseLimiter", () => {
  it("allows 120 events a minute from one address, then drops the rest", () => {
    const limiter = pulseLimiter();
    for (let i = 0; i < 120; i++) expect(limiter.allow("203.0.113.7", 1000 + i)).toBe(true);
    expect(limiter.allow("203.0.113.7", 2000)).toBe(false);
    expect(limiter.allow("198.51.100.1", 2000)).toBe(true);
    expect(limiter.allow("203.0.113.7", 61_001)).toBe(true);
  });
});

describe("retentionCutoff", () => {
  it("is 13 months before today", () => {
    expect(retentionCutoff("2026-10-01")).toBe("2025-09-01");
    expect(retentionCutoff("2027-03-31")).toBe("2026-02-28");
  });
});
