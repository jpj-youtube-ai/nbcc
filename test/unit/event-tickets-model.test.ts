import { describe, it, expect } from "vitest";
import {
  ALL_MONEY_NOTE,
  COSTS_NOTE,
  MAX_TICKETS_PER_ORDER,
  NBCC_TICKETS_SHARED,
  availability,
  checkOrder,
  checkTicketSignUp,
  checkTicketTypes,
  checkoutSchema,
  guestList,
  hasStarted,
  londonMinute,
  makeTicketReference,
  moneySplit,
  orderMoney,
  refundPlan,
  salesState,
  ticketMoneyPence,
  ticketsCsv,
  type TicketTypeRow,
  type OrderForList,
} from "../../src/tickets/model";
import { grossedUpFeePence } from "../../src/ball/pricing";

const RATE = { percentBp: 120, fixedPence: 20 };

const type = (over: Partial<TicketTypeRow> = {}): TicketTypeRow => ({
  id: 1,
  name: "Adult",
  pricePence: 1000,
  quantity: null,
  status: "approved",
  position: 0,
  ...over,
});

describe("the wording on the sign up form", () => {
  it("says to choose NBCC only when all the ticket money comes to NBCC, and how costs are repaid", () => {
    expect(ALL_MONEY_NOTE).toBe(
      "Choose this only if all the ticket money is going to NBCC. If you're sharing ticket money with another cause or keeping some for costs, sell them your own way and pay NBCC its share afterwards.",
    );
    expect(COSTS_NOTE).toBe("If you have costs, like the hall, talk to us: we can repay agreed costs against receipts.");
  });
});

describe("checking the ticket types an organiser proposes", () => {
  it("takes a name, a price in whole pence and an optional number on sale", () => {
    const r = checkTicketTypes([
      { name: " Adult ", pricePence: 1000, quantity: 80 },
      { name: "Child", pricePence: 500 },
    ]);
    expect(r.fields).toEqual({});
    expect(r.types).toEqual([
      { name: "Adult", pricePence: 1000, quantity: 80 },
      { name: "Child", pricePence: 500, quantity: null },
    ]);
  });

  it("needs at least one", () => {
    expect(checkTicketTypes([]).fields.ticketTypes).toBe("Add at least one kind of ticket, like Adult at £10.");
  });

  it("refuses a price under £1 or over £500, or with part pennies, naming the ticket", () => {
    expect(checkTicketTypes([{ name: "Adult", pricePence: 99 }]).fields.ticketTypes).toBe("Ticket 1: the price needs to be £0 for a free ticket, or from £1 to £500.");
    expect(checkTicketTypes([{ name: "A", pricePence: 1000 }, { name: "B", pricePence: 50001 }]).fields.ticketTypes).toBe(
      "Ticket 2: the price needs to be £0 for a free ticket, or from £1 to £500.",
    );
    expect(checkTicketTypes([{ name: "Adult", pricePence: 10.5 }]).fields.ticketTypes).toBe("Ticket 1: the price needs to be £0 for a free ticket, or from £1 to £500.");
  });

  it("refuses a missing or long name, two with the same name, and a silly number on sale", () => {
    expect(checkTicketTypes([{ name: "  ", pricePence: 1000 }]).fields.ticketTypes).toBe("Ticket 1: give it a name, like Adult.");
    expect(checkTicketTypes([{ name: "x".repeat(61), pricePence: 1000 }]).fields.ticketTypes).toBe("Ticket 1: keep the name to 60 characters or fewer.");
    expect(checkTicketTypes([{ name: "Adult", pricePence: 1000 }, { name: "adult", pricePence: 800 }]).fields.ticketTypes).toBe(
      "Ticket 2: you already have a ticket called Adult.",
    );
    expect(checkTicketTypes([{ name: "Adult", pricePence: 1000, quantity: 0 }]).fields.ticketTypes).toBe(
      "Ticket 1: the number on sale needs to be a whole number from 1 to 5,000, or left empty.",
    );
  });

  it("takes up to 10", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `T${i}`, pricePence: 100 }));
    expect(checkTicketTypes(eleven).fields.ticketTypes).toBe("You can have up to 10 kinds of ticket.");
  });
});

