import { describe, it, expect, vi, beforeEach } from "vitest";

// Event tickets in Admin > Fundraising: the overview, approving ticket types (staff approve all
// public content), the limit, closing and opening sales, the guest list and CSV, and refunds. Section
// "fundraising": viewers look, editors change, and only an admin refunds or declines a refund. The
// database, Stripe and the emails are mocked. Every name and address here is invented.

const authz = vi.hoisted(() => ({ authorizeSection: vi.fn(), authorizeSectionAsAdmin: vi.fn(), loadEffectivePermissions: vi.fn() }));
const db = vi.hoisted(() => ({
  listTicketedEvents: vi.fn(),
  getTicketState: vi.fn(),
  listOrders: vi.fn(),
  listRefundRequests: vi.fn(),
  listRefunds: vi.fn(),
  ticketMoneyFor: vi.fn(),
  setTypeStatus: vi.fn(),
  editType: vi.fn(),
  addTypeByStaff: vi.fn(),
  setSalesLimit: vi.fn(),
  declineProposedLimit: vi.fn(),
  setSalesClosed: vi.fn(),
  beginRefund: vi.fn(),
  reconcileOrderRefunds: vi.fn(),
  releaseTickets: vi.fn(),
  failRefund: vi.fn(),
  getOrder: vi.fn(),
  auditEmailResent: vi.fn(),
  declineRefundRequest: vi.fn(),
  availabilityOf: vi.fn(),
  closeFields: vi.fn(),
  setSalesClose: vi.fn(),
  declineProposedClose: vi.fn(),
  cancelFreeBooking: vi.fn(),
  TicketError: class TicketError extends Error {
    constructor(
      public readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
const fr = vi.hoisted(() => ({ getFundraiser: vi.fn(), fundraisingIsOn: vi.fn() }));
const refunds = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn() }));
const send = vi.hoisted(() => ({ tellAfterReconcile: vi.fn(), sendTicketConfirmation: vi.fn(), sendBookingCancelledEmail: vi.fn(), sendTicketsReleasedEmail: vi.fn() }));

vi.mock("../../src/routes/admin-authz", () => authz);
vi.mock("../../src/db/event-tickets", async () => {
  const real = await vi.importActual<typeof import("../../src/db/event-tickets")>("../../src/db/event-tickets");
  db.availabilityOf.mockImplementation(real.availabilityOf);
  db.closeFields.mockImplementation(real.closeFields);
  return db;
});
vi.mock("../../src/db/fundraisers", () => fr);
vi.mock("../../src/db/pool", () => ({ pool: {} }));
vi.mock("../../src/clients/stripe", () => ({ stripe: { refunds } }));
vi.mock("../../src/tickets/send", () => send);
vi.mock("../../src/config", () => ({ config: { PORTAL_BASE_URL: "https://nbcc.test", DATABASE_URL: "postgres://x/y" } }));

import {
  getAdminTicketEvents,
  getAdminEventTickets,
  postApproveType,
  postWithdrawType,
  patchType,
  postAddType,
  putSalesLimit,
  postApproveLimit,
  postSales,
  getAdminGuestList,
  getAdminTicketsCsv,
  postAdminRefund,
  postDeclineRequest,
  postResendTickets,
  putSalesClose,
  postApproveClose,
  postDeclineClose,
  postCancelFreeBooking,
  postReleaseTickets,
} from "../../src/routes/admin-event-tickets";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k.toLowerCase()] = v), res);
  res.type = () => res;
  res.send = (s: string) => ((res.sent = s), res);
  return res;
}
async function run(handler: (req: any, res: any) => unknown, o: { body?: unknown; params?: Record<string, string> } = {}) {
  const res = mockRes();
  await handler({ body: o.body ?? {}, params: o.params ?? {}, headers: {}, query: {} }, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const claims = { email: "staff@example.com", sub: 3, role: "admin" };
const event = { id: 12, slug: "example-quiz", path: "event", status: "approved", public: true, booking: "nbcc", title: "Example Quiz Night", eventDate: "2099-12-05", startTime: "19:30", meter: { raisedPence: 2500 } };
const paidOrder = {
  id: 70, reference: "TIX-ABCDEF", status: "paid", firstName: "Robin", surname: "Example", email: "robin@example.com", phone: "07700 900999",
  ticketsPence: 2000, feeCoverPence: 45, totalPence: 2045, refundedPence: 0, paidAt: "2026-11-01T10:00:00Z", fundraiserId: 12, paymentIntentId: "pi_1",
  lines: [{ id: 1, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 0 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  authz.authorizeSection.mockResolvedValue(claims);
  authz.authorizeSectionAsAdmin.mockResolvedValue(claims);
  authz.loadEffectivePermissions.mockResolvedValue({ fundraising: "edit" });
  fr.getFundraiser.mockResolvedValue(event);
  fr.fundraisingIsOn.mockResolvedValue(true);
  db.getTicketState.mockResolvedValue({
    types: [
      { id: 1, name: "Adult", pricePence: 1000, quantity: 50, status: "approved", position: 0, proposedBy: "organiser:kim@example.com", proposedAt: "", approvedAt: null, approvedBy: null },
      { id: 2, name: "Child", pricePence: 500, quantity: null, status: "proposed", position: 1, proposedBy: "organiser:kim@example.com", proposedAt: "", approvedAt: null, approvedBy: null },
    ],
    settings: { salesLimit: 100, proposedSalesLimit: 120, salesClosedAt: null, salesClosedBy: null, salesCloseMode: null, salesCloseAt: null, proposedCloseMode: null, proposedCloseAt: null },
    taken: { 1: 2 },
  });
  db.listOrders.mockResolvedValue([paidOrder]);
  db.listRefundRequests.mockResolvedValue([]);
  db.listRefunds.mockResolvedValue([]);
  db.ticketMoneyFor.mockResolvedValue(2000);
});

describe("the ticket overview", () => {
  it("lists every ticketed event for anyone who can see fundraising", async () => {
    db.listTicketedEvents.mockResolvedValue([{ id: 12, title: "Example Quiz Night" }]);
    const res = await run(getAdminTicketEvents);
    expect(authz.authorizeSection.mock.calls[0][2]).toBe("fundraising");
    expect(authz.authorizeSection.mock.calls[0][3]).toBe("view");
    expect(res.body).toEqual({ events: [{ id: 12, title: "Example Quiz Night" }] });
  });

  it("shows one event's types, sold and limit, money apart, bookings, requests and refunds", async () => {
    const res = await run(getAdminEventTickets, { params: { id: "12" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.types.map((t: { name: string; taken: number }) => [t.name, t.taken])).toEqual([["Adult", 2], ["Child", 0]]);
    expect(res.body.salesLimit).toBe(100);
    expect(res.body.proposedSalesLimit).toBe(120);
    expect(res.body.money.words).toBe("£20 from tickets, £25 in gifts");
    expect(res.body.orders[0]).toMatchObject({ reference: "TIX-ABCDEF", email: "robin@example.com", tickets: "2 Adult" });
    expect(res.body.state).toBe("open");
  });

  it("is not there for a fundraiser raising money", async () => {
    fr.getFundraiser.mockResolvedValue({ ...event, path: "raising" });
    expect((await run(getAdminEventTickets, { params: { id: "12" } })).statusCode).toBe(404);
  });
});

describe("changing tickets", () => {
  it("approves and withdraws a type, needing edit access, and says who did it", async () => {
    db.setTypeStatus.mockResolvedValue({ id: 2, status: "approved" });
    await run(postApproveType, { params: { id: "12", typeId: "2" } });
    expect(authz.authorizeSection.mock.calls[0][3]).toBe("edit");
    expect(db.setTypeStatus).toHaveBeenCalledWith(12, 2, "approved", "admin:staff@example.com");
    await run(postWithdrawType, { params: { id: "12", typeId: "2" } });
    expect(db.setTypeStatus).toHaveBeenLastCalledWith(12, 2, "withdrawn", "admin:staff@example.com");
  });

  it("changes a type, refusing a bad price", async () => {
    expect((await run(patchType, { params: { id: "12", typeId: "1" }, body: { pricePence: 50 } })).statusCode).toBe(400);
    db.editType.mockResolvedValue({ id: 1 });
    expect((await run(patchType, { params: { id: "12", typeId: "1" }, body: { quantity: 60 } })).statusCode).toBe(200);
    expect(db.editType).toHaveBeenCalledWith(12, 1, { quantity: 60 }, "admin:staff@example.com");
  });

  it("says why a change is refused", async () => {
    db.editType.mockRejectedValue(new db.TicketError("refused", "2 of these are already sold or being bought, so the number on sale cannot be less than that."));
    const res = await run(patchType, { params: { id: "12", typeId: "1" }, body: { quantity: 1 } });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain("cannot be less than that");
  });

  it("adds a type straight on sale", async () => {
    const res = await run(postAddType, { params: { id: "12" }, body: { name: "Family", pricePence: 2500 } });
    expect(res.statusCode).toBe(200);
    expect(db.addTypeByStaff).toHaveBeenCalledWith(12, { name: "Family", pricePence: 2500, quantity: null }, "admin:staff@example.com");
  });

  it("sets the limit, approves the proposed one, and closes and opens sales", async () => {
    await run(putSalesLimit, { params: { id: "12" }, body: { limit: null } });
    expect(db.setSalesLimit).toHaveBeenCalledWith(12, null, "admin:staff@example.com");
    expect((await run(putSalesLimit, { params: { id: "12" }, body: { limit: 0 } })).statusCode).toBe(400);
    await run(postApproveLimit, { params: { id: "12" } });
    expect(db.setSalesLimit).toHaveBeenLastCalledWith(12, 120, "admin:staff@example.com", true);
    await run(postSales, { params: { id: "12" }, body: { open: false } });
    expect(db.setSalesClosed).toHaveBeenCalledWith(12, true, "admin:staff@example.com");
  });
});

describe("the guest list and the CSV", () => {
  it("prints the guest list", async () => {
    const res = await run(getAdminGuestList, { params: { id: "12" } });
    expect(res.sent).toContain("Robin Example");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("downloads every booking as CSV, with the buyer's details", async () => {
    const res = await run(getAdminTicketsCsv, { params: { id: "12" } });
    expect(res.headers["content-disposition"]).toBe('attachment; filename="tickets-example-quiz.csv"');
    expect(res.sent).toContain("robin@example.com");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

const REFUND = { lines: [{ lineId: 1, quantity: 1, refundedQuantity: 0 }], refundedPence: 0, requestId: 5, note: "Ill" };
const intent = { id: 31, key: "event-tickets-refund-70-abc", amountPence: 1000, paymentIntentId: "pi_1", reference: "TIX-ABCDEF", retry: false };

const unchanged = { action: "tickets.refunds_unchanged", completedPence: 0, stripePence: 0, refundedNowPence: 0, full: false, failedWords: [] as string[] };
const finished = { ...unchanged, action: "tickets.refund_completed", completedPence: 1000, refundedNowPence: 1000 };
type Lister = (pi: string) => Promise<Array<{ id: string; amount: number; status: string | null; intentId: number | null }>>;

describe("refunds", () => {
  beforeEach(() => {
    db.reconcileOrderRefunds.mockReset();
    db.beginRefund.mockResolvedValue(intent);
    refunds.list.mockResolvedValue({ data: [] });
    refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded", amount: 1000 });
    db.reconcileOrderRefunds.mockResolvedValueOnce({ ...unchanged, order: paidOrder }).mockResolvedValue({ ...finished, order: paidOrder });
  });

  it("first bring the booking in line with Stripe, are written down, asked of Stripe with that intent's key, then finished by bringing it in line again", async () => {
    const order: string[] = [];
    const seen: unknown[] = [];
    db.reconcileOrderRefunds.mockReset();
    db.reconcileOrderRefunds.mockImplementation(async (_id: number, list: Lister) => {
      order.push("reconcile");
      seen.push(await list("pi_1"));
      return order.length === 1 ? { ...unchanged, order: paidOrder } : { ...finished, order: paidOrder };
    });
    db.beginRefund.mockImplementation(async () => (order.push("begin"), intent));
    refunds.create.mockImplementation(async () => (order.push("stripe"), { id: "re_1", status: "succeeded", amount: 1000 }));
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(authz.authorizeSectionAsAdmin).toHaveBeenCalled();
    expect(order).toEqual(["reconcile", "begin", "stripe", "reconcile"]);
    expect(db.reconcileOrderRefunds.mock.calls.map((c) => c[0])).toEqual([70, 70]);
    expect(refunds.list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 100 });
    expect(db.beginRefund).toHaveBeenCalledWith(12, 70, REFUND.lines, { refundedPence: 0 }, { actor: "admin:staff@example.com", requestId: 5, note: "Ill" });
    expect(refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 1000, reason: "requested_by_customer", metadata: { product: "event_tickets", orderReference: "TIX-ABCDEF", refundIntent: "31" } },
      { idempotencyKey: "event-tickets-refund-70-abc" },
    );
    // Stripe's list had not caught up: the refund Stripe has just answered with is used all the same.
    expect(seen).toEqual([[], [{ id: "re_1", status: "succeeded", amount: 1000, intentId: 31 }]]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "refunded", amountPence: 1000, full: false, refundId: "re_1" });
    expect(send.tellAfterReconcile).toHaveBeenLastCalledWith(70, expect.objectContaining({ refundedNowPence: 1000 }));
  });

  it("stop before anything new when Stripe cannot be asked what it has already refunded", async () => {
    db.reconcileOrderRefunds.mockReset();
    db.reconcileOrderRefunds.mockRejectedValue(new Error("socket hang up"));
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe("We could not check this booking's refunds with Stripe. Please try again in a few minutes.");
    expect(db.beginRefund).not.toHaveBeenCalled();
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it("tell the buyer, and staff, of whatever the first look at Stripe found (a refund made in Stripe, one that failed)", async () => {
    const found = { ...unchanged, action: "tickets.refund_failed", stripePence: 500, refundedNowPence: 500, failedWords: ["Refund failed at the bank: the buyer has not been paid back. Refund again."] };
    db.reconcileOrderRefunds.mockReset();
    db.reconcileOrderRefunds.mockResolvedValueOnce({ ...found, order: paidOrder }).mockResolvedValue({ ...finished, order: paidOrder });
    await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(send.tellAfterReconcile).toHaveBeenNthCalledWith(1, 70, expect.objectContaining({ refundedNowPence: 500, failedWords: found.failedWords }));
  });

  it("need what the admin saw: a booking that has changed is refused before Stripe is asked", async () => {
    db.beginRefund.mockRejectedValue(new db.TicketError("stale", "This booking has changed. Refresh and check before refunding."));
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("This booking has changed. Refresh and check before refunding.");
    expect(refunds.create).not.toHaveBeenCalled();
    expect((await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: { lines: [{ lineId: 1, quantity: 1 }] } })).statusCode).toBe(400);
  });

  it("send no second email when Stripe's own event finished the refund first", async () => {
    db.reconcileOrderRefunds.mockReset();
    db.reconcileOrderRefunds.mockResolvedValue({ ...unchanged, order: paidOrder });
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "refunded", amountPence: 1000 });
    for (const call of send.tellAfterReconcile.mock.calls) expect(call[1]).toMatchObject({ refundedNowPence: 0, failedWords: [] });
  });

  it("are refused for someone who is not an admin", async () => {
    authz.authorizeSectionAsAdmin.mockImplementation(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      res.status(403).json({ error: "Only an admin can do that" });
      return null;
    });
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(res.statusCode).toBe(403);
    expect(db.beginRefund).not.toHaveBeenCalled();
  });

  it("close the intent as failed when Stripe says a definite no, and change nothing else", async () => {
    refunds.create.mockRejectedValue(Object.assign(new Error("Charge already refunded"), { type: "StripeInvalidRequestError" }));
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe("Stripe did not make the refund: Charge already refunded");
    expect(db.failRefund).toHaveBeenCalledWith(31, "Charge already refunded");
    expect(db.reconcileOrderRefunds).toHaveBeenCalledTimes(1);
  });

  it("keep the intent when Stripe could not be reached, so the same refund again can never pay twice", async () => {
    refunds.create.mockRejectedValue(Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }));
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe(
      "We could not reach Stripe, so we do not know if the refund was made. Make the same refund again to finish it: it will not be paid twice.",
    );
    expect(db.failRefund).not.toHaveBeenCalled();
  });

  it("say so when Stripe made the refund but it could not be finished here, and email nobody yet", async () => {
    db.reconcileOrderRefunds.mockReset();
    db.reconcileOrderRefunds.mockResolvedValueOnce({ ...unchanged, order: paidOrder }).mockRejectedValue(new Error("db down"));
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe(
      "Stripe made the refund, but it could not be finished here. It will finish by itself when Stripe confirms it, or make the same refund again: it will not be paid twice.",
    );
    expect(send.tellAfterReconcile).toHaveBeenCalledTimes(1);
  });

  it("can be declined by an admin, with a note", async () => {
    const res = await run(postDeclineRequest, { params: { id: "12", requestId: "5" }, body: { note: "Past the cut off." } });
    expect(res.statusCode).toBe(200);
    expect(db.declineRefundRequest).toHaveBeenCalledWith(12, 5, "admin:staff@example.com", "Past the cut off.");
  });
});

describe("a tickets email that did not go", () => {
  it("is shown on the booking, with what staff are told about it", async () => {
    db.listOrders.mockResolvedValue([{ ...paidOrder, emailSent: false, flags: { paidLate: { overBy: 2 } } }]);
    const res = await run(getAdminEventTickets, { params: { id: "12" } });
    expect(res.body.orders[0].emailSent).toBe(false);
    expect(res.body.orders[0].flagWords).toEqual(["Paid late: this event is now 2 over its limit"]);
  });

  it("can be sent again by an editor, and that is recorded", async () => {
    db.getOrder.mockResolvedValue(paidOrder);
    send.sendTicketConfirmation.mockResolvedValue(true);
    const res = await run(postResendTickets, { params: { id: "12", orderId: "70" } });
    expect(authz.authorizeSection.mock.calls[0][3]).toBe("edit");
    expect(res.statusCode).toBe(200);
    expect(send.sendTicketConfirmation).toHaveBeenCalledWith(70);
    expect(db.auditEmailResent).toHaveBeenCalledWith(70, "admin:staff@example.com", true);
  });

  it("says when it still would not go, and is not for another event's booking", async () => {
    db.getOrder.mockResolvedValue(paidOrder);
    send.sendTicketConfirmation.mockResolvedValue(false);
    expect((await run(postResendTickets, { params: { id: "12", orderId: "70" } })).statusCode).toBe(502);
    db.getOrder.mockResolvedValue({ ...paidOrder, fundraiserId: 99 });
    expect((await run(postResendTickets, { params: { id: "12", orderId: "70" } })).statusCode).toBe(404);
  });
});

describe("someone who may only look", () => {
  beforeEach(() => authz.loadEffectivePermissions.mockResolvedValue({ fundraising: "view" }));

  it("sees names and tickets, never a buyer's email or phone", async () => {
    const res = await run(getAdminEventTickets, { params: { id: "12" } });
    expect(res.body.contact).toBe(false);
    expect(res.body.orders[0]).toMatchObject({ firstName: "Robin", tickets: "2 Adult", email: null, phone: null });
    expect(JSON.stringify(res.body)).not.toContain("robin@example.com");
  });

  it("downloads a CSV without them", async () => {
    const res = await run(getAdminTicketsCsv, { params: { id: "12" } });
    expect(res.sent).not.toContain("robin@example.com");
    expect(res.sent).toContain("Robin");
  });
});

describe("when ticket sales close (staff)", () => {
  it("is shown with the host's choice still to approve", async () => {
    db.getTicketState.mockResolvedValue({
      types: [],
      settings: { salesLimit: null, proposedSalesLimit: null, salesClosedAt: null, salesClosedBy: null, salesCloseMode: null, salesCloseAt: null, proposedCloseMode: "day_before", proposedCloseAt: null },
      taken: {},
    });
    const res = await run(getAdminEventTickets, { params: { id: "12" } });
    expect(res.body.close.words).toBe("Sales close when the event starts.");
    expect(res.body.proposedClose).toEqual({ mode: "day_before", at: null, words: "Sales close at midnight the day before." });
  });

  it("is set by staff, approved from the host's choice, or declined", async () => {
    const past = await run(putSalesClose, { params: { id: "12" }, body: { ticketClose: "custom", ticketCloseAt: "2020-01-01T10:00" } });
    expect(past.statusCode).toBe(400);
    expect(past.body.error).toBe("Choose a time that hasn't passed yet.");
    await run(putSalesClose, { params: { id: "12" }, body: { ticketClose: "custom", ticketCloseAt: "2099-12-03T18:00" } });
    expect(db.setSalesClose).toHaveBeenCalledWith(12, { mode: "custom", at: "2099-12-03T18:00:00.000Z" }, "admin:staff@example.com");
    const late = await run(putSalesClose, { params: { id: "12" }, body: { ticketClose: "custom", ticketCloseAt: "2099-12-06T18:00" } });
    expect(late.statusCode).toBe(400);
    expect(late.body.error).toBe("Ticket sales need to close before the event starts.");
    await run(postApproveClose, { params: { id: "12" } });
    expect(db.setSalesClose).toHaveBeenLastCalledWith(12, null, "admin:staff@example.com", true);
    await run(postDeclineClose, { params: { id: "12" } });
    expect(db.declineProposedClose).toHaveBeenCalledWith(12, "admin:staff@example.com");
  });
});

describe("a free booking (staff)", () => {
  it("is cancelled, never refunded, and the buyer is told", async () => {
    db.cancelFreeBooking.mockResolvedValue(paidOrder);
    const res = await run(postCancelFreeBooking, { params: { id: "12", orderId: "70" } });
    expect(authz.authorizeSection.mock.calls[0][3]).toBe("edit");
    expect(res.statusCode).toBe(200);
    expect(db.cancelFreeBooking).toHaveBeenCalledWith(12, 70, "admin:staff@example.com");
    expect(send.sendBookingCancelledEmail).toHaveBeenCalledWith(paidOrder);
  });

  it("takes a free ticket type from staff", async () => {
    const res = await run(postAddType, { params: { id: "12" }, body: { name: "Under 5", pricePence: 0 } });
    expect(res.statusCode).toBe(200);
    expect(db.addTypeByStaff).toHaveBeenCalledWith(12, { name: "Under 5", pricePence: 0, quantity: null }, "admin:staff@example.com");
  });
});

describe("what Stripe says about the refund it just made", () => {
  beforeEach(() => {
    db.reconcileOrderRefunds.mockReset();
    db.beginRefund.mockResolvedValue(intent);
    refunds.list.mockResolvedValue({ data: [] });
  });

  it("failed: the booking is brought in line (the intent closed, the booking flagged, staff told), nothing is released, and the admin is told", async () => {
    const bad = { ...unchanged, action: "tickets.refund_failed", failedWords: ["Refund failed at the bank: the buyer has not been paid back. Refund again."] };
    db.reconcileOrderRefunds.mockResolvedValueOnce({ ...unchanged, order: paidOrder }).mockResolvedValue({ ...bad, order: paidOrder });
    refunds.create.mockResolvedValue({ id: "re_1", status: "failed", amount: 1000 });
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe("Stripe could not make the refund (it came back failed). The buyer has not been paid back and no tickets were released.");
    const list = db.reconcileOrderRefunds.mock.calls[1][1] as Lister;
    expect(await list("pi_1")).toEqual([{ id: "re_1", status: "failed", amount: 1000, intentId: 31 }]);
    expect(send.tellAfterReconcile).toHaveBeenLastCalledWith(70, expect.objectContaining({ failedWords: bad.failedWords }));
  });

  it("still on its way: nothing is released yet, and it finishes when Stripe confirms it", async () => {
    db.reconcileOrderRefunds.mockResolvedValue({ ...unchanged, order: paidOrder });
    refunds.create.mockResolvedValue({ id: "re_1", status: "pending", amount: 1000 });
    const res = await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "processing" });
  });

  it("uses Stripe's own list when the refund is already on it", async () => {
    db.reconcileOrderRefunds.mockResolvedValue({ ...unchanged, order: paidOrder });
    refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded", amount: 1000 });
    refunds.list.mockResolvedValue({ data: [{ id: "re_1", status: "succeeded", amount: 1000, metadata: { refundIntent: "31" } }, { id: "re_dash", status: "succeeded", amount: 300, metadata: {} }] });
    await run(postAdminRefund, { params: { id: "12", orderId: "70" }, body: REFUND });
    const list = db.reconcileOrderRefunds.mock.calls[1][1] as Lister;
    expect(await list("pi_1")).toEqual([
      { id: "re_1", status: "succeeded", amount: 1000, intentId: 31 },
      { id: "re_dash", status: "succeeded", amount: 300, intentId: null },
    ]);
  });
});

describe("releasing tickets with no money moving", () => {
  const body = { lines: [{ lineId: 2, quantity: 1, refundedQuantity: 0 }], refundedPence: 0 };

  it("is for an admin: the places go back on sale and the buyer is told which tickets are cancelled", async () => {
    db.releaseTickets.mockResolvedValue({ order: paidOrder, tickets: "1 Under 5" });
    const res = await run(postReleaseTickets, { params: { id: "12", orderId: "70" }, body });
    expect(authz.authorizeSectionAsAdmin).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(db.releaseTickets).toHaveBeenCalledWith(12, 70, body.lines, { refundedPence: 0 }, "admin:staff@example.com");
    expect(send.sendTicketsReleasedEmail).toHaveBeenCalledWith(paidOrder, "1 Under 5");
  });

  it("says why not, and emails nobody", async () => {
    db.releaseTickets.mockRejectedValue(new db.TicketError("refused", "Refund the money for those tickets first: nothing has been refunded for them."));
    const res = await run(postReleaseTickets, { params: { id: "12", orderId: "70" }, body });
    expect(res.statusCode).toBe(409);
    expect(send.sendTicketsReleasedEmail).not.toHaveBeenCalled();
  });
});

describe("a tickets email that keeps failing", () => {
  it("is flagged on the booking", async () => {
    db.listOrders.mockResolvedValue([{ ...paidOrder, emailSent: false, emailFailing: true }]);
    const res = await run(getAdminEventTickets, { params: { id: "12" } });
    expect(res.body.orders[0].emailFailing).toBe(true);
  });
});
