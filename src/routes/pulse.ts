import express, { Router } from "express";
import { config } from "../config";
import { handlePulse, type PulseRequest } from "../analytics/pulse-handler";
import { pulseLimiter } from "../analytics/limiter";
import { PULSE_MAX_BYTES } from "../analytics/payload";
import { resolvePlace } from "../analytics/place";
import { createSwitchCache } from "../analytics/switch-cache";
import {
  getCollecting,
  insertClick,
  insertView,
  lastArrival,
  recordLeave,
  saltFor,
} from "../db/analytics";

// TASK-479: POST /api/pulse, where assets/js/pulse.js sends its page views, leaves and clicks.
//
// It always answers 204 with nothing in the body, whatever happened: kept, dropped because the
// switch is off, over the rate limit, from a bot, malformed, too big, or a database failure. A
// page can never notice, and a visitor never sees an error because of it.
//
// The body is JSON sent as text/plain (so the browser makes no preflight), at most 2 KB. This
// router is mounted BEFORE the global express.json in src/app.ts, so even a JSON body is read here
// under the 2 KB cap rather than rejected with an error by the 100 KB parser.

// The switch is remembered for 30 seconds in production so that every event does not ask the
// database. Elsewhere it is read every time, so a test that flips it sees the change at once.
export const pulseSwitch = createSwitchCache({
  ttlMs: config.NODE_ENV === "production" ? 30_000 : 0,
  read: getCollecting,
});

const limiter = pulseLimiter();

function realHandler(req: PulseRequest) {
  return handlePulse(req, {
    now: () => new Date(),
    isCollecting: (now) => pulseSwitch.isOn(now),
    limiter,
    saltFor,
    lastArrival,
    insertView,
    recordLeave,
    insertClick,
    resolvePlace,
  });
}

export function createPulseRouter(handle: (req: PulseRequest) => Promise<unknown> = realHandler): Router {
  const router = Router();
  const readText = express.text({ type: () => true, limit: PULSE_MAX_BYTES });

  router.post("/api/pulse", (req, res) => {
    readText(req, res, (err?: unknown) => {
      void (async () => {
        try {
          if (!err && typeof req.body === "string") {
            await handle({
              body: req.body,
              ip: req.ip ?? "",
              userAgent: req.get("user-agent") ?? "",
              host: req.hostname ?? "",
            });
          }
        } catch (e) {
          console.error("pulse failed:", e instanceof Error ? e.message : e);
        } finally {
          res.status(204).end();
        }
      })();
    });
  });

  return router;
}

export const pulseRouter = createPulseRouter();
