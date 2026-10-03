import { describe, it, expect, vi, beforeEach } from "vitest";

// Event tickets: buying (POST /api/event-tickets/:id/checkout) and the organiser's private area
// (/api/fundraise/manage/fundraisers/:id/tickets...). The database, Stripe, the emails and the
// private area's sign in are mocked; what is checked is what each endpoint lets through. Every name
// and address here is invented.

const db = vi.hoisted(() => ({
  reserveOrder: vi.fn(),
  attachSession: vi.fn(),
  cancelPendingOrder: vi.fn(),
  getTicketState: vi.fn(),
  listOrders: vi.fn(),
  listRefundRequests: vi.fn(),
  ticketMoneyFor: vi.fn(),
  proposeTickets: vi.fn(),
  createRefundRequest: vi.fn(),
  availabilityOf: vi.fn(),
  closeFields: vi.fn(),
  confirmFreeOrder: vi.fn(),
  openOrdersOfBuyer: vi.fn(),
  supersedeOrder: vi.fn(),
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
const fr = vi.hoisted(() => ({ fundraisingIsOn: vi.fn(), getFundraiser: vi.fn() }));
const stripeMock = vi.hoisted(() => ({ create: vi.fn(), expire: vi.fn() }));
const send = vi.hoisted(() => ({ sendRefundRequestStaffEmail: vi.fn(), sendTicketsProposedStaffEmail: vi.fn(), sendTicketConfirmation: vi.fn(), sendBookingCancelledEmail: vi.fn() }));
const manage = vi.hoisted(() => ({ signedIn: vi.fn(), ownFundraiser: vi.fn() }));
const captcha = vi.hoisted(() => ({ captchaEnabled: vi.fn(() => false), captchaSiteKey: vi.fn(() => null), verifyCaptcha: vi.fn() }));

vi.mock("../../src/db/event-tickets", async () => {
  const real = await vi.importActual<typeof import("../../src/db/event-tickets")>("../../src/db/event-tickets");
  db.availabilityOf.mockImplementation(real.availabilityOf);
  db.closeFields.mockImplementation(real.closeFields);
  return db;
});
vi.mock("../../src/db/fundraisers", () => fr);
vi.mock("../../src/db/ball", () => ({ getCardFeeRate: vi.fn(async () => ({ percentBp: 120, fixedPence: 20 })) }));
vi.mock("../../src/db/pool", () => ({ pool: {} }));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create: stripeMock.create, expire: stripeMock.expire } } } }));
vi.mock("../../src/tickets/send", () => send);
vi.mock("../../src/clients/turnstile", () => captcha);
vi.mock("../../src/routes/fundraise", async () => {
  const real = await vi.importActual<typeof import("../../src/fundraising/sign-in")>("../../src/fundraising/sign-in");
  return {
    ...manage,
    fromOurOwnPage: (req: { headers: Record<string, string> }, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      const ok = real.sentFromOurOwnPage({ secFetchSite: req.headers["sec-fetch-site"], origin: req.headers.origin }, req.headers.host ?? "");
      if (!ok) res.status(403).json({ error: "Please use the form on our website." });
      return ok;
    },
  };
});
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "production", PORTAL_BASE_URL: "https://nbcc.test", DATABASE_URL: "postgres://x/y" } }));

