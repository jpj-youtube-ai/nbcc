// TASK-479: the "collecting" switch, remembered for a short while so that every page view does
// not have to ask the database. A failed read counts as OFF (nothing is collected when we cannot
// tell) and is not remembered, so the next event asks again.

export function createSwitchCache(opts: { ttlMs: number; read: () => Promise<boolean> }) {
  let cached: { on: boolean; at: number } | null = null;
  return {
    async isOn(now: number): Promise<boolean> {
      if (cached && now - cached.at < opts.ttlMs) return cached.on;
      try {
        const on = await opts.read();
        cached = { on, at: now };
        return on;
      } catch {
        cached = null;
        return false;
      }
    },
    /** Called when the switch is changed from this process, so the change takes effect at once. */
    forget(): void {
      cached = null;
    },
  };
}
