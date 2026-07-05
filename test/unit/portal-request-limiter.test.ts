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
});