import {
  postTicketCheckout,
  getTicketAvailability,
  getManageTickets,
  postManageTicketProposal,
  postManageRefundRequest,
  getManageGuestList,
  postManageCancelBooking,
} from "../../src/routes/event-tickets";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Res = { statusCode: number; body: any; headers: Record<string, string>; sent?: string; type?: string };
function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k.toLowerCase()] = v), res);
  res.type = (t: string) => ((res.type_ = t), res);
  res.send = (s: string) => ((res.sent = s), res);
  return res;
}
let ip = 0;
async function run(handler: (req: any, res: any) => unknown, o: { body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<Res> {
  const res = mockRes();
  await handler({ body: o.body ?? {}, params: o.params ?? {}, ip: `10.7.0.${++ip}`, headers: { host: "nbcc.test", "sec-fetch-site": "same-origin", ...(o.headers ?? {}) }, query: {} }, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const event = (over: Record<string, unknown> = {}) => ({
  id: 12,
  slug: "example-quiz",
  path: "event",
  status: "approved",
  public: true,
  booking: "nbcc",
  title: "Example Quiz Night",
  eventDate: "2099-12-05",
  startTime: "19:30",
  endTime: null,
  timeTbc: false,
  name: "Kim Organiser",
  email: "kim@example.com",
  sharesWithOther: false,
  meter: { raisedPence: 2500 },
  ...over,
});

const buyer = { lines: [{ typeId: 1, quantity: 2, pricePence: 1000 }], firstName: "Robin", lastName: "Example", email: "robin@example.com", phone: "", coverFee: true };

const state = {
  types: [
    { id: 1, name: "Adult", pricePence: 1000, quantity: 50, status: "approved", position: 0 },
    { id: 3, name: "Child", pricePence: 0, quantity: null, status: "withdrawn", position: 1 },
  ],
  settings: { salesLimit: null, proposedSalesLimit: null, salesClosedAt: null, salesClosedBy: null, salesCloseMode: null, salesCloseAt: null, proposedCloseMode: null, proposedCloseAt: null },
  taken: { 1: 3 },
};

beforeEach(() => {
  vi.clearAllMocks();
  fr.fundraisingIsOn.mockResolvedValue(true);
  fr.getFundraiser.mockResolvedValue(event());
  db.getTicketState.mockResolvedValue(state);
  db.reserveOrder.mockResolvedValue({
    ok: true,
    order: { id: 70, reference: "TIX-ABCDEF", money: { ticketsPence: 2000, feeCoverPence: 45, totalPence: 2045 }, lines: [{ typeId: 1, name: "Adult", unitPence: 1000, quantity: 2 }] },
  });
  stripeMock.create.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/pay/cs_test_1" });
  stripeMock.expire.mockResolvedValue({ id: "cs_old", status: "expired" });
  db.attachSession.mockResolvedValue(true);
  db.openOrdersOfBuyer.mockResolvedValue([]);
  captcha.captchaEnabled.mockReturnValue(false);
  manage.signedIn.mockResolvedValue({ email: "kim@example.com", sessionHash: "h" });
  manage.ownFundraiser.mockResolvedValue(event());
  db.listOrders.mockResolvedValue([]);
  db.listRefundRequests.mockResolvedValue([]);
  db.ticketMoneyFor.mockResolvedValue(0);
});

describe("buying tickets", () => {
  it("reserves the places, opens a Stripe checkout and gives its address", async () => {
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: buyer });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/pay/cs_test_1" });
    const reserve = db.reserveOrder.mock.calls[0][0];
    expect(reserve).toMatchObject({ fundraiserId: 12, fundraisingOn: true, lines: [{ typeId: 1, quantity: 2, pricePence: 1000 }], coverFee: true });
    expect(reserve.buyer).toEqual({ firstName: "Robin", lastName: "Example", email: "robin@example.com", phone: null });
    expect(reserve.newReference()).toMatch(/^TIX-[A-Z2-9]{6}$/);
    // A hash of the buyer's address, never the address itself, to cap their open checkouts.
    expect(reserve.ipHash).toMatch(/^[0-9a-f]{64}$/);
    const [params, opts] = stripeMock.create.mock.calls[0];
    expect(params.metadata.product).toBe("event_tickets");
    expect(opts).toEqual({ idempotencyKey: "event-tickets-TIX-ABCDEF" });
    expect(db.attachSession).toHaveBeenCalledWith(70, "cs_test_1");
  });

  it("says why when the places are not there, so the page can refresh", async () => {
    db.reserveOrder.mockResolvedValue({ ok: false, problem: "Sorry, there are only 1 Adult tickets left." });
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: buyer });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "Sorry, there are only 1 Adult tickets left.", refresh: true });
    expect(stripeMock.create).not.toHaveBeenCalled();
  });

  it("gives the places straight back when Stripe cannot start", async () => {
    stripeMock.create.mockRejectedValue(new Error("stripe down"));
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: buyer });
    expect(res.statusCode).toBe(502);
    expect(db.cancelPendingOrder).toHaveBeenCalledWith(70);
  });

  it("names what needs another look", async () => {
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, email: "nope", lines: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.body.fields.email).toBe("Please check your email address.");
    expect(res.body.fields.lines).toBe("Choose how many tickets you would like.");
  });

  it("is not found for an event not selling through NBCC, one not public, or while fundraising is off", async () => {
    fr.getFundraiser.mockResolvedValueOnce(event({ booking: "door" }));
    expect((await run(postTicketCheckout, { params: { id: "12" }, body: buyer })).statusCode).toBe(404);
    fr.getFundraiser.mockResolvedValueOnce(event({ public: false }));
    expect((await run(postTicketCheckout, { params: { id: "12" }, body: buyer })).statusCode).toBe(404);
    fr.fundraisingIsOn.mockResolvedValueOnce(false);
    expect((await run(postTicketCheckout, { params: { id: "12" }, body: buyer })).statusCode).toBe(404);
    expect(db.reserveOrder).not.toHaveBeenCalled();
  });

  it("refuses a checkout sent from another website", async () => {
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: buyer, headers: { "sec-fetch-site": "cross-site", origin: "https://evil.test" } });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a buyer who already has checkouts open, as too many", async () => {
    db.reserveOrder.mockResolvedValue({ ok: false, problem: "You already have a checkout open for these tickets. Finish paying there, or wait a few minutes and try again.", tooMany: true });
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: buyer });
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toContain("You already have a checkout open");
  });

  it("does not cap by address on the box itself (local development and the BDD suite)", async () => {
    const res = mockRes();
    await postTicketCheckout({ body: buyer, params: { id: "12" }, ip: "127.0.0.1", headers: { host: "nbcc.test", "sec-fetch-site": "same-origin" }, query: {} } as never, res as never);
    expect(db.reserveOrder.mock.calls[0][0].ipHash).toBeNull();
  });

  it("stores nothing for a bot that fills the hidden box", async () => {
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, company: "Bots Ltd" } });
    expect(res.statusCode).toBe(400);
    expect(db.reserveOrder).not.toHaveBeenCalled();
  });

  it("checks the spam check's pass when it is on: refused stores nothing, unavailable carries on", async () => {
    captcha.captchaEnabled.mockReturnValue(true);
    captcha.verifyCaptcha.mockResolvedValueOnce({ outcome: "refused" });
    const refused = await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, captchaToken: "bad" } });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toEqual({ error: "captcha" });
    expect(db.reserveOrder).not.toHaveBeenCalled();
    captcha.verifyCaptcha.mockResolvedValueOnce({ outcome: "unavailable", reason: "timeout" });
    expect((await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, captchaToken: "t" } })).statusCode).toBe(200);
    captcha.verifyCaptcha.mockResolvedValueOnce({ outcome: "passed" });
    expect((await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, captchaToken: "t" } })).statusCode).toBe(200);
    captcha.captchaEnabled.mockReturnValue(false);
  });

  it("is not found for an event that shares with another cause", async () => {
    fr.getFundraiser.mockResolvedValueOnce(event({ sharesWithOther: true }));
    expect((await run(postTicketCheckout, { params: { id: "12" }, body: buyer })).statusCode).toBe(404);
    expect(db.reserveOrder).not.toHaveBeenCalled();
  });

  it("tells the page what is left, for a refresh", async () => {
    const res = await run(getTicketAvailability, { params: { id: "12" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.state).toBe("open");
    expect(res.body.types).toEqual([{ id: 1, name: "Adult", pricePence: 1000, remaining: 47, soldOut: false }]);
  });
});

