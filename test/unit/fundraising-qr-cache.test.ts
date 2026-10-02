import { describe, it, expect, vi } from "vitest";
import { QR_CACHE_MAX, createQrCache } from "../../src/fundraising/qr-cache";

// TASK-504 review: a fundraiser's QR code depends only on its address, so each one is drawn once and
// kept in memory, in a cache that never grows past QR_CACHE_MAX entries (the oldest goes first).

describe("the QR code cache", () => {
  it("draws a code once, then hands back the same one", () => {
    const cache = createQrCache<string>();
    const draw = vi.fn((url: string) => `drawn ${url}`);
    expect(cache.get("https://nbcc.test/fundraise/a", draw)).toBe("drawn https://nbcc.test/fundraise/a");
    expect(cache.get("https://nbcc.test/fundraise/a", draw)).toBe("drawn https://nbcc.test/fundraise/a");
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("keeps each address apart", () => {
    const cache = createQrCache<string>();
    const draw = vi.fn((url: string) => url.toUpperCase());
    cache.get("a", draw);
    cache.get("b", draw);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it("holds at most 500, letting the oldest go", () => {
    expect(QR_CACHE_MAX).toBe(500);
    const cache = createQrCache<number>();
    const draw = vi.fn((url: string) => Number(url));
    for (let i = 0; i < QR_CACHE_MAX + 25; i++) cache.get(String(i), draw);
    expect(cache.size()).toBe(QR_CACHE_MAX);
    draw.mockClear();
    cache.get(String(QR_CACHE_MAX + 24), draw); // the newest is still there
    expect(draw).not.toHaveBeenCalled();
    cache.get("0", draw); // the oldest was let go, so it is drawn again
    expect(draw).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(QR_CACHE_MAX);
  });
});
