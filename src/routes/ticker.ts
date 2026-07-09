import { Router, type Request, type Response } from "express";
import { listActiveSupporterNames } from "../db/ticker";

// Public supporter-ticker feed (TASK-178/REQ-003). GET /api/supporters/ticker returns the active
// supporter names, in display order, for the scrolling ticker the marketing pages render under the
// nav (assets/js/main.js). Read-only and unauthenticated; names only (no ids or timestamps).
export const tickerRouter = Router();

tickerRouter.get("/api/supporters/ticker", async (_req: Request, res: Response) => {
  try {
    const names = await listActiveSupporterNames();
    return res.status(200).json({ supporters: names });
  } catch (err) {
    console.error("supporter ticker feed failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Ticker is temporarily unavailable" });
  }
});