describe("the sign up's ticket plan", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    path: "event",
    booking: "nbcc",
    sharesWithOther: false,
    ticketTypes: [{ name: "Adult", pricePence: 1200 }],
    ticketLimit: 100,
    ...over,
  });

  it("is only for an event where NBCC sells the tickets", () => {
    expect(checkTicketSignUp(body({ booking: "door" }))).toEqual({ fields: {}, plan: null });
    expect(checkTicketSignUp(body({ path: "raising" }))).toEqual({ fields: {}, plan: null });
  });

  it("keeps the types and the overall limit", () => {
    expect(checkTicketSignUp(body())).toEqual({
      fields: {},
      plan: { types: [{ name: "Adult", pricePence: 1200, quantity: null }], salesLimit: 100, close: { mode: "start", at: null } },
    });
    expect(checkTicketSignUp(body({ ticketLimit: "" })).plan?.salesLimit).toBeNull();
  });

  it("refuses NBCC selling the tickets when the money is shared with another cause", () => {
    expect(checkTicketSignUp(body({ sharesWithOther: true })).fields.booking).toBe(NBCC_TICKETS_SHARED);
  });

  it("refuses a limit that is not a whole number from 1 to 5,000", () => {
    expect(checkTicketSignUp(body({ ticketLimit: 0 })).fields.ticketLimit).toBe(
      "The most tickets to sell needs to be a whole number from 1 to 5,000, or left empty for no limit.",
    );
    expect(checkTicketSignUp(body({ ticketLimit: 5001 })).fields.ticketLimit).toBeTruthy();
  });

  it("names a problem with the types", () => {
    expect(checkTicketSignUp(body({ ticketTypes: [] })).fields.ticketTypes).toBe("Add at least one kind of ticket, like Adult at £10.");
    expect(checkTicketSignUp(body({ ticketTypes: "nope" })).fields.ticketTypes).toBe("Add at least one kind of ticket, like Adult at £10.");
  });
});

describe("what is left to sell", () => {
  it("is the number on sale less those taken, held to the overall limit", () => {
    const a = availability({
      types: [type({ id: 1, quantity: 50 }), type({ id: 2, name: "Child", pricePence: 500, quantity: null })],
      salesLimit: 60,
      taken: { 1: 45, 2: 10 },
    });
    expect(a.overallRemaining).toBe(5);
    expect(a.types.find((t) => t.id === 1)?.remaining).toBe(5);
    expect(a.types.find((t) => t.id === 2)?.remaining).toBe(5);
    expect(a.soldOut).toBe(false);
  });

  it("is sold out per type, and for the whole event when the limit is reached", () => {
    const perType = availability({ types: [type({ id: 1, quantity: 10 }), type({ id: 2, name: "Child" })], salesLimit: null, taken: { 1: 10 } });
    expect(perType.types.find((t) => t.id === 1)?.soldOut).toBe(true);
    expect(perType.types.find((t) => t.id === 2)?.soldOut).toBe(false);
    expect(perType.soldOut).toBe(false);
    const all = availability({ types: [type({ id: 1 }), type({ id: 2, name: "Child" })], salesLimit: 30, taken: { 1: 20, 2: 10 } });
    expect(all.soldOut).toBe(true);
    expect(all.types.every((t) => t.soldOut)).toBe(true);
  });

  it("counts places taken by a withdrawn type towards the limit, but never sells it", () => {
    const a = availability({ types: [type({ id: 1 }), type({ id: 2, name: "Early bird", status: "withdrawn" })], salesLimit: 10, taken: { 2: 8 } });
    expect(a.overallRemaining).toBe(2);
    expect(a.types.map((t) => t.id)).toEqual([1]);
  });

  it("never shows a negative, even if more were taken than allowed", () => {
    const a = availability({ types: [type({ id: 1, quantity: 5 })], salesLimit: 3, taken: { 1: 7 } });
    expect(a.overallRemaining).toBe(0);
    expect(a.types[0].remaining).toBe(0);
    expect(a.soldOut).toBe(true);
  });

  it("is not on sale with no approved type", () => {
    const a = availability({ types: [type({ status: "proposed" })], salesLimit: null, taken: {} });
    expect(a.onSale).toBe(false);
    expect(a.soldOut).toBe(false);
  });
});

describe("checking an order against what is left", () => {
  const a = availability({ types: [type({ id: 1, quantity: 10 }), type({ id: 2, name: "Child", pricePence: 500 })], salesLimit: 12, taken: { 1: 8 } });

  it("allows what is left", () => {
    expect(checkOrder([{ typeId: 1, quantity: 2 }, { typeId: 2, quantity: 2 }], a)).toBeNull();
  });

  it("refuses more of a type than is left, naming it", () => {
    expect(checkOrder([{ typeId: 1, quantity: 3 }], a)).toBe("Sorry, there are only 2 Adult tickets left.");
  });

  it("refuses more than the event has left overall", () => {
    expect(checkOrder([{ typeId: 1, quantity: 2 }, { typeId: 2, quantity: 3 }], a)).toBe("Sorry, there are only 4 tickets left.");
  });

  it("refuses a type not on sale, an empty order, a type twice, and too many at once", () => {
    expect(checkOrder([{ typeId: 9, quantity: 1 }], a)).toBe("That ticket is no longer on sale. Please refresh the page.");
    expect(checkOrder([], a)).toBe("Choose how many tickets you would like.");
    expect(checkOrder([{ typeId: 2, quantity: 1 }, { typeId: 2, quantity: 1 }], a)).toBe("Choose how many tickets you would like.");
    const big = availability({ types: [type({ id: 1 })], salesLimit: null, taken: {} });
    expect(checkOrder([{ typeId: 1, quantity: MAX_TICKETS_PER_ORDER + 1 }], big)).toBe("You can buy up to 20 tickets at a time.");
  });

  it("says sold out when nothing at all is left", () => {
    const gone = availability({ types: [type({ id: 1, quantity: 2 })], salesLimit: null, taken: { 1: 2 } });
    expect(checkOrder([{ typeId: 1, quantity: 1 }], gone)).toBe("Sorry, these tickets have sold out.");
  });
});

