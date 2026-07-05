// A tiny sliding-window rate limiter for the portal self-request route (REQ-061 · TASK-123).
// Pure + DB-free: state is an in-memory map of key -> hit timestamps, and `now` is injected so
// the window logic is deterministically unit-testable. In-memory state is PER-TASK — acceptable
// for the single Fargate task today; a distributed limiter is a documented follow-up.
export function createRateLimiter(opts: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  let callCount = 0;

  // Lightweight periodic sweep: every 1000 calls, drop keys whose most recent hit has
  // already fallen out of the window. Without this, keys that are hit once and never
  // revisited would accumulate in the map forever (unbounded memory over process lifetime).
  function sweep(now: number): void {
    const cutoff = now - opts.windowMs;
    for (const [key, timestamps] of hits) {
      const last = timestamps[timestamps.length - 1];
      if (last === undefined || last <= cutoff) {
        hits.delete(key);
      }
    }
  }

  return {
    allow(key: string, now: number): boolean {
      callCount += 1;
      if (callCount % 1000 === 0) {
        sweep(now);
      }

      const cutoff = now - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length === 0) {
        hits.delete(key);
      }
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    // Test-only seam: exposes the number of tracked keys, to assert eviction behaviour.
    size(): number {
      return hits.size;
    },
  };
}
