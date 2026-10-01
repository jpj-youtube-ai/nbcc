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
import { createTransferBooking, getBookingForInvoice, getTransferSettings } from "../db/ball-transfer";
import { verifyInvoiceToken } from "../ball/invoice-token";
import { renderInvoicePage } from "../ball/invoice-page";
import { config } from "../config";
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
  // TASK-486: "My company needs an invoice". The company and its address are required; a company
  // cannot make a Gift Aid declaration, so an invoiced booking never carries one. Dropped before the
  // booking is checked, so Gift Aid ticked without a donation is not a reason to refuse it.
  let invoice: InvoiceDetails | null = null;
  const rawInvoice: unknown = req.body?.invoice;
  if (rawInvoice && typeof rawInvoice === "object") {
    const inv = invoiceSchema.safeParse(rawInvoice);
    if (!inv.success) {
      return res.status(400).json({ error: "Invalid invoice details", details: inv.error.issues });
    }
    invoice = inv.data;
  }
  const parsed = purchaseSchema.safeParse(invoice ? { ...req.body, giftAid: false } : req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid booking request", details: parsed.error.issues });
  }
  // A transfer has no card fee, whatever the form sent.
  const purchase = { ...parsed.data, coverFee: false };

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

// TASK-486: GET /ball/invoice/:token, the printable invoice for a booking made with "My company needs
// an invoice". The link is signed (src/ball/invoice-token.ts), so a booking number alone opens nothing,
// and a bad link is simply not found. It carries a company's address and the booking's money, so it
// is never cached by anything shared and is kept out of search engines. It shows the booking as it
// stands now: Paid once paid; Cancelled, with no bank details, once cancelled.
export async function getInvoicePage(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  let id: number;
  try {
    id = verifyInvoiceToken(String(req.params.token ?? ""), config.ADMIN_SESSION_SECRET);
  } catch {
    res.status(404).type("text").send("Not found");
    return;
  }
  try {
    const booking = await getBookingForInvoice(id);
    if (!booking) {
      res.status(404).type("text").send("Not found");
      return;
    }
    // Only a pending booking asks for money. Anything neither pending nor paid (cancelled, or a
    // refund) reads as cancelled, with no bank details.
    const status = booking.status === "paid" || booking.status === "pending" ? booking.status : "cancelled";
    // Still owed: the account to pay into. Whether or not transfers are still offered to new buyers,
    // someone who has already booked needs it, so only the details themselves are checked.
    const s = status === "pending" ? await getTransferSettings() : null;
    const bank =
      s?.accountName && s.sortCode && s.accountNumber
        ? { accountName: s.accountName, sortCode: s.sortCode, accountNumber: s.accountNumber }
        : null;
    res.status(200).type("html").send(
      renderInvoicePage({
        reference: booking.reference,
        issuedOn: booking.issuedOn,
        payBy: booking.payBy ?? booking.issuedOn,
        status,
        paidOn: booking.paidOn,
        company: booking.company,
        address: booking.address,
        po: booking.po,
        buyerName: booking.buyerName,
        kind: booking.kind,
        quantity: booking.quantity,
        seats: booking.seats,
        ticketsPence: booking.ticketsPence,
        donationPence: booking.donationPence,
        totalPence: booking.totalPence,
        bank,
      }),
    );
  } catch (err) {
    console.error("ball invoice page failed:", err instanceof Error ? err.message : err);
    res.status(500).type("text").send("The invoice is temporarily unavailable. Please try again, or email events@nbcc.scot.");
  }
}

export const ballTransferRouter = Router();
ballTransferRouter.post("/api/ball/bank-transfer", postBankTransfer);
ballTransferRouter.get("/ball/invoice/:token", getInvoicePage);
