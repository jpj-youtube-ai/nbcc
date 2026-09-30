// TASK-479: analytics shares the database pool with donations (src/db/pool.ts, 5 connections). So
// at most a couple of analytics events are worked on at once in this process; one that arrives
// while they are busy is dropped, never queued. A burst of visits can then never leave a donation
// waiting for a connection.

export const BUSY = Symbol("busy");

export function createConcurrencyGate(max: number) {
  let inFlight = 0;
  return {
    async tryRun<T>(work: () => Promise<T>): Promise<T | typeof BUSY> {
      if (inFlight >= max) return BUSY;
      inFlight += 1;
      try {
        return await work();
      } finally {
        inFlight -= 1;
      }
    },
  };
}
