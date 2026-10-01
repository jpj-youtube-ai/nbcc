import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin } from "./admin-authz";
import type { AdminSessionClaims } from "../admin/session";
import { bankDetailsSchema, isOverdue, transferReady, transferWindowOpen, type TransferSettings } from "../ball/transfer";
import { makeGuestToken } from "../ball/guests";
import { londonDate } from "../ball/sales-report";
import { sendTransferArrived } from "../ball/transfer-send";
import {
  extendPayBy,
  getTransferSettings,
  listAwaitingTransfers,
  markTransferPaid,
  saveTransferSettings,
} from "../db/ball-transfer";

// TASK-484: the admin side of paying for the Festive Ball by bank transfer.
//
//   GET  /api/admin/ball/transfer-settings                 the bank details and the switch     ball: view
//   PUT  /api/admin/ball/transfer-settings                 change them                          ADMIN only
//   GET  /api/admin/ball/transfers                         bookings awaiting a transfer        ball: view
//   POST /api/admin/ball/bookings/:reference/mark-paid     the money has arrived               ADMIN only
//   POST /api/admin/ball/bookings/:reference/pay-by        give more time                      ball: edit
//
// "ADMIN only" means the admin role, read fresh, as well as Festive Ball edit: the client reserved
// the bank details and confirming money to admins whatever the access matrix says. Cancelling stays
// on the existing cancel route (src/routes/admin.ts), which now emails a transfer buyer.

// The same actor string as actorOf in src/routes/admin.ts, kept local so this router does not pull
// that whole module in.
const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;

function failed(res: Response, what: string, err: unknown): Response {
  console.error(`admin ball transfer: ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json({ error: "Admin is temporarily unavailable" });
}

// The settings as the admin screen shows them. `ready`: switched on with every detail. `offered`: the
// ticket page actually offers it now, which it does not after the last day for transfers (TASK-485),
// so the screen never says "the ticket page offers bank transfer" when it does not.
function settingsAnswer(s: TransferSettings) {
  const ready = transferReady(s);
  return { ...s, ready, offered: ready && transferWindowOpen(new Date(), s.lastDay ?? null) };
}

export async function getAdminTransferSettings(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    const s = await getTransferSettings();
    return res.status(200).json(settingsAnswer(s));
  } catch (err) {
    return failed(res, "reading the settings", err);
  }
}

// A real calendar date: "2026-02-30" has the right shape, but Postgres would refuse it and staff would
// see a 500, so it must survive a round trip through Date unchanged.
const realDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = new Date(`${d}T12:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  });

const settingsBody = z
  .object({
    on: z.boolean().optional(),
    accountName: z.string().optional(),
    sortCode: z.string().optional(),
    accountNumber: z.string().optional(),
    // TASK-485: the last day transfers may arrive; null clears it.
    lastDay: realDate.nullable().optional(),
  })
  .strict();

export async function putAdminTransferSettings(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "ball");
  if (!claims) return;
  const body = settingsBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid settings" });

  const { on, lastDay, ...detailFields } = body.data;
  const givesDetails = Object.values(detailFields).some((v) => v !== undefined);
  let details: z.infer<typeof bankDetailsSchema> | undefined;
  if (givesDetails) {
    const parsed = bankDetailsSchema.safeParse(detailFields);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the bank details" });
    }
    details = parsed.data;
  }

  try {
    const current = await getTransferSettings();
    // Switched on with a detail missing would give buyers a booking they cannot pay.
    const next = { ...current, ...(details ?? {}), on: on ?? current.on };
    if (next.on && !transferReady(next)) {
      return res.status(400).json({ error: "Fill in all three bank details before switching it on" });
    }
    const update: { on?: boolean; details?: typeof details; lastDay?: string | null } = {};
    if (on !== undefined) update.on = on;
    if (details) update.details = details;
    if (lastDay !== undefined) update.lastDay = lastDay;
    const saved = await saveTransferSettings(update, actorOf(claims));
    return res.status(200).json(settingsAnswer(saved));
  } catch (err) {
    return failed(res, "saving the settings", err);
  }
}

export async function getAdminTransfers(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "ball", "view"))) return;
  try {
    // TASK-485: past its date, flagged for staff. Nothing happens to it automatically.
    const today = londonDate(new Date());
    const results = (await listAwaitingTransfers()).map((t) => ({ ...t, overdue: isOverdue(t.payBy, today) }));
    return res.status(200).json({ results });
  } catch (err) {
    return failed(res, "listing transfers", err);
  }
}

const markPaidBody = z.object({ confirmTotalPence: z.number().int().nonnegative() });

const MARK_PAID_REFUSALS = {
  not_found: [404, "There is no booking with that reference."],
  not_transfer: [409, "That booking was paid by card, so Stripe confirms it, not us."],
  already_paid: [409, "That booking is already marked paid."],
  was_paid: [409, "That booking had been paid before it was cancelled, so it can't be brought back. Make a new booking instead."],
  amount_mismatch: [409, "That isn't the amount for this booking. Reload the list and check it."],
  seats_gone: [409, "Its seats have been sold since it was cancelled. Refund the transfer by hand."],
} as const;

export async function postAdminMarkTransferPaid(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "ball");
  if (!claims) return;
  const body = markPaidBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Say the amount that arrived" });
  const reference = String(req.params.reference ?? "");

  try {
    const outcome = await markTransferPaid(
      reference,
      body.data.confirmTotalPence,
      actorOf(claims),
      makeGuestToken(randomBytes(24)),
    );
    if (!outcome.ok) {
      const [status, error] = MARK_PAID_REFUSALS[outcome.reason];
      return res.status(status).json({ error });
    }
    // After the commit, best effort: the booking is paid whether or not the email goes.
    void sendTransferArrived(outcome.booking, outcome.guestToken);
    return res.status(200).json({ reference, reinstated: outcome.reinstated });
  } catch (err) {
    return failed(res, "marking paid", err);
  }
}

const payByBody = z.object({ payBy: realDate });

export async function postAdminTransferPayBy(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "ball", "edit");
  if (!claims) return;
  const body = payByBody.safeParse(req.body);
  // YYYY-MM-DD compares as text, and no earlier than today in the UK.
  if (!body.success || body.data.payBy < londonDate(new Date())) {
    return res.status(400).json({ error: "Give a date from today onwards" });
  }
  const reference = String(req.params.reference ?? "");
  try {
    const outcome = await extendPayBy(reference, body.data.payBy, actorOf(claims));
    if (outcome === "not_found") return res.status(404).json({ error: "There is no booking with that reference." });
    if (outcome === "not_open") return res.status(409).json({ error: "That booking is no longer waiting for a transfer." });
    return res.status(200).json({ reference, payBy: body.data.payBy });
  } catch (err) {
    return failed(res, "changing the date", err);
  }
}

export const adminBallTransferRouter = Router();
adminBallTransferRouter.get("/api/admin/ball/transfer-settings", getAdminTransferSettings);
adminBallTransferRouter.put("/api/admin/ball/transfer-settings", putAdminTransferSettings);
adminBallTransferRouter.get("/api/admin/ball/transfers", getAdminTransfers);
adminBallTransferRouter.post("/api/admin/ball/bookings/:reference/mark-paid", postAdminMarkTransferPaid);
adminBallTransferRouter.post("/api/admin/ball/bookings/:reference/pay-by", postAdminTransferPayBy);