describe("the organiser's tickets", () => {
  it("shows the types, where each is up to, and the money apart from the gifts", async () => {
    db.ticketMoneyFor.mockResolvedValue(4000);
    const res = await run(getManageTickets, { params: { id: "12" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.types[0]).toMatchObject({ id: 1, name: "Adult", pricePence: 1000, status: "approved" });
    expect(res.body.money.words).toBe("£40 from tickets, £25 in gifts");
    expect(res.body.guestListUrl).toBe("/api/fundraise/manage/fundraisers/12/tickets/guest-list");
  });

  it("shows bookings by name and tickets only, never the buyer's email or phone", async () => {
    db.listOrders.mockResolvedValue([
      {
        id: 70, reference: "TIX-ABCDEF", status: "paid", firstName: "Robin", surname: "Example", email: "robin@example.com", phone: "07700 900999",
        ticketsPence: 2000, feeCoverPence: 0, totalPence: 2000, refundedPence: 0, paidAt: "2026-11-01T10:00:00Z",
        lines: [{ id: 1, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 0 }],
      },
    ]);
    const res = await run(getManageTickets, { params: { id: "12" } });
    expect(res.body.bookings).toEqual([{ id: 70, reference: "TIX-ABCDEF", name: "Robin Example", tickets: "2 Adult", count: 2, refunded: false, requested: false }]);
    expect(JSON.stringify(res.body)).not.toContain("robin@example.com");
    expect(JSON.stringify(res.body)).not.toContain("07700 900999");
  });

  it("is not found for an event that has never sold tickets through NBCC", async () => {
    manage.ownFundraiser.mockResolvedValue(event({ booking: "door" }));
    db.getTicketState.mockResolvedValue({ ...state, types: [] });
    expect((await run(getManageTickets, { params: { id: "12" } })).statusCode).toBe(404);
  });

  it("takes new ticket types for staff to approve, and tells staff", async () => {
    const res = await run(postManageTicketProposal, { params: { id: "12" }, body: { ticketTypes: [{ name: "Child", pricePence: 500 }], ticketLimit: 120 } });
    expect(res.statusCode).toBe(202);
    expect(db.proposeTickets).toHaveBeenCalledWith(12, [{ name: "Child", pricePence: 500, quantity: null }], 120, "kim@example.com", undefined);
    expect(send.sendTicketsProposedStaffEmail).toHaveBeenCalled();
  });

  it("refuses a type with the same name as one already there", async () => {
    const res = await run(postManageTicketProposal, { params: { id: "12" }, body: { ticketTypes: [{ name: "adult", pricePence: 500 }] } });
    expect(res.statusCode).toBe(400);
    expect(res.body.fields.ticketTypes).toBe("Ticket 1: you already have a ticket called Adult.");
  });

  it("refuses proposals for an event not selling through NBCC, and for a finished one", async () => {
    manage.ownFundraiser.mockResolvedValueOnce(event({ booking: "door" }));
    expect((await run(postManageTicketProposal, { params: { id: "12" }, body: { ticketTypes: [{ name: "Child", pricePence: 500 }] } })).statusCode).toBe(409);
    manage.ownFundraiser.mockResolvedValueOnce(event({ status: "finished" }));
    expect((await run(postManageTicketProposal, { params: { id: "12" }, body: { ticketTypes: [{ name: "Child", pricePence: 500 }] } })).statusCode).toBe(410);
  });

  it("asks staff for a refund, which only an admin can make", async () => {
    db.createRefundRequest.mockResolvedValue({ id: 5, order: { id: 70, reference: "TIX-ABCDEF", firstName: "Robin", surname: "Example", lines: [] } });
    const res = await run(postManageRefundRequest, { params: { id: "12" }, body: { orderId: 70, reason: "They cannot come." } });
    expect(res.statusCode).toBe(202);
    expect(res.body.message).toBe("Thank you. We have asked our team to look at this refund. Only NBCC can make it, and we will let the buyer know.");
    expect(db.createRefundRequest).toHaveBeenCalledWith(12, 70, "They cannot come.", "kim@example.com");
    expect(send.sendRefundRequestStaffEmail).toHaveBeenCalled();
  });

  it("says why a refund request is refused", async () => {
    db.createRefundRequest.mockRejectedValue(new db.TicketError("refused", "You have already asked for a refund of that booking. We'll be in touch."));
    const res = await run(postManageRefundRequest, { params: { id: "12" }, body: { orderId: 70, reason: "Again." } });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("You have already asked for a refund of that booking. We'll be in touch.");
  });

  it("prints the guest list, never kept or indexed", async () => {
    db.listOrders.mockResolvedValue([
      {
        id: 70, reference: "TIX-ABCDEF", status: "paid", firstName: "Robin", surname: "Example", email: "robin@example.com", phone: null,
        ticketsPence: 2000, feeCoverPence: 0, totalPence: 2000, refundedPence: 0, paidAt: "2026-11-01T10:00:00Z",
        lines: [{ id: 1, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 0 }],
      },
    ]);
    const res = await run(getManageGuestList, { params: { id: "12" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.sent).toContain("Robin Example");
    expect(res.sent).not.toContain("robin@example.com");
  });
});

describe("a free booking (every ticket £0)", () => {
  const free = {
    ok: true,
    order: { id: 71, reference: "TIX-FREEAA", money: { ticketsPence: 0, feeCoverPence: 0, totalPence: 0 }, lines: [{ typeId: 3, name: "Child", unitPence: 0, quantity: 2 }] },
  };

  // A free booking costs nothing to make, so the spam check must be on and must pass (see below).
  beforeEach(() => {
    captcha.captchaEnabled.mockReturnValue(true);
    captcha.verifyCaptcha.mockResolvedValue({ outcome: "passed" });
  });

  it("is refused, plainly, when the spam check cannot be reached or is not set up: it fails closed", async () => {
    db.reserveOrder.mockResolvedValue(free);
    captcha.verifyCaptcha.mockResolvedValueOnce({ outcome: "unavailable", reason: "timeout" });
    const down = await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, lines: [{ typeId: 3, quantity: 2, pricePence: 0 }] } });
    expect(down.statusCode).toBe(503);
    expect(down.body).toEqual({ error: "We can't take bookings just now. Please try again in a few minutes." });
    captcha.captchaEnabled.mockReturnValue(false);
    const off = await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, lines: [{ typeId: 3, quantity: 2, pricePence: 0 }] } });
    expect(off.statusCode).toBe(503);
    expect(db.reserveOrder).not.toHaveBeenCalled();
  });

  it("is told plainly when they already have two free bookings", async () => {
    db.reserveOrder.mockResolvedValue({ ok: false, problem: "You already have 2 free bookings for this event. Need more? Email events@nbcc.scot.", tooMany: true });
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, lines: [{ typeId: 3, quantity: 2, pricePence: 0 }] } });
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe("You already have 2 free bookings for this event. Need more? Email events@nbcc.scot.");
  });

  it("never goes to Stripe: it is booked at once, emailed, and sent to the thank you", async () => {
    db.reserveOrder.mockResolvedValue(free);
    db.confirmFreeOrder.mockResolvedValue(true);
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, lines: [{ typeId: 3, quantity: 2, pricePence: 0 }] } });
    expect(res.statusCode).toBe(200);
    expect(stripeMock.create).not.toHaveBeenCalled();
    const [orderId, token] = db.confirmFreeOrder.mock.calls[0];
    expect(orderId).toBe(71);
    expect(token).toMatch(/^cs_free_[0-9a-f]{32}$/);
    expect(send.sendTicketConfirmation).toHaveBeenCalledWith(71);
    expect(res.body).toEqual({ url: `/event/example-quiz?tickets=thanks&ticket_session=${token}`, free: true });
  });

  it("still goes through the same lock, limits and caps as any order", async () => {
    db.reserveOrder.mockResolvedValue({ ok: false, problem: "Sorry, these tickets have sold out." });
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: { ...buyer, lines: [{ typeId: 3, quantity: 2, pricePence: 0 }] } });
    expect(res.statusCode).toBe(409);
    expect(db.confirmFreeOrder).not.toHaveBeenCalled();
  });

  it("can be cancelled by its organiser, which tells the buyer", async () => {
    const order = { id: 71, reference: "TIX-FREEAA", firstName: "Robin", surname: "Example", email: "robin@example.com", lines: [] };
    db.cancelFreeBooking.mockResolvedValue(order);
    const res = await run(postManageCancelBooking, { params: { id: "12", orderId: "71" } });
    expect(res.statusCode).toBe(200);
    expect(db.cancelFreeBooking).toHaveBeenCalledWith(12, 71, "organiser:kim@example.com");
    expect(send.sendBookingCancelledEmail).toHaveBeenCalledWith(order);
  });

  it("says why a paid booking cannot be cancelled that way", async () => {
    db.cancelFreeBooking.mockRejectedValue(new db.TicketError("refused", "Only a free booking can be cancelled here. A booking that was paid for is refunded instead."));
    const res = await run(postManageCancelBooking, { params: { id: "12", orderId: "70" } });
    expect(res.statusCode).toBe(409);
    expect(send.sendBookingCancelledEmail).not.toHaveBeenCalled();
  });
});

