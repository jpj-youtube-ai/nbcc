// TASK-479: the "collecting" switch, remembered for a short while so that every page view does
// not have to ask the database. A failed read counts as OFF (nothing is collected when we cannot
// tell), and that is remembered for a few seconds, so a struggling database is not asked again by
// every event while it recovers.

export function createSwitchCache(opts: { ttlMs: number; read: () => Promise<boolean>; failTtlMs?: number }) {
  const failTtlMs = opts.failTtlMs ?? 5000;
  let failedAt: number | null = null;
  let cached: { on: boolean; at: number } | null = null;
  return {
    async isOn(now: number): Promise<boolean> {
      if (cached && now - cached.at < opts.ttlMs) return cached.on;
      if (failedAt !== null && now - failedAt < failTtlMs) return false;
      try {
        const on = await opts.read();
        cached = { on, at: now };
        failedAt = null;
        return on;
      } catch {
        cached = null;
        failedAt = now;
        return false;
      }
    },
    /** Called when the switch is changed from this process, so the change takes effect at once. */
    forget(): void {
      cached = null;
      failedAt = null;
    },
  };
}
