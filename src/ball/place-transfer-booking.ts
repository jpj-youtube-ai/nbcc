import { randomBytes } from "node:crypto";
import { makeReference, purchaseSchema } from "./booking";
import { seatsFor } from "./capacity";
import { orderTotalPence } from "./pricing";
import {
  invoiceSchema,
  transferPayBy,
  transferReady,
  transferWindowOpen,
  TRANSFER_DAYS,
  TRANSFER_DAYS_INVOICE,
  type BankDetails,
  type InvoiceDetails,
} from "./transfer";
import { invoiceUrl, sendTransferDetails, sendTransferStaffNotice } from "./transfer-send";
import { getAvailability, getCapacityState } from "../db/ball";
import { createTransferBooking, getTransferSettings } from "../db/ball-transfer";

// Making a Festive Ball booking to pay by bank transfer, for the public form (TASK-484, at
// POST /api/ball/bank-transfer) and for staff taking a phone or email order (TASK-488, at
// POST /api/admin/ball/transfer-bookings). One place, so the two cannot drift apart: the same
// fields, the same prices, the same pay-by date and the same emails.
//
// The rules differ in only these ways. A buyer on the website can book only while an admin has
// switched bank transfer on and ticket sales are open. Staff need only the bank details to be
// entered: they can take an order before the ticket page offers it (and so make a test booking), and
// past "Close sales now", as they can hold seats, but not past the date ticket sales close. Staff bookings carry no Gift Aid and no newsletter
// sign-up: a declaration made over the phone needs its own written record, and a sign-up records
// consent given by the buyer themselves. Both need room, and both stop at the last day for transfers.

export type PlaceTransferResult =
  | { ok: true; reference: string; totalPence: number; payBy: string; bank: BankDetails; invoiceUrl?: string }
  | { ok: false; status: number; body: Record<string, unknown> };

const refuse = (status: number, body: Record<string, unknown>): PlaceTransferResult => ({ ok: false, status, body });

export async function placeTransferBooking(
  raw: unknown,
  o: { now: Date; addedBy: string | null },
): Promise<PlaceTransferResult> {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const staff = o.addedBy !== null;

  // TASK-486: "My company needs an invoice". The company and its address are required; a company
  // cannot make a Gift Aid declaration, so an invoiced booking never carries one. Dropped before the
  // booking is checked, so Gift Aid ticked without a donation is not a reason to refuse it.
  let invoice: InvoiceDetails | null = null;
  const rawInvoice = input.invoice;
  if (rawInvoice && typeof rawInvoice === "object") {
    const inv = invoiceSchema.safeParse(rawInvoice);
    if (!inv.success) return refuse(400, { error: "Invalid invoice details", details: inv.error.issues });
    invoice = inv.data;
  }
  const noGiftAid = invoice !== null || staff;
  const parsed = purchaseSchema.safeParse({
    ...input,
    ...(noGiftAid ? { giftAid: false } : {}),
    ...(staff ? { newsletterOptIn: false } : {}),
  });
  if (!parsed.success) return refuse(400, { error: "Invalid booking request", details: parsed.error.issues });
  // A transfer has no card fee, whatever the form sent.
  const purchase = { ...parsed.data, coverFee: false };

  const bank = await getTransferSettings();
  const detailsEntered = Boolean(bank.accountName && bank.sortCode && bank.accountNumber);
  if (staff ? !detailsEntered : !transferReady(bank)) {
    return refuse(409, { error: staff ? "Enter the bank details under Set up first." : "Bank transfer isn't available" });
  }
  // TASK-485: after the last day for transfers to arrive, card only.
  const lastDay = bank.lastDay ?? null;
  if (!transferWindowOpen(o.now, lastDay)) {
    return refuse(409, {
      error: staff ? "The last day for transfers has passed." : "Bank transfer has closed. Please pay by card.",
    });
  }

  const avail = await getAvailability();
  if (!staff && !avail.salesOpen) return refuse(409, { error: "Ticket sales are closed", soldOut: avail.soldOut });
  if (staff && avail.closedByDate) return refuse(409, { error: "Ticket sales have closed for the Ball." });

  const order = { kind: purchase.kind, quantity: purchase.quantity };
  const { seatsPerTable } = await getCapacityState();
  const totals = orderTotalPence({ order, donationPence: purchase.donationPence, coverFee: false, cardFee: avail.cardFee });
  const reference = makeReference(randomBytes(8));
  // Seven days on (fourteen with an invoice), or the last day for transfers if that comes first.
  const payBy = transferPayBy(o.now, lastDay, invoice ? TRANSFER_DAYS_INVOICE : TRANSFER_DAYS);
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
  // A staff booking is audited with the same actor string as every other admin action.
  const booked = await createTransferBooking(write, payBy, invoice, o.addedBy ? `admin:${o.addedBy}` : null);
  if (!booked) {
    return refuse(409, {
      error:
        purchase.kind === "table"
          ? "There are not enough whole tables left for that booking"
          : "There are not enough seats left for that booking",
    });
  }

  const details: BankDetails = {
    accountName: bank.accountName as string,
    sortCode: bank.sortCode as string,
    accountNumber: bank.accountNumber as string,
  };
  const contact = invoice ? { bookingId: booked.id, accountsEmail: invoice.accountsEmail ?? null } : null;
  // After the commit, best effort: the booking stands whether or not the emails go.
  void sendTransferDetails({ ...write, invoice: contact }, details, payBy);
  // TASK-487: and the team, at events@.
  void sendTransferStaffNotice(
    { ...write, invoice: invoice ? { bookingId: booked.id, company: invoice.company } : null },
    payBy,
    o.addedBy,
  );
  return {
    ok: true,
    reference,
    totalPence: totals.totalPence,
    payBy,
    bank: details,
    ...(contact ? { invoiceUrl: invoiceUrl(contact.bookingId) } : {}),
  };
}