describe("when ticket sales close", () => {
  it("is shown to the organiser, with any choice still waiting for us", async () => {
    db.getTicketState.mockResolvedValue({ ...state, settings: { ...state.settings, salesCloseMode: "day_before", proposedCloseMode: "custom", proposedCloseAt: "2099-12-03T18:00:00.000Z" } });
    const res = await run(getManageTickets, { params: { id: "12" } });
    expect(res.body.close).toEqual({ mode: "day_before", at: null, words: "Sales close at midnight the day before." });
    expect(res.body.proposedClose.words).toBe("Sales close on Thursday 3 December 2099 at 6pm.");
  });

  it("can be proposed by the organiser, for staff to approve", async () => {
    const res = await run(postManageTicketProposal, { params: { id: "12" }, body: { ticketClose: "day_before" } });
    expect(res.statusCode).toBe(202);
    expect(db.proposeTickets).toHaveBeenCalledWith(12, [], undefined, "kim@example.com", { mode: "day_before", at: null });
  });

  it("refuses a chosen time after the event starts", async () => {
    const res = await run(postManageTicketProposal, { params: { id: "12" }, body: { ticketClose: "custom", ticketCloseAt: "2099-12-05T20:00" } });
    expect(res.statusCode).toBe(400);
    expect(res.body.fields.ticketClose).toBe("Ticket sales need to close before the event starts.");
  });

  it("closes the checkout once it has passed", async () => {
    db.getTicketState.mockResolvedValue({ ...state, settings: { ...state.settings, salesCloseMode: "custom", salesCloseAt: "2020-01-01T00:00:00.000Z" } });
    const res = await run(getTicketAvailability, { params: { id: "12" } });
    expect(res.body.state).toBe("closed");
  });
});

