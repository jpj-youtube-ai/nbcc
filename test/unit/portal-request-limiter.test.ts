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

  // Elf Detective School's grand prize entry (Plan 2c-2's final review, issue 1): a try that came to nothing through no
  // fault of the caller's (the picture maker busy) is given back, so pressing again never uses up the window's tries.
  it("gives back a key's most recent hit, so that try can be made again", () => {
    const rl = createRateLimiter({ max: 2, windowMs: 1000 });
    expect(rl.allow("a@x", 0)).toBe(true);
    expect(rl.allow("a@x", 100)).toBe(true);
    rl.giveBack("a@x");
    expect(rl.allow("a@x", 200)).toBe(true);
    expect(rl.allow("a@x", 300)).toBe(false);
  });

  it("gives back only the most recent hit, so the older ones still leave the window when they would have", () => {
    const rl = createRateLimiter({ max: 2, windowMs: 1000 });
    expect(rl.allow("a@x", 0)).toBe(true);
    expect(rl.allow("a@x", 900)).toBe(true);
    rl.giveBack("a@x"); // the hit at 900 goes; the one at 0 stays until 1000
    expect(rl.allow("a@x", 950)).toBe(true);
    expect(rl.allow("a@x", 960)).toBe(false);
    expect(rl.allow("a@x", 1001)).toBe(true); // the hit at 0 has left the window
  });

  it("gives back nothing to a key with no hits, nor to any other key, and keeps no empty key", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    rl.giveBack("nobody@x");
    expect(rl.size()).toBe(0);
    expect(rl.allow("a@x", 0)).toBe(true);
    expect(rl.allow("b@x", 0)).toBe(true);
    rl.giveBack("a@x");
    expect(rl.size()).toBe(1);
    expect(rl.allow("b@x", 10)).toBe(false);
    expect(rl.allow("a@x", 10)).toBe(true);
    // Giving back more than was taken never leaves room for more than the window allows.
    rl.giveBack("a@x");
    rl.giveBack("a@x");
    expect(rl.allow("a@x", 20)).toBe(true);
    expect(rl.allow("a@x", 30)).toBe(false);
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
