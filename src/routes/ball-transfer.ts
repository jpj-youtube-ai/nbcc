import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { makeReference, purchaseSchema } from "../ball/booking";
import { seatsFor } from "../ball/capacity";
import { orderTotalPence } from "../ball/pricing";
import {
  invoiceSchema,
  transferPayBy,
  transferReady,
  transferWindowOpen,
  TRANSFER_DAYS,
  TRANSFER_DAYS_INVOICE,
  type InvoiceDetails,
} from "../ball/transfer";
import { invoiceUrl, sendTransferDetails } from "../ball/transfer-send";
import { getAvailability, getCapacityState } from "../db/ball";
import { createTransferBooking, getTransferSettings } from "../db/ball-transfer";
import { createRateLimiter } from "../portal/request-limiter";

// TASK-484: POST /api/ball/bank-transfer. Book Festive Ball seats or tables to pay by bank transfer.
//
// The same form, the same details and the same terms as paying by card, less the card fee. The
// booking holds its seats from now until an admin marks the money arrived or staff cancel it, and
// the answer carries everything needed to pay: the account, the exact amount, the reference and the
// date. The same goes by email. It is refused unless an admin has switched it on with every bank
// detail filled in, so it can be built and deployed long before anyone can use it.
//
// Five an hour from one connection. A transfer booking holds seats for a week, where an abandoned
// card checkout gives them back within the hour, so without a limit a script could quietly hold the
// whole room. There is deliberately NO limit per email address: the client wants a buyer who decides
// they want more to be able to book more. Same-host requests are exempt, as for the admin login
// (src/routes/admin.ts, isLoopbackRequest): only the CI suite and local development arrive that way,
// because behind the load balancer req.ip is always the real client.

const limiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

function isLoopback(req: Request): boolean {
  const ip = req.ip ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

export async function postBankTransfer(req: Request, res: Response): Promise<Response> {
  if (!isLoopback(req) && !limiter.allow(req.ip ?? "unknown", Date.now())) {
    return res.status(429).json({ error: "Too many bookings from here. Please try again later, or email events@nbcc.scot." });
  }
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid booking request", details: parsed.error.issues });
  }
  // TASK-486: "My company needs an invoice". The company and its address are required; a company
  // cannot make a Gift Aid declaration, so an invoiced booking never carries one.
  let invoice: InvoiceDetails | null = null;
  if (req.body?.invoice != null) {
    const inv = invoiceSchema.safeParse(req.body.invoice);
    if (!inv.success) {
      return res.status(400).json({ error: "Invalid invoice details", details: inv.error.issues });
    }
    invoice = inv.data;
  }
  // A transfer has no card fee, whatever the form sent.
  const purchase = { ...parsed.data, coverFee: false, giftAid: invoice ? false : parsed.data.giftAid };

  try {
    const bank = await getTransferSettings();
    if (!transferReady(bank)) return res.status(409).json({ error: "Bank transfer isn't available" });
    // TASK-485: after the last day for transfers to arrive, card only.
    const now = new Date();
    const lastDay = bank.lastDay ?? null;
    if (!transferWindowOpen(now, lastDay)) {
      return res.status(409).json({ error: "Bank transfer has closed. Please pay by card." });
    }

    const avail = await getAvailability();
    if (!avail.salesOpen) {
      return res.status(409).json({ error: "Ticket sales are closed", soldOut: avail.soldOut });
    }

    const order = { kind: purchase.kind, quantity: purchase.quantity };
    const { seatsPerTable } = await getCapacityState();
    const totals = orderTotalPence({ order, donationPence: purchase.donationPence, coverFee: false, cardFee: avail.cardFee });
    const reference = makeReference(randomBytes(8));
    // Seven days on (fourteen with an invoice), or the last day for transfers if that comes first.
    const payBy = transferPayBy(now, lastDay, invoice ? TRANSFER_DAYS_INVOICE : TRANSFER_DAYS);
    const write = {
      reference,
      kind: purchase.kind,
      quantity: purchase.quantity,
      seats: seatsFor(order, seatsPerTable),
      buyerName: purchase.buyerName,
      buyerFirstName: purchase.buyerFirstName,
      buyerSurname: purchase.buyerSurname,
      buyerEmail: purchase.buyerEmail,
      ticketsPence: totals.ticketsPence,
      donationPence: totals.donationPence,
      feeCoverPence: 0,
      totalPence: totals.totalPence,
      giftAid: purchase.giftAid,
      newsletterOptIn: purchase.newsletterOptIn,
    };

    // Capacity is re-checked under the settings lock inside; null means the seats went meanwhile.
    const booked = await createTransferBooking(write, payBy, invoice);
    if (!booked) {
      return res.status(409).json({
        error:
          purchase.kind === "table"
            ? "There are not enough whole tables left for that booking"
            : "There are not enough seats left for that booking",
      });
    }

    const details = {
      accountName: bank.accountName as string,
      sortCode: bank.sortCode as string,
      accountNumber: bank.accountNumber as string,
    };
    const contact = invoice ? { bookingId: booked.id, accountsEmail: invoice.accountsEmail ?? null } : null;
    void sendTransferDetails({ ...write, invoice: contact }, details, payBy);
    return res.status(201).json({
      reference,
      totalPence: totals.totalPence,
      payBy,
      ...details,
      ...(contact ? { invoiceUrl: invoiceUrl(contact.bookingId) } : {}),
    });
  } catch (err) {
    console.error("ball bank transfer booking failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Could not make that booking. Please try again, or email events@nbcc.scot." });
  }
}

export const ballTransferRouter = Router();
ballTransferRouter.post("/api/ball/bank-transfer", postBankTransfer);