describe("the money for an order", () => {
  it("adds up the tickets, in pence", () => {
    expect(orderMoney([{ unitPence: 1000, quantity: 2 }, { unitPence: 550, quantity: 1 }], false, RATE)).toEqual({
      ticketsPence: 2550,
      feeCoverPence: 0,
      totalPence: 2550,
    });
  });

  it("covers the card fee, grossed up as the ball and donations do, on the tickets", () => {
    const m = orderMoney([{ unitPence: 1000, quantity: 3 }], true, RATE);
    expect(m.feeCoverPence).toBe(grossedUpFeePence(3000, RATE));
    expect(m.totalPence).toBe(3000 + m.feeCoverPence);
    // What Stripe takes on the total leaves NBCC at least the ticket money.
    const stripeTakes = Math.ceil((m.totalPence * RATE.percentBp) / 10_000) + RATE.fixedPence;
    expect(m.totalPence - stripeTakes).toBeGreaterThanOrEqual(3000);
  });
});

describe("the checkout form", () => {
  const good = {
    lines: [{ typeId: 1, quantity: 2, pricePence: 1000 }],
    firstName: "Robin",
    lastName: "Example",
    email: "robin@example.com",
    phone: "07700 900123",
    coverFee: true,
  };

  it("takes the lines, the buyer and the fee choice", () => {
    const r = checkoutSchema.safeParse(good);
    expect(r.success).toBe(true);
  });

  it("drops lines of none, and needs a name and email", () => {
    const r = checkoutSchema.safeParse({ ...good, lines: [{ typeId: 1, quantity: 0, pricePence: 1000 }, { typeId: 2, quantity: 1, pricePence: 500 }] });
    expect(r.success && r.data.lines).toEqual([{ typeId: 2, quantity: 1, pricePence: 500 }]);
    const bad = checkoutSchema.safeParse({ ...good, firstName: "", email: "nope" });
    expect(bad.success).toBe(false);
  });

  it("lets the phone be left empty", () => {
    const r = checkoutSchema.safeParse({ ...good, phone: "" });
    expect(r.success && r.data.phone).toBeNull();
  });
});

describe("when sales are open", () => {
  const ev = {
    status: "approved" as const,
    public: true,
    path: "event" as const,
    booking: "nbcc",
    inMemory: false,
    salesClosedAt: null,
    eventDate: "2026-12-05",
    startTime: "19:30",
  };
  const before = new Date("2026-12-05T19:00:00Z"); // 19:00 in London (GMT in December)
  const ctx = { fundraisingOn: true, now: before, onSale: true, soldOut: false };

  it("is open for an approved public event selling through NBCC, before it starts", () => {
    expect(salesState(ev, ctx)).toBe("open");
  });

  it("closes at the start time, in London time", () => {
    expect(salesState(ev, { ...ctx, now: new Date("2026-12-05T19:30:00Z") })).toBe("started");
    // In summer London is an hour ahead: 18:29 UTC is 19:29 there.
    const summer = { ...ev, eventDate: "2026-07-04" };
    expect(salesState(summer, { ...ctx, now: new Date("2026-07-04T18:29:00Z") })).toBe("open");
    expect(salesState(summer, { ...ctx, now: new Date("2026-07-04T18:30:00Z") })).toBe("started");
  });

  it("closes at the start of the day when there is no start time", () => {
    expect(salesState({ ...ev, startTime: null }, { ...ctx, now: new Date("2026-12-04T23:59:00Z") })).toBe("open");
    expect(salesState({ ...ev, startTime: null }, { ...ctx, now: new Date("2026-12-05T00:00:00Z") })).toBe("started");
  });

  it("is closed when staff closed it, soon with no approved ticket, and sold out", () => {
    expect(salesState({ ...ev, salesClosedAt: "2026-12-01T10:00:00Z" }, ctx)).toBe("closed");
    expect(salesState(ev, { ...ctx, onSale: false })).toBe("soon");
    expect(salesState(ev, { ...ctx, soldOut: true })).toBe("sold_out");
  });

  it("is finished for a finished event, and off for everything that cannot sell", () => {
    expect(salesState({ ...ev, status: "finished" }, ctx)).toBe("finished");
    expect(salesState(ev, { ...ctx, fundraisingOn: false })).toBe("off");
    expect(salesState({ ...ev, status: "new" }, ctx)).toBe("off");
    expect(salesState({ ...ev, public: false }, ctx)).toBe("off");
    expect(salesState({ ...ev, booking: "door" }, ctx)).toBe("off");
    expect(salesState({ ...ev, inMemory: true }, ctx)).toBe("off");
    expect(salesState({ ...ev, path: "raising" }, ctx)).toBe("off");
    expect(salesState({ ...ev, eventDate: null }, ctx)).toBe("off");
  });
});

