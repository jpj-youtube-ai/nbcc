import { Router, type Request, type Response } from "express";
import { placeTransferBooking } from "../ball/place-transfer-booking";
import { getBookingForInvoice, getTransferSettings } from "../db/ball-transfer";
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
  try {
    // TASK-488: the booking itself is made where the staff route makes one too.
    const placed = await placeTransferBooking(req.body, { now: new Date(), addedBy: null });
    if (!placed.ok) return res.status(placed.status).json(placed.body);
    return res.status(201).json({
      reference: placed.reference,
      totalPence: placed.totalPence,
      payBy: placed.payBy,
      ...placed.bank,
      ...(placed.invoiceUrl ? { invoiceUrl: placed.invoiceUrl } : {}),
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
