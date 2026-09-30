import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection } from "./admin-authz";
import { actorOf } from "./admin";
import { config } from "../config";
import { sendBallReport } from "../clients/email";
import { londonDate, nextSendDay, recipientsSchema, renderReport } from "../ball/sales-report";
import { BALL_DAY } from "../ball/sales-report-runner";
import {
  getReportSettings,
  lastScheduledSendAt,
  readSalesInputs,
  recordTestSend,
  saveReportSettings,
  scheduledSendExists,
} from "../db/ball-report";

// TASK-464: the Festive Ball ticket report, set up from the Events page.
//
//   GET  /api/admin/ball-report        the switch, who it goes to, what went, and a preview   events: view
//   PUT  /api/admin/ball-report        { reportOn, recipients }                              events: edit
//   POST /api/admin/ball-report/test   the real email, marked as a test, to the person asking events: edit
//
// The report itself is counts only (src/ball/sales-report.ts). The recipients are business
// contacts, and every change to them writes an audit row saying who was added or removed, and by
// whom (src/db/ball-report.ts).

export const adminBallReportRouter = Router();

async function reportPayload(now = new Date()) {
  const settings = await getReportSettings();
  const today = londonDate(now);
  const inputs = await readSalesInputs(now, await lastScheduledSendAt());
  const preview = renderReport(inputs, { today, eventDate: BALL_DAY, test: false });
  const next =
    settings.reportOn && settings.recipients.length > 0
      ? nextSendDay({ now, eventDate: BALL_DAY, sentToday: await scheduledSendExists(today) })
      : null;
  return { ...settings, nextSend: next, preview: { subject: preview.subject, html: preview.html } };
}

adminBallReportRouter.get("/api/admin/ball-report", async (req: Request, res: Response) => {
  if (!(await authorizeSection(req, res, "events", "view"))) return;
  try {
    res.json(await reportPayload());
  } catch (err) {
    console.error("ball report read failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The ticket report could not be loaded. Please try again." });
  }
});

const saveBody = z.object({ reportOn: z.boolean(), recipients: z.array(z.unknown()) }).strict();

adminBallReportRouter.put("/api/admin/ball-report", async (req: Request, res: Response) => {
  const claims = await authorizeSection(req, res, "events", "edit");
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
  const claims = await authorizeSection(req, res, "events", "edit");
  if (!claims) return;
  const now = new Date();
  const today = londonDate(now);
  try {
    const inputs = await readSalesInputs(now, await lastScheduledSendAt());
    const email = renderReport(inputs, { today, eventDate: BALL_DAY, test: true });
    // Only ever to the person asking: a test must never reach the organiser or the sponsor.
    await sendBallReport({ to: [claims.email], from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...email });
    await recordTestSend(today, claims.email, inputs, actorOf(claims));
    res.json({ sentTo: [claims.email] });
  } catch (err) {
    console.error("ball report test failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The test could not be sent. Please try again." });
  }
});
