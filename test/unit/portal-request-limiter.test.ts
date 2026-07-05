import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../../src/portal/request-limiter";

describe("createRateLimiter", () => {
  it("allows up to max within the window, then denies", () => {
    const rl = createRateLimiter({ max: 2, windowMs: 1000 });
    expect(rl.allow("a@x", 0)).toBe(true);
    expect(rl.allow("a@x", 100)).toBe(true);
    expect(rl.allow("a@x", 200)).toBe(false); // 3rd in window
  });

  it("tracks keys independently", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.allow("a@x", 0)).toBe(true);
    expect(rl.allow("b@x", 0)).toBe(true); // different key, own budget
    expect(rl.allow("a@x", 0)).toBe(false);
  });

  it("frees the budget once the window has passed", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.allow("a@x", 0)).toBe(true);
    expect(rl.allow("a@x", 500)).toBe(false);
    expect(rl.allow("a@x", 1001)).toBe(true); // window elapsed
  });

  it("evicts stale keys via the periodic sweep so memory stays bounded", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    // One-off hit for a key that is never revisited.
    expect(rl.allow("stale@x", 0)).toBe(true);
    expect(rl.size()).toBe(1);

    // Drive 999 more calls (a different, still-fresh key) well past the stale key's
    // window so the 1000th call triggers the sweep and reclaims it.
    for (let i = 0; i < 998; i++) {
      rl.allow("fresh@x", 2000 + i);
    }
    // Call #1000 total.
    rl.allow("fresh@x", 3000);

    // The stale key's window (cutoff = 3000 - 1000 = 2000) elapsed long ago, so the
    // sweep should have deleted it; only the fresh key remains tracked.
    expect(rl.size()).toBe(1);
  });
});
