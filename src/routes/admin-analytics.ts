import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection } from "./admin-authz";
import { actorOf } from "./admin";
import { pulseSwitch } from "./pulse";
import { getAnalyticsSettings, setCollecting } from "../db/analytics";
import { readAnalyticsReport } from "../db/analytics-report";
import { PERIOD_DAYS, type PeriodDays } from "../analytics/report";

// TASK-482: Admin > Analytics.
//
//   GET /api/admin/analytics?days=7|30|90   every panel for the period and the one before   analytics: view
//   GET /api/admin/analytics/settings        the collecting switch                            analytics: view
//   PUT /api/admin/analytics/settings        { collecting }                                   analytics: edit
//
// Changing the switch writes an audit_log row (setCollecting) and then makes POST /api/pulse forget
// the value it remembered, so counting starts or stops on this task at once rather than within 30
// seconds. Other tasks catch up within those 30 seconds.

export const adminAnalyticsRouter = Router();

function readDays(raw: unknown): PeriodDays | null {
  if (raw === undefined || raw === "") return 30;
  const n = Number(raw);
  return (PERIOD_DAYS as readonly number[]).includes(n) ? (n as PeriodDays) : null;
}

export async function getAnalytics(req: Request, res: Response): Promise<void> {
  if (!(await authorizeSection(req, res, "analytics", "view"))) return;
  const days = readDays(req.query?.days);
  if (days === null) {
    res.status(400).json({ error: "Choose 7, 30 or 90 days." });
    return;
  }
  try {
    res.json(await readAnalyticsReport(days));
  } catch (err) {
    console.error("analytics report failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The numbers could not be loaded. Please try again." });
  }
}

export async function getAnalyticsSettingsRoute(req: Request, res: Response): Promise<void> {
  if (!(await authorizeSection(req, res, "analytics", "view"))) return;
  try {
    res.json(await getAnalyticsSettings());
  } catch (err) {
    console.error("analytics settings read failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The switch could not be checked. Please try again." });
  }
}

const settingsBody = z.object({ collecting: z.boolean() }).strict();

export async function putAnalyticsSettings(req: Request, res: Response): Promise<void> {
  const claims = await authorizeSection(req, res, "analytics", "edit");
  if (!claims) return;
  const body = settingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Send whether to count visits, on or off." });
    return;
  }
  try {
    const settings = await setCollecting(body.data.collecting, actorOf(claims));
    pulseSwitch.forget();
    res.json(settings);
  } catch (err) {
    console.error("analytics switch failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The switch could not be changed. Please try again." });
  }
}

adminAnalyticsRouter.get("/api/admin/analytics", getAnalytics);
adminAnalyticsRouter.get("/api/admin/analytics/settings", getAnalyticsSettingsRoute);
adminAnalyticsRouter.put("/api/admin/analytics/settings", putAnalyticsSettings);
