// A tiny sliding-window rate limiter for the portal self-request route (REQ-061 · TASK-123).
// Pure + DB-free: state is an in-memory map of key -> hit timestamps, and `now` is injected so
// the window logic is deterministically unit-testable. In-memory state is PER-TASK — acceptable
// for the single Fargate task today; a distributed limiter is a documented follow-up.
export function createRateLimiter(opts: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, now: number): boolean {
      const cutoff = now - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
