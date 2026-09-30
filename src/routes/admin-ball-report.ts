import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSections } from "./admin-authz";
import { actorOf } from "./admin";
import { londonDate, nextSendDay, recipientsSchema, renderReport } from "../ball/sales-report";
import { BALL_DAY, sendTestReport } from "../ball/sales-report-runner";
import {
  getReportSettings,
  lastCountedTo,
  readSalesInputs,
  saveReportSettings,
  scheduledSendExists,
} from "../db/ball-report";

// TASK-464: the Festive Ball ticket report, set up from the Events page.
//
//   GET  /api/admin/ball-report        the switch, who it goes to, what went, and a preview   events: view
//   PUT  /api/admin/ball-report        { reportOn, recipients }                              events: edit
//   POST /api/admin/ball-report/test   the real email, marked as a test, to the person asking events: edit
//
// Every one also needs the Festive Ball at view or above: the numbers are the Ball's, and access
// that leaves the Ball out must not see them by way of Events. Every role has that by default.
//
// The report itself is counts only (src/ball/sales-report.ts). The recipients are business
// contacts, and every change to them writes an audit row saying who was added or removed, and by
// whom (src/db/ball-report.ts).

const VIEW = [["events", "view"], ["ball", "view"]] as const;
const EDIT = [["events", "edit"], ["ball", "view"]] as const;

export const adminBallReportRouter = Router();

async function reportPayload(now = new Date()) {
  const settings = await getReportSettings();
  const today = londonDate(now);
  const inputs = await readSalesInputs(now, await lastCountedTo());
  const preview = renderReport(inputs, { today, eventDate: BALL_DAY, test: false });
  const next =
    settings.reportOn && settings.recipients.length > 0
      ? nextSendDay({ now, eventDate: BALL_DAY, sentToday: await scheduledSendExists(today) })
      : null;
  return { ...settings, nextSend: next, preview: { subject: preview.subject, html: preview.html } };
}

adminBallReportRouter.get("/api/admin/ball-report", async (req: Request, res: Response) => {
  if (!(await authorizeSections(req, res, VIEW))) return;
  try {
    res.json(await reportPayload());
  } catch (err) {
    console.error("ball report read failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The ticket report could not be loaded. Please try again." });
  }
});

const saveBody = z.object({ reportOn: z.boolean(), recipients: z.array(z.unknown()) }).strict();

adminBallReportRouter.put("/api/admin/ball-report", async (req: Request, res: Response) => {
  const claims = await authorizeSections(req, res, EDIT);
  if (!claims) return;
  const body = saveBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Send the switch and the list of people." });
    return;
  }
  const recipients = recipientsSchema.safeParse(body.data.recipients);
  if (!recipients.success) {
    const issue = recipients.error.issues[0];
    res.status(400).json({ error: issue?.message ?? "Check the list of people.", path: issue?.path ?? [] });
    return;
  }
  if (body.data.reportOn && recipients.data.length === 0) {
    res.status(400).json({ error: "Add at least one person before switching the report on." });
    return;
  }
  try {
    await saveReportSettings({ reportOn: body.data.reportOn, recipients: recipients.data }, actorOf(claims));
    res.json(await reportPayload());
  } catch (err) {
    console.error("ball report save failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The ticket report could not be saved. Please try again." });
  }
});

adminBallReportRouter.post("/api/admin/ball-report/test", async (req: Request, res: Response) => {
  const claims = await authorizeSections(req, res, EDIT);
  if (!claims) return;
  try {
    await sendTestReport({ to: claims.email, actor: actorOf(claims), now: new Date() });
    res.json({ sentTo: [claims.email] });
  } catch (err) {
    console.error("ball report test failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The test could not be sent. Please try again." });
  }
});
