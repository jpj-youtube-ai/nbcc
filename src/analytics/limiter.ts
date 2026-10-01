// TASK-479: at most 120 analytics events a minute from one IP address, in memory, using the house
// sliding-window limiter (src/portal/request-limiter.ts). Events over the limit are dropped quietly.
import { createRateLimiter } from "../portal/request-limiter";

export const PULSE_EVENTS_PER_MINUTE = 120;

export function pulseLimiter() {
  return createRateLimiter({ max: PULSE_EVENTS_PER_MINUTE, windowMs: 60_000 });
}