describe("an honest buyer who starts again", () => {
  it("has their older checkout for the event closed at Stripe and cancelled, then carries on", async () => {
    db.openOrdersOfBuyer.mockResolvedValue([{ id: 60, sessionId: "cs_old" }, { id: 61, sessionId: null }]);
    const order: string[] = [];
    stripeMock.expire.mockImplementation(async () => (order.push("expire"), {}));
    db.supersedeOrder.mockImplementation(async (id: number) => (order.push(`cancel ${id}`), true));
    db.reserveOrder.mockImplementation(async () => (order.push("reserve"), { ok: true, order: { id: 70, reference: "TIX-ABCDEF", money: { ticketsPence: 2000, feeCoverPence: 0, totalPence: 2000 }, lines: [{ typeId: 1, name: "Adult", unitPence: 1000, quantity: 2 }] } }));
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: buyer });
    expect(res.statusCode).toBe(200);
    expect(stripeMock.expire).toHaveBeenCalledWith("cs_old");
    expect(order).toEqual(["expire", "cancel 60", "cancel 61", "reserve"]);
    // Each is cancelled only if its checkout is still the one that was read (and closed).
    expect(db.supersedeOrder.mock.calls).toEqual([
      [60, "cs_old"],
      [61, null],
    ]);
    expect(db.openOrdersOfBuyer.mock.calls[0].slice(0, 2)).toEqual([12, "robin@example.com"]);
  });

  it("keeps an older checkout Stripe will not close (it may be paying this second)", async () => {
    db.openOrdersOfBuyer.mockResolvedValue([{ id: 60, sessionId: "cs_old" }]);
    stripeMock.expire.mockRejectedValue(new Error("This session has already completed"));
    await run(postTicketCheckout, { params: { id: "12" }, body: buyer });
    expect(db.supersedeOrder).not.toHaveBeenCalled();
    expect(db.reserveOrder).toHaveBeenCalled();
  });
});

describe("a checkout that took too long to open", () => {
  it("never brings back a hold already released: Stripe's checkout is closed and the buyer told", async () => {
    db.attachSession.mockResolvedValue(false);
    const res = await run(postTicketCheckout, { params: { id: "12" }, body: buyer });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "Sorry, that took too long and your tickets were released. Please try again.", refresh: true });
    expect(stripeMock.expire).toHaveBeenCalledWith("cs_test_1");
    expect(db.cancelPendingOrder).toHaveBeenCalledWith(70);
  });
});

describe("a closing time that has already passed", () => {
  it("is refused when the organiser proposes it", async () => {
    const res = await run(postManageTicketProposal, { params: { id: "12" }, body: { ticketClose: "custom", ticketCloseAt: "2020-01-01T10:00" } });
    expect(res.statusCode).toBe(400);
    expect(res.body.fields.ticketClose).toBe("Choose a time that hasn't passed yet.");
  });
});
