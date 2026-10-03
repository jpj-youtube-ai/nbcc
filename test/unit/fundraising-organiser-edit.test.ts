import { describe, it, expect } from "vitest";
import {
  EDITABLE_FIELDS,
  EVENT_ONLY_FIELDS,
  editSchema,
  checkOrganiserEdit,
  wallEntries,
  FINISH_BEFORE_START,
  type FundraiserRecord,
  type WallSourceRow,
} from "../../src/fundraising/model";

// TASK-501: from the private area an organiser may ask to change everything they could before,
// plus the event details TASK-499 added. Every change still waits for staff. The checks run on the
// MERGED result, what is stored with the change on top, so a change to one field can never leave
// another wrong. Every name and address here is invented.

const stored = (over: Partial<FundraiserRecord> = {}): FundraiserRecord =>
  ({
    id: 9,
    slug: "kims-quiz",
    path: "event",
    kind: "quiz_party",
    title: "Kim's Quiz",
    description: "A quiz night.",
    eventDate: "2099-11-14",
    startTime: "19:00",
    endTime: "22:00",
    venue: "Example Hall",
    town: "Exampleton",
    targetPence: null,
    public: true,
    status: "approved",
    cardLine: "A friendly quiz for all ages.",
    timeTbc: false,
    venueAddress: "1 Example Road",
    venuePostcode: "KA1 1AA",
    access: [],
    price: "£5",
    booking: "door",
    ticketUrl: null,
    ageLimit: null,
    dressCode: null,
    included: null,
    ...over,
  }) as FundraiserRecord;

const parse = (body: unknown) => editSchema.safeParse(body);

describe("what an organiser may ask to change", () => {
  it("is everything from before, plus the event details", () => {
    expect([...EDITABLE_FIELDS]).toEqual([
      "description",
      "targetPence",
      "eventDate",
      "startTime",
      "venue",
      "town",
      "socialLink",
      // TASK-511 review: a sign up made since the form's second round changes these instead.
      "instagram",
      "facebook",
      "cardLine",
      "endTime",
      "timeTbc",
      "venueAddress",
      "venuePostcode",
      "access",
      "price",
      "booking",
      "ticketUrl",
      "ageLimit",
      "dressCode",
      "included",
    ]);
    expect([...EVENT_ONLY_FIELDS].every((f) => (EDITABLE_FIELDS as readonly string[]).includes(f))).toBe(true);
  });

  it("takes the event details in the shape the sign up takes them", () => {
    const r = parse({
      cardLine: "  Come along!  ",
      endTime: "23:00",
      timeTbc: true,
      venuePostcode: "ka11aa",
      access: ["a hearing loop", "step free entry"],
      price: "£6",
      booking: "away",
      ticketUrl: "https://tickets.example.com/kim",
      ageLimit: "18 and over",
      dressCode: "Smart casual",
      included: "A pie",
      venueAddress: "2 Example Road",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({
      cardLine: "Come along!",
      venuePostcode: "KA1 1AA",
      access: ["step free entry", "a hearing loop"],
      booking: "away",
    });
  });

  it("refuses anything an organiser may not change, and nonsense in what they may", () => {
    expect(parse({ title: "Something else" }).success).toBe(false);
    expect(parse({ email: "x@example.com" }).success).toBe(false);
    expect(parse({ booking: "sold_by_nbcc" }).success).toBe(false);
    expect(parse({ ticketUrl: "http://not-secure.example.com" }).success).toBe(false);
    expect(parse({ access: ["a lift"] }).success).toBe(false);
    expect(parse({ venuePostcode: "not a postcode" }).success).toBe(false);
    expect(parse({ cardLine: "x".repeat(141) }).success).toBe(false);
    expect(parse({}).success).toBe(false);
  });
});

describe("the checks on the change as it would land", () => {
  const check = (s: FundraiserRecord, body: unknown) => {
    const r = parse(body);
    if (!r.success) throw new Error("did not parse");
    return checkOrganiserEdit(s, r.data);
  };

  it("takes a change that leaves everything right", () => {
    expect(check(stored(), { price: "£7" })).toEqual({ change: { price: "£7" }, fields: {} });
  });

  it("refuses a finish before the start held for it, naming the finish", () => {
    expect(check(stored(), { endTime: "18:00" }).fields).toEqual({ endTime: FINISH_BEFORE_START });
  });

  it("refuses a start after the finish held for it, naming the start", () => {
    expect(check(stored(), { startTime: "23:30" }).fields).toEqual({ startTime: FINISH_BEFORE_START });
  });

  it("takes a later start with a later finish together", () => {
    expect(check(stored(), { startTime: "23:00", endTime: "23:45" }).fields).toEqual({});
  });

  it("needs a ticket link when tickets are sold on another website", () => {
    expect(check(stored(), { booking: "away" }).fields).toEqual({
      ticketUrl: "Paste the link to where the tickets are sold, starting https://",
    });
    expect(check(stored(), { booking: "away", ticketUrl: "https://tickets.example.com/kim" }).fields).toEqual({});
  });

  it("takes a ticket link only when tickets are sold on another website", () => {
    expect(check(stored(), { ticketUrl: "https://tickets.example.com/kim" }).fields).toEqual({
      ticketUrl: "A ticket link is only for tickets sold on another website.",
    });
  });

  it("clears the ticket link held for it when tickets stop being sold on another website", () => {
    const s = stored({ booking: "away", ticketUrl: "https://tickets.example.com/kim" });
    expect(check(s, { booking: "free" })).toEqual({ change: { booking: "free", ticketUrl: null }, fields: {} });
  });

  it("keeps what an event card needs", () => {
    expect(check(stored(), { cardLine: "" }).fields).toEqual({ cardLine: "Add a line for the front of the card." });
    expect(check(stored(), { venue: "" }).fields).toEqual({ venue: "Tell us the venue." });
    expect(check(stored(), { eventDate: "" }).fields).toEqual({ eventDate: "Tell us the date of your event." });
    expect(check(stored(), { booking: null }).fields).toEqual({ booking: "Tell us how people get in." });
  });

  // The sign up tidy (after review): an event may give an amount it hopes to raise, as its sign up may.
  it("refuses event details for a page raising money, and takes a target for either", () => {
    const raising = stored({ path: "raising", booking: null, cardLine: null, endTime: null, targetPence: 25000 });
    expect(check(raising, { price: "£5" }).fields).toEqual({ price: "This is only for events." });
    expect(check(raising, { targetPence: 30000 }).fields).toEqual({});
    expect(check(stored(), { targetPence: 30000 }).fields).toEqual({});
  });

  it("does not hold a sign up from before the event questions to them, until it is changed", () => {
    const old = stored({ cardLine: null, booking: null, endTime: null, venueAddress: null, venuePostcode: null, price: null });
    expect(check(old, { description: "A new story." }).fields).toEqual({});
  });
});

describe("the wall, with money the organiser paid in", () => {
  const row = (over: Partial<WallSourceRow>): WallSourceRow => ({
    donationId: 1,
    fullName: "Alex Example",
    anonymous: false,
    showName: true,
    showAmount: true,
    amountPence: 2500,
    refundedPence: 0,
    message: "Go Kim",
    hidden: false,
    createdAt: "2026-10-02T12:00:00.000Z",
    ...over,
  });

  it("never shows a pay in, which still counts on the meter elsewhere", () => {
    const wall = wallEntries([row({}), row({ donationId: 2, fullName: "Kim Example", paidIn: true, createdAt: "2026-10-02T13:00:00.000Z" })]);
    expect(wall).toHaveLength(1);
    expect(wall[0].name).toBe("Alex E.");
  });
});
