import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection } from "./admin-authz";
import { actorOf } from "./admin";
import { config } from "../config";
import { getSettings } from "../db/ball";
import { getChaseRecipients, listChaseBookings, listRecentChaseSends, saveChaseRecipients } from "../db/ball-chase";
import { sendBallChaseList, sendBallRunUp } from "../clients/email";
import { BALL_DAY } from "../ball/sales-report-runner";
import { guestLink } from "../ball/run-up-runner";
import { parseMenu } from "../ball/menu";
import { chaseRecipientsSchema, nextChaseRound, planReminders } from "../ball/chase";
import { buildChaseListEmail, buildChaseReminderEmail, exampleChaseList, exampleReminderGroup } from "../ball/chase-email";

// TASK-575: the "Chasing guests and meals" card in the Festive Ball admin's Emails section.
//
//   GET  /api/admin/ball-chase        who the chase list goes to, the deadline, the next round, what went   ball: view
//   PUT  /api/admin/ball-chase        { recipients }, the volunteers' list                                  ball: edit
//   POST /api/admin/ball-chase/test   { which: "reminder" | "list" }, an example email to the person asking ball: edit
//
// The chasing itself is automatic (src/ball/chase-runner.ts, the 8am daily task); this card only shows
// the next round, keeps the volunteers' list, and lets staff see each email. A test is built from the
// invented examples in src/ball/chase-email.ts, never from a real booking, goes only to the signed-in
// person's own address, and is never recorded as a send (ball_chase_sends), so it cannot stop a real
// one. The list carries people's phone numbers, so who it goes to is nbcc.scot addresses only
// (chaseRecipientsSchema), and every change to it writes an audit row (src/db/ball-chase.ts).

export const adminBallChaseRouter = Router();

// What a test shows as its deadline when none is set yet.
const EXAMPLE_DEADLINE = new Date("2026-11-04T10:00:00Z");

async function chasePayload(now = new Date()) {
  const settings = await getSettings();
  const lockAt = settings.guestDetailsLockAt ? new Date(settings.guestDetailsLockAt) : null;
  const round = nextChaseRound(now, lockAt, BALL_DAY);
  let nextRound: { day: string; daysToDeadline: number; reminders: number } | null = null;
  if (round) {
    // Who would be emailed on that day, as the bookings stand now.
    const groups = planReminders(await listChaseBookings(), parseMenu(settings.menuOptions), round.day);
    nextRound = { ...round, reminders: groups.length };
  }
  return {
    recipients: await getChaseRecipients(),
    deadline: lockAt ? lockAt.toISOString() : null,
    nextRound,
    lastSends: await listRecentChaseSends(5),
  };
}

adminBallChaseRouter.get("/api/admin/ball-chase", async (req: Request, res: Response) => {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    res.json(await chasePayload());
  } catch (err) {
    console.error("ball chase read failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The chasing settings could not be loaded. Please try again." });
  }
});

const saveBody = z.object({ recipients: z.array(z.unknown()) }).strict();

adminBallChaseRouter.put("/api/admin/ball-chase", async (req: Request, res: Response) => {
  const claims = await authorizeSection(req, res, "ball", "edit");
  if (!claims) return;
  const body = saveBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Send the list of people." });
    return;
  }
  const recipients = chaseRecipientsSchema.safeParse(body.data.recipients);
  if (!recipients.success) {
    const issue = recipients.error.issues[0];
    res.status(400).json({ error: issue?.message ?? "Check the list of people.", path: issue?.path ?? [] });
    return;
  }
  try {
    await saveChaseRecipients(recipients.data, actorOf(claims));
    res.json(await chasePayload());
  } catch (err) {
    console.error("ball chase save failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The list could not be saved. Please try again." });
  }
});

const testBody = z.object({ which: z.enum(["reminder", "list"]) }).strict();

adminBallChaseRouter.post("/api/admin/ball-chase/test", async (req: Request, res: Response) => {
  const claims = await authorizeSection(req, res, "ball", "edit");
  if (!claims) return;
  const body = testBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Say which test to send: a reminder or the chase list." });
    return;
  }
  try {
    const settings = await getSettings();
    const deadline = settings.guestDetailsLockAt ? new Date(settings.guestDetailsLockAt) : EXAMPLE_DEADLINE;
    // Only ever to the person asking: a test must never reach a booker or a volunteer.
    if (body.data.which === "reminder") {
      const mail = buildChaseReminderEmail({ group: exampleReminderGroup(), daysToDeadline: 5, deadline, guestLink });
      await sendBallRunUp({
        email: claims.email,
        from: config.BALL_FROM_EMAIL,
        replyTo: config.BALL_FROM_EMAIL,
        ...mail,
        subject: `Test: ${mail.subject}`,
      });
    } else {
      const mail = buildChaseListEmail({ list: exampleChaseList(), daysToDeadline: 5, deadline, guestLink, test: true });
      await sendBallChaseList({ to: [claims.email], from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
    }
    res.json({ sentTo: [claims.email] });
  } catch (err) {
    console.error("ball chase test failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The test could not be sent. Please try again." });
  }
});