describe("London time", () => {
  it("gives the minute in London", () => {
    expect(londonMinute(new Date("2026-07-04T18:30:00Z"))).toBe("2026-07-04T19:30");
    expect(londonMinute(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31T23:59");
  });

  it("reads a stored time with seconds", () => {
    expect(hasStarted("2026-12-05", "19:30:00", new Date("2026-12-05T19:29:00Z"))).toBe(false);
    expect(hasStarted("2026-12-05", "19:30:00", new Date("2026-12-05T19:30:00Z"))).toBe(true);
  });
});

describe("a booking reference", () => {
  it("is TIX- and six letters and numbers that cannot be misread", () => {
    expect(makeTicketReference(Buffer.from([0, 1, 2, 3, 4, 5]))).toBe("TIX-ABCDEF");
    expect(makeTicketReference(Buffer.from([255, 254, 253, 252, 251, 250]))).toMatch(/^TIX-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });
});

const order = (over: Partial<OrderForList> = {}): OrderForList => ({
  id: 7,
  reference: "TIX-ABCDEF",
  status: "paid",
  firstName: "Robin",
  surname: "Example",
  email: "robin@example.com",
  phone: "07700 900123",
  ticketsPence: 2500,
  feeCoverPence: 52,
  totalPence: 2552,
  refundedPence: 0,
  paidAt: "2026-11-01T10:00:00.000Z",
  lines: [
    { id: 70, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 0 },
    { id: 71, typeName: "Child", unitPence: 500, quantity: 1, refundedQuantity: 0 },
  ],
  ...over,
});

describe("ticket money", () => {
  it("is the paid ticket money less refunds, never the card fee cover", () => {
    expect(ticketMoneyPence([order(), order({ id: 8, refundedPence: 1000 }), order({ id: 9, status: "pending" })])).toBe(2500 + 1500);
  });

  it("is nothing for an order refunded in full", () => {
    expect(ticketMoneyPence([order({ refundedPence: 2552 })])).toBe(0);
  });

  it("is shown apart from gifts", () => {
    expect(moneySplit(4000, 2500)).toEqual({ ticketsPence: 4000, giftsPence: 2500, totalPence: 6500, words: "£40 from tickets, £25 in gifts" });
  });
});

describe("a refund", () => {
  it("is the price of the tickets refunded", () => {
    expect(refundPlan(order(), [{ lineId: 70, quantity: 1 }])).toEqual({
      ok: true,
      amountPence: 1000,
      lines: [{ lineId: 70, quantity: 1 }],
      full: false,
    });
  });

  it("gives back the card fee cover too when every ticket is refunded", () => {
    expect(refundPlan(order(), [{ lineId: 70, quantity: 2 }, { lineId: 71, quantity: 1 }])).toEqual({
      ok: true,
      amountPence: 2552,
      lines: [{ lineId: 70, quantity: 2 }, { lineId: 71, quantity: 1 }],
      full: true,
    });
  });

  it("never refunds more than is left, or a ticket already refunded", () => {
    const partly = order({ refundedPence: 1000, lines: [{ id: 70, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 1 }, { id: 71, typeName: "Child", unitPence: 500, quantity: 1, refundedQuantity: 0 }] });
    expect(refundPlan(partly, [{ lineId: 70, quantity: 2 }])).toEqual({ ok: false, error: "Only 1 Adult ticket is left to refund on this booking." });
    expect(refundPlan(partly, [{ lineId: 70, quantity: 1 }, { lineId: 71, quantity: 1 }])).toMatchObject({ ok: true, amountPence: 1552, full: true });
    // Money refunded in Stripe by hand already: never past what was paid.
    const byHand = order({ refundedPence: 2500 });
    expect(refundPlan(byHand, [{ lineId: 70, quantity: 2 }, { lineId: 71, quantity: 1 }])).toMatchObject({ ok: true, amountPence: 52 });
  });

  it("refuses an empty refund, a line from another booking, and an unpaid booking", () => {
    expect(refundPlan(order(), [])).toEqual({ ok: false, error: "Choose which tickets to refund." });
    expect(refundPlan(order(), [{ lineId: 99, quantity: 1 }])).toEqual({ ok: false, error: "That ticket is not on this booking." });
    expect(refundPlan(order({ status: "pending" }), [{ lineId: 70, quantity: 1 }])).toEqual({ ok: false, error: "Only a paid booking can be refunded." });
    expect(refundPlan(order({ refundedPence: 2552 }), [{ lineId: 70, quantity: 1 }])).toEqual({ ok: false, error: "This booking has been refunded in full already." });
  });
});

describe("the guest list", () => {
  it("lists paid bookings with tickets left, by surname, with what each has", () => {
    const list = guestList([
      order({ id: 1, reference: "TIX-AAAAAA", firstName: "Sam", surname: "Young" }),
      order({ id: 2, reference: "TIX-BBBBBB", firstName: "Alex", surname: "Abbot", lines: [{ id: 5, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 1 }] }),
      order({ id: 3, reference: "TIX-CCCCCC", status: "pending" }),
      order({ id: 4, reference: "TIX-DDDDDD", refundedPence: 2552, lines: [{ id: 6, typeName: "Adult", unitPence: 1000, quantity: 1, refundedQuantity: 1 }] }),
    ]);
    expect(list.rows).toEqual([
      { name: "Alex Abbot", reference: "TIX-BBBBBB", tickets: "1 Adult", count: 1 },
      { name: "Sam Young", reference: "TIX-AAAAAA", tickets: "2 Adult, 1 Child", count: 3 },
    ]);
    expect(list.totalTickets).toBe(4);
    expect(list.byType).toEqual([
      { name: "Adult", count: 3 },
      { name: "Child", count: 1 },
    ]);
  });
});

describe("the staff CSV", () => {
  it("has the buyer's details and the money, with a formula defused", () => {
    const csv = ticketsCsv([order({ firstName: "=cmd" })]);
    const [head, row] = csv.split("\r\n");
    expect(head).toBe(
      '"Reference","Status","Paid","First name","Surname","Email","Phone","Tickets","Number of tickets","Tickets £","Card fee cover £","Total £","Refunded £"',
    );
    expect(row).toContain('"\'=cmd"');
    expect(row).toContain('"2 Adult, 1 Child"');
    expect(row).toContain('"25.00","0.52","25.52","0.00"');
  });
});

// --- the money review (PR 651) ------------------------------------------------------------------------

import { flagWords, refundIsStale, adminRefundSchema, LIVE_HOLDS_MAX, UNATTACHED_HOLD_MINUTES } from "../../src/tickets/model";

describe("never when sharing with another cause", () => {
  it("is off for an event that shares what it raises, whatever else is true", () => {
    const ev = { status: "approved", public: true, path: "event", booking: "nbcc", inMemory: false, salesClosedAt: null, eventDate: "2026-12-05", startTime: "19:30" };
    const ctx = { fundraisingOn: true, now: new Date("2026-12-01T10:00:00Z"), onSale: true, soldOut: false };
    expect(salesState({ ...ev, sharesWithOther: true }, ctx)).toBe("off");
    expect(salesState({ ...ev, sharesWithOther: false }, ctx)).toBe("open");
  });
});

describe("a price that changed since the page loaded", () => {
  const a = availability({ types: [type({ id: 1, pricePence: 1200 })], salesLimit: null, taken: {} });

  it("is refused, so nobody pays a price they did not see", () => {
    expect(checkOrder([{ typeId: 1, quantity: 1, pricePence: 1000 }], a)).toBe("The price of this ticket has changed. Please refresh the page.");
    expect(checkOrder([{ typeId: 1, quantity: 1, pricePence: 1200 }], a)).toBeNull();
  });

  it("must be sent with the order", () => {
    const r = checkoutSchema.safeParse({ lines: [{ typeId: 1, quantity: 1 }], firstName: "R", lastName: "E", email: "r@example.com", phone: "", coverFee: false });
    expect(r.success).toBe(false);
  });
});

describe("holds", () => {
  it("allows two live checkouts for one buyer, and five minutes for one with no Stripe checkout yet", () => {
    expect(LIVE_HOLDS_MAX).toBe(2);
    expect(UNATTACHED_HOLD_MINUTES).toBe(5);
  });
});

describe("a refund against a booking that has changed", () => {
  const o = order({ refundedPence: 1000, lines: [{ id: 70, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 1 }] });

  it("is stale when the tickets or the money refunded are not what the admin saw", () => {
    expect(refundIsStale(o, [{ lineId: 70, quantity: 1, refundedQuantity: 0 }], 1000)).toBe(true);
    expect(refundIsStale(o, [{ lineId: 70, quantity: 1, refundedQuantity: 1 }], 0)).toBe(true);
    expect(refundIsStale(o, [{ lineId: 70, quantity: 1, refundedQuantity: 1 }], 1000)).toBe(false);
  });

  it("needs what the admin saw, with the tickets chosen", () => {
    expect(adminRefundSchema.safeParse({ lines: [{ lineId: 70, quantity: 1 }], refundedPence: 0 }).success).toBe(false);
    expect(adminRefundSchema.safeParse({ lines: [{ lineId: 70, quantity: 1, refundedQuantity: 0 }] }).success).toBe(false);
    expect(adminRefundSchema.safeParse({ lines: [{ lineId: 70, quantity: 1, refundedQuantity: 0 }], refundedPence: 0 }).success).toBe(true);
  });
});

describe("what staff are told about a booking", () => {
  it("says a late payment that took the event over its limit, a wrong amount, and a dispute", () => {
    expect(flagWords({ paidLate: { overBy: 2 } })).toEqual(["Paid late: this event is now 2 over its limit"]);
    expect(flagWords({ paidLate: { overBy: 0 } })).toEqual([]);
    expect(flagWords({ amountMismatch: { expected: 2000, paid: 1000 } })).toEqual(["Amount paid doesn't match: check this booking"]);
    expect(flagWords({ sessionMismatch: true })).toEqual(["Paid on a different checkout: check this booking"]);
    expect(flagWords({ currencyMismatch: "usd" })).toEqual(["Not paid in pounds: check this booking"]);
    expect(flagWords({ disputed: true })).toEqual(["Disputed with the bank: this money is not counted"]);
    expect(flagWords(null)).toEqual([]);
  });
});

describe("disputed money", () => {
  it("is not counted in the ticket money", () => {
    expect(ticketMoneyPence([order(), order({ id: 8, disputed: true })])).toBe(2500);
  });
});

describe("the CSV for someone who may only look", () => {
  it("has no email or phone", () => {
    const csv = ticketsCsv([order()], { contact: false });
    expect(csv).not.toContain("robin@example.com");
    expect(csv).not.toContain("07700 900123");
    expect(csv.split("\r\n")[0]).not.toContain("Email");
  });
});

// --- Jaimie's answers (2026-10-03): free tickets, and when sales close --------------------------------

import { checkCloseChoice, closeWords, isFreeOrder, londonToInstant } from "../../src/tickets/model";

describe("free tickets that still need booking", () => {
  it("are allowed at £0; anything between is not a price", () => {
    expect(checkTicketTypes([{ name: "Child", pricePence: 0 }])).toEqual({ types: [{ name: "Child", pricePence: 0, quantity: null }], fields: {} });
    expect(checkTicketTypes([{ name: "Child", pricePence: 50 }]).fields.ticketTypes).toBe("Ticket 1: the price needs to be £0 for a free ticket, or from £1 to £500.");
  });

  it("make an order with nothing to pay, which never goes to Stripe", () => {
    const m = orderMoney([{ unitPence: 0, quantity: 3 }], true, RATE);
    expect(m).toEqual({ ticketsPence: 0, feeCoverPence: 0, totalPence: 0 });
    expect(isFreeOrder(m)).toBe(true);
    expect(isFreeOrder(orderMoney([{ unitPence: 0, quantity: 1 }, { unitPence: 1000, quantity: 1 }], false, RATE))).toBe(false);
  });

  it("have no money to refund: a free booking is cancelled instead", () => {
    const free = order({ ticketsPence: 0, feeCoverPence: 0, totalPence: 0, lines: [{ id: 70, typeName: "Child", unitPence: 0, quantity: 2, refundedQuantity: 0 }] });
    expect(refundPlan(free, [{ lineId: 70, quantity: 1 }])).toEqual({ ok: false, error: "A free booking has no money to refund. Cancel the booking instead." });
  });

  it("on a paid booking cannot be refunded by themselves", () => {
    const mixed = order({ lines: [{ id: 70, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 0 }, { id: 71, typeName: "Child", unitPence: 0, quantity: 1, refundedQuantity: 0 }], ticketsPence: 2000, feeCoverPence: 0, totalPence: 2000 });
    expect(refundPlan(mixed, [{ lineId: 71, quantity: 1 }])).toEqual({ ok: false, error: "Those tickets were free, so there is nothing to refund. Choose a paid ticket, or the whole booking." });
    expect(refundPlan(mixed, [{ lineId: 70, quantity: 2 }, { lineId: 71, quantity: 1 }])).toMatchObject({ ok: true, amountPence: 2000, full: true });
  });
});

describe("when ticket sales close, as the host chose", () => {
  const ev = { status: "approved", public: true, path: "event", booking: "nbcc", inMemory: false, salesClosedAt: null, eventDate: "2026-12-05", startTime: "19:30" };
  const at = (iso: string) => ({ fundraisingOn: true, now: new Date(iso), onSale: true, soldOut: false });

  it("is when the event starts, unless they chose otherwise (and for anything from before the question)", () => {
    expect(salesState(ev, at("2026-12-05T19:29:00Z"))).toBe("open");
    expect(salesState({ ...ev, salesCloseMode: "start" }, at("2026-12-05T19:30:00Z"))).toBe("started");
  });

  it("can be midnight the day before", () => {
    expect(salesState({ ...ev, salesCloseMode: "day_before" }, at("2026-12-04T23:59:00Z"))).toBe("open");
    expect(salesState({ ...ev, salesCloseMode: "day_before" }, at("2026-12-05T00:00:00Z"))).toBe("closed");
  });

  it("can be a date and time they choose, and never later than the start", () => {
    const custom = { ...ev, salesCloseMode: "custom", salesCloseAt: "2026-12-03T18:00:00.000Z" };
    expect(salesState(custom, at("2026-12-03T17:59:00Z"))).toBe("open");
    expect(salesState(custom, at("2026-12-03T18:00:00Z"))).toBe("closed");
    expect(salesState({ ...custom, salesCloseAt: "2026-12-09T18:00:00.000Z" }, at("2026-12-05T19:30:00Z"))).toBe("started");
  });

  it("reads a London date and time as the moment it is, summer and winter", () => {
    expect(londonToInstant("2026-12-03T18:00")).toBe("2026-12-03T18:00:00.000Z");
    expect(londonToInstant("2026-07-03T18:00")).toBe("2026-07-03T17:00:00.000Z");
    expect(londonToInstant("nonsense")).toBeNull();
  });

  it("checks the choice: one of the three, and a chosen time before the event starts", () => {
    const e = { eventDate: "2026-12-05", startTime: "19:30" };
    expect(checkCloseChoice({}, e)).toEqual({ close: { mode: "start", at: null } });
    expect(checkCloseChoice({ ticketClose: "day_before" }, e)).toEqual({ close: { mode: "day_before", at: null } });
    expect(checkCloseChoice({ ticketClose: "custom", ticketCloseAt: "2026-12-03T18:00" }, e)).toEqual({ close: { mode: "custom", at: "2026-12-03T18:00:00.000Z" } });
    expect(checkCloseChoice({ ticketClose: "custom", ticketCloseAt: "" }, e)).toEqual({ error: "Choose the date and time ticket sales should close." });
    expect(checkCloseChoice({ ticketClose: "custom", ticketCloseAt: "2026-12-05T20:00" }, e)).toEqual({ error: "Ticket sales need to close before the event starts." });
    expect(checkCloseChoice({ ticketClose: "whenever" }, e)).toEqual({ error: "Choose when ticket sales should close." });
  });

  it("says it in words for the page", () => {
    expect(closeWords({ mode: "start", at: null })).toBe("Sales close when the event starts.");
    expect(closeWords({ mode: "day_before", at: null })).toBe("Sales close at midnight the day before.");
    expect(closeWords({ mode: "custom", at: "2026-12-03T18:00:00.000Z" })).toBe("Sales close on Thursday 3 December 2026 at 6pm.");
    expect(closeWords(null)).toBe("Sales close when the event starts.");
  });

  it("is part of the sign up's ticket plan", () => {
    const r = checkTicketSignUp({ path: "event", booking: "nbcc", sharesWithOther: false, eventDate: "2026-12-05", startTime: "19:30", ticketTypes: [{ name: "Adult", pricePence: 1200 }], ticketClose: "day_before" });
    expect(r.plan?.close).toEqual({ mode: "day_before", at: null });
    const bad = checkTicketSignUp({ path: "event", booking: "nbcc", eventDate: "2026-12-05", ticketTypes: [{ name: "Adult", pricePence: 1200 }], ticketClose: "custom" });
    expect(bad.fields.ticketClose).toBe("Choose the date and time ticket sales should close.");
  });
});

// --- the second money review -------------------------------------------------------------------------

import { FREE_TICKETS_MAX, FREE_TICKETS_MESSAGE, releasePlan } from "../../src/tickets/model";

describe("free tickets in one order", () => {
  const a = availability({ types: [type({ id: 1, pricePence: 0, name: "Under 5" }), type({ id: 2, pricePence: 1000 })], salesLimit: null, taken: {} });

  it("are capped at 10, said plainly", () => {
    expect(FREE_TICKETS_MAX).toBe(10);
    expect(checkOrder([{ typeId: 1, quantity: 11 }], a)).toBe("You can book up to 10 free tickets at a time. Need more? Email events@nbcc.scot.");
    expect(FREE_TICKETS_MESSAGE).toBe("You can book up to 10 free tickets at a time. Need more? Email events@nbcc.scot.");
    expect(checkOrder([{ typeId: 1, quantity: 10 }, { typeId: 2, quantity: 10 }], a)).toBeNull();
  });
});

describe("a closing time the host chooses", () => {
  const e = { eventDate: "2026-12-05", startTime: "19:30" };

  it("cannot have passed already", () => {
    expect(checkCloseChoice({ ticketClose: "custom", ticketCloseAt: "2026-11-01T10:00" }, e, new Date("2026-11-02T00:00:00Z"))).toEqual({ error: "Choose a time that hasn't passed yet." });
    expect(checkCloseChoice({ ticketClose: "custom", ticketCloseAt: "2026-11-03T10:00" }, e, new Date("2026-11-02T00:00:00Z"))).toEqual({ close: { mode: "custom", at: "2026-11-03T10:00:00.000Z" } });
  });

  it("in the hour the clocks skip in spring is the first minute after it", () => {
    // 29 March 2026: 01:00 to 01:59 never happens in London; 02:00 BST is 01:00 UTC.
    expect(londonToInstant("2026-03-29T01:30")).toBe("2026-03-29T01:00:00.000Z");
    expect(londonToInstant("2026-03-29T00:59")).toBe("2026-03-29T00:59:00.000Z");
    expect(londonToInstant("2026-03-29T02:00")).toBe("2026-03-29T01:00:00.000Z");
  });
});

describe("releasing tickets with no money moving", () => {
  const mixed = order({
    ticketsPence: 2000, feeCoverPence: 0, totalPence: 2000, refundedPence: 0,
    lines: [{ id: 70, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 0 }, { id: 71, typeName: "Under 5", unitPence: 0, quantity: 2, refundedQuantity: 0 }],
  });

  it("is allowed for free tickets on a paid booking", () => {
    expect(releasePlan(mixed, [{ lineId: 71, quantity: 1 }])).toEqual({ ok: true, lines: [{ lineId: 71, quantity: 1 }], tickets: "1 Under 5" });
  });

  it("is refused for paid tickets whose money has not been refunded", () => {
    expect(releasePlan(mixed, [{ lineId: 70, quantity: 1 }])).toEqual({ ok: false, error: "Refund the money for those tickets first: nothing has been refunded for them." });
  });

  it("is allowed for paid tickets once their money was refunded outside the admin, and only that many", () => {
    const refundedInStripe = { ...mixed, refundedPence: 1000 };
    expect(releasePlan(refundedInStripe, [{ lineId: 70, quantity: 1 }])).toMatchObject({ ok: true, tickets: "1 Adult" });
    expect(releasePlan(refundedInStripe, [{ lineId: 70, quantity: 2 }])).toMatchObject({ ok: false });
    // One already released against that money: no more.
    const used = { ...refundedInStripe, lines: [{ ...mixed.lines[0], refundedQuantity: 1 }, mixed.lines[1]] };
    expect(releasePlan(used, [{ lineId: 70, quantity: 1 }])).toMatchObject({ ok: false });
  });

  it("refuses more than a line has left, an empty choice and an unpaid booking", () => {
    expect(releasePlan(mixed, [{ lineId: 71, quantity: 3 }])).toMatchObject({ ok: false, error: "Only 2 Under 5 tickets are left on this booking." });
    expect(releasePlan(mixed, [])).toEqual({ ok: false, error: "Choose which tickets to release." });
    expect(releasePlan({ ...mixed, status: "pending" }, [{ lineId: 71, quantity: 1 }])).toMatchObject({ ok: false });
  });
});

describe("more things staff are told", () => {
  it("says a refund that failed at the bank", () => {
    expect(flagWords({ refundFailed: true })).toEqual(["Refund failed at the bank: the buyer has not been paid back. Refund again."]);
    expect(flagWords({ refundFailed: { released: false, overBy: 0 } })).toEqual(["Refund failed at the bank: the buyer has not been paid back. Refund again."]);
    expect(flagWords({ refundFailed: { released: true, overBy: 0 } })).toEqual([
      "Refund failed at the bank: the buyer has not been paid back. Their tickets were released: contact them and refund again.",
    ]);
    expect(flagWords({ refundFailed: { released: true, overBy: 3 } })).toEqual([
      "Refund failed at the bank: the buyer has not been paid back. Their tickets were released: contact them and refund again. Counting their tickets, this event is now 3 over its limit.",
    ]);
  });
});
