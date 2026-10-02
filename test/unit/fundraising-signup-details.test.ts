import { describe, it, expect } from "vitest";
import {
  signUpSchema,
  adminPatchSchema,
  editSchema,
  normalisePostcode,
  wantsPosted,
  wantsLines,
  publicCard,
  meter,
  ACCESS_LABELS,
  BOOKING_LABELS,
  CARD_LINE_MAX,
  type FundraiserRecord,
} from "../../src/fundraising/model";
import { ACCESS } from "../../src/events/model";

// TASK-499: the sign up form grows: the address for posted things in separate boxes, posters,
// leaflets, buckets and tins each with their own number, and the event questions (worded like the
// admin's events editor) for someone holding an event. Every name, address and number is invented.

const NOTHING = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, shoutOut: false, attend: false };

const raising = (over: Record<string, unknown> = {}) => ({
  path: "raising",
  kind: "santa_dash",
  title: "Robin's Santa Dash",
  description: "Running round the park in a Santa suit for NBCC.",
  eventDate: "2026-12-05",
  startTime: "10:30",
  venue: "",
  town: "Exampleton",
  targetPence: 50000,
  public: true,
  name: "Robin Testperson",
  email: "robin@example.com",
  phone: "07700 900123",
  socialLink: "",
  socialOk: false,
  wants: NOTHING,
  newsletterOk: false,
  ...over,
});

const holding = (over: Record<string, unknown> = {}) =>
  raising({
    path: "event",
    kind: "quiz_party",
    title: "The Example Quiz",
    venue: "Example Village Hall",
    cardLine: "Eight rounds, a raffle and a bar, all for NBCC.",
    endTime: "22:30",
    startTime: "19:30",
    timeTbc: false,
    venueAddress: "Main Street, Exampleton. Parking behind the hall.",
    venuePostcode: "ka1 1aa",
    access: ["accessible toilets", "step free entry"],
    price: "£5 on the door",
    booking: "door",
    ticketUrl: "",
    ageLimit: "18 and over",
    dressCode: "Festive jumpers",
    included: "A hot drink and a mince pie",
    creditName: "The Example Quiz Team",
    ...over,
  });

const issuesOf = (r: ReturnType<typeof signUpSchema.safeParse>) =>
  r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));

describe("postcodes", () => {
  it.each([
    ["ka1 1aa", "KA1 1AA"],
    ["KA11AA", "KA1 1AA"],
    ["  ex1  1ex ", "EX1 1EX"],
    ["sw1a1aa", "SW1A 1AA"],
    ["m11ae", "M1 1AE"],
  ])("tidies %j to %j", (typed, tidy) => {
    expect(normalisePostcode(typed)).toBe(tidy);
  });
});

describe("what they would like posted", () => {
  const posted = (wants: Record<string, unknown>, address: Record<string, unknown> = {}) =>
    signUpSchema.safeParse(raising({ wants: { ...NOTHING, ...wants }, ...address }));
  const ADDRESS = { postLine1: "1 Example Road", postLine2: "", postTown: "Exampleton", postPostcode: "ex1 1ex" };

  it("takes posters, leaflets, buckets and tins as numbers of their own", () => {
    const r = posted({ posterCount: 10, leafletCount: 200, bucketCount: 2, tinCount: 3 }, ADDRESS);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.wants).toMatchObject({ posterCount: 10, leafletCount: 200, bucketCount: 2, tinCount: 3 });
  });

  it.each([
    ["posters", { posterCount: 1001 }, "wants.posterCount"],
    ["leaflets", { leafletCount: 1001 }, "wants.leafletCount"],
    ["buckets", { bucketCount: 21 }, "wants.bucketCount"],
    ["tins", { tinCount: 21 }, "wants.tinCount"],
    ["half a poster", { posterCount: 1.5 }, "wants.posterCount"],
    ["fewer than none", { tinCount: -1 }, "wants.tinCount"],
  ])("refuses too many %s", (_what, wants, field) => {
    const r = posted(wants, ADDRESS);
    expect(r.success).toBe(false);
    expect(Object.keys(issuesOf(r))).toContain(field);
  });

  it("needs the first line, the town and the postcode once anything is to be posted, but not line two", () => {
    for (const wants of [{ posterCount: 1 }, { leafletCount: 1 }, { bucketCount: 1 }, { tinCount: 1 }]) {
      const r = posted(wants);
      expect(Object.keys(issuesOf(r)).sort()).toEqual(["postLine1", "postPostcode", "postTown"]);
    }
    expect(posted({ tinCount: 1 }, { ...ADDRESS, postLine2: "" }).success).toBe(true);
  });

  it("checks the postcode is a UK one, and stores it tidied", () => {
    const bad = posted({ posterCount: 5 }, { ...ADDRESS, postPostcode: "12345" });
    expect(issuesOf(bad).postPostcode).toMatch(/postcode/i);
    const good = posted({ posterCount: 5 }, { ...ADDRESS, postPostcode: "ka1 1aa" });
    expect(good.success && good.data.postPostcode).toBe("KA1 1AA");
  });

  it("asks for no address, and keeps none, when nothing is to be posted", () => {
    const r = posted({ shoutOut: true }, ADDRESS);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect([r.data.postLine1, r.data.postLine2, r.data.postTown, r.data.postPostcode]).toEqual([null, null, null, null]);
  });

  it("never stores the old single address box from the form", () => {
    const r = posted({ posterCount: 5 }, { ...ADDRESS, postAddress: "Somewhere else entirely" });
    expect(r.success && "postAddress" in r.data).toBe(false);
  });

  it("says when something is to be posted, counting sign ups from before the split too", () => {
    expect(wantsPosted({ ...NOTHING, leaflets: 0, buckets: 0 })).toBe(false);
    expect(wantsPosted({ ...NOTHING, leaflets: 0, buckets: 0, tinCount: 1 })).toBe(true);
    expect(wantsPosted({ ...NOTHING, leaflets: 20, buckets: 0 })).toBe(true);
  });

  it("names each request in words, and an old combined one as it was asked for", () => {
    expect(wantsLines({ ...NOTHING, leaflets: 0, buckets: 0, posterCount: 1, leafletCount: 50, bucketCount: 2, tinCount: 1 })).toEqual([
      "1 poster",
      "50 leaflets",
      "2 collection buckets",
      "1 collection tin",
    ]);
    expect(wantsLines({ ...NOTHING, leaflets: 20, buckets: 1 })).toEqual(["20 leaflets or posters", "1 bucket or tin"]);
  });
});

describe("the event questions", () => {
  it("accepts a full event sign up and tidies it", () => {
    const r = signUpSchema.safeParse(holding());
    expect(issuesOf(r)).toEqual({});
    if (!r.success) return;
    expect(r.data).toMatchObject({
      cardLine: "Eight rounds, a raffle and a bar, all for NBCC.",
      endTime: "22:30",
      timeTbc: false,
      venueAddress: "Main Street, Exampleton. Parking behind the hall.",
      venuePostcode: "KA1 1AA",
      price: "£5 on the door",
      booking: "door",
      ticketUrl: null,
      ageLimit: "18 and over",
      dressCode: "Festive jumpers",
      included: "A hot drink and a mince pie",
      creditName: "The Example Quiz Team",
    });
    // Kept in the order the card says them, whatever order they were ticked in.
    expect(r.data.access).toEqual(["step free entry", "accessible toilets"]);
  });

  it("needs the line for the front of the card, the venue and how people get in", () => {
    const r = signUpSchema.safeParse(holding({ cardLine: "", venue: "", booking: "" }));
    expect(Object.keys(issuesOf(r)).sort()).toEqual(["booking", "cardLine", "venue"]);
  });

  it("keeps the line for the front short enough to fit the card", () => {
    expect(CARD_LINE_MAX).toBe(140);
    expect(signUpSchema.safeParse(holding({ cardLine: "a".repeat(140) })).success).toBe(true);
    expect(issuesOf(signUpSchema.safeParse(holding({ cardLine: "a".repeat(141) }))).cardLine).toMatch(/140/);
  });

  it("needs the finish to be after the start", () => {
    expect(issuesOf(signUpSchema.safeParse(holding({ startTime: "19:30", endTime: "19:00" }))).endTime).toBe(
      "The finish time is before the start.",
    );
    expect(signUpSchema.safeParse(holding({ startTime: "19:30", endTime: "19:30" })).success).toBe(false);
    expect(signUpSchema.safeParse(holding({ startTime: "", endTime: "" })).success).toBe(true);
  });

  it("takes the time is still to be confirmed", () => {
    const r = signUpSchema.safeParse(holding({ timeTbc: true }));
    expect(r.success && r.data.timeTbc).toBe(true);
  });

  it("needs a ticket link starting https:// when tickets are sold on another website", () => {
    expect(Object.keys(issuesOf(signUpSchema.safeParse(holding({ booking: "away", ticketUrl: "" }))))).toEqual(["ticketUrl"]);
    for (const bad of ["http://tickets.example.com/quiz", "javascript:alert(1)", "tickets.example.com", 'https://x.example.com/"onmouseover']) {
      expect(issuesOf(signUpSchema.safeParse(holding({ booking: "away", ticketUrl: bad }))).ticketUrl).toBe(
        "Paste the full web address, starting https://",
      );
    }
    const ok = signUpSchema.safeParse(holding({ booking: "away", ticketUrl: "https://tickets.example.com/quiz" }));
    expect(ok.success && ok.data.ticketUrl).toBe("https://tickets.example.com/quiz");
  });

  it("drops a ticket link that would never show, for the door or free", () => {
    const r = signUpSchema.safeParse(holding({ booking: "free", ticketUrl: "https://tickets.example.com/quiz" }));
    expect(r.success && r.data.ticketUrl).toBeNull();
  });

  it("takes only the access the events editor knows", () => {
    expect(signUpSchema.safeParse(holding({ access: ["a lift"] })).success).toBe(false);
    for (const a of ACCESS) expect(ACCESS_LABELS[a]).toMatch(/^[A-Z]/);
    expect(Object.values(ACCESS_LABELS)).toEqual(["Step free entry", "Accessible toilets", "Hearing loop", "Blue badge parking"]);
  });

  it("knows the three ways in, in the form's words", () => {
    expect(BOOKING_LABELS).toEqual({
      away: "Tickets are sold on another website",
      door: "Pay on the door, no booking needed",
      free: "Free, just come along",
    });
    expect(signUpSchema.safeParse(holding({ booking: "nbcc" })).success).toBe(false);
  });

  it.each([
    ["a price", { price: "a".repeat(61) }, "price"],
    ["the full address", { venueAddress: "a".repeat(301) }, "venueAddress"],
    ["what is included", { included: "a".repeat(301) }, "included"],
    ["the credit", { creditName: "a".repeat(81) }, "creditName"],
    ["the age limit", { ageLimit: "a".repeat(61) }, "ageLimit"],
    ["the dress code", { dressCode: "a".repeat(61) }, "dressCode"],
  ])("keeps %s short", (_what, over, field) => {
    expect(Object.keys(issuesOf(signUpSchema.safeParse(holding(over))))).toEqual([field]);
  });

  it("checks the venue postcode only when one is given", () => {
    expect(signUpSchema.safeParse(holding({ venuePostcode: "" })).success).toBe(true);
    expect(Object.keys(issuesOf(signUpSchema.safeParse(holding({ venuePostcode: "not one" }))))).toEqual(["venuePostcode"]);
  });

  it("ignores every event answer for someone raising money, so a page never shows them", () => {
    const r = signUpSchema.safeParse({ ...holding(), path: "raising", venue: "" });
    expect(issuesOf(r)).toEqual({});
    if (!r.success) return;
    expect(r.data).toMatchObject({
      cardLine: null,
      endTime: null,
      timeTbc: false,
      venueAddress: null,
      venuePostcode: null,
      access: [],
      price: null,
      booking: null,
      ticketUrl: null,
      ageLimit: null,
      dressCode: null,
      included: null,
      creditName: null,
    });
  });

  it("does not ask someone raising money any of the event questions", () => {
    expect(issuesOf(signUpSchema.safeParse(raising()))).toEqual({});
  });
});

describe("a staff edit of the new answers", () => {
  it("takes every new field", () => {
    const r = adminPatchSchema.safeParse({
      postLine1: "2 Example Road",
      postLine2: "Flat 1",
      postTown: "Exampleton",
      postPostcode: "ex1 1ex",
      wants: { ...NOTHING, posterCount: 4, leaflets: 0, buckets: 0 },
      cardLine: "A short line.",
      endTime: "12:00",
      timeTbc: true,
      venueAddress: "The hall, Main Street",
      venuePostcode: "ka1 1aa",
      access: ["blue badge parking"],
      price: "Free",
      booking: "away",
      ticketUrl: "https://tickets.example.com/a",
      ageLimit: "",
      dressCode: "",
      included: "",
      creditName: "Example Bakery",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.postPostcode).toBe("EX1 1EX");
    expect(r.data.venuePostcode).toBe("KA1 1AA");
    expect(r.data.ageLimit).toBeNull();
  });

  it("can clear how people get in, for a sign up from before the question", () => {
    const r = adminPatchSchema.safeParse({ booking: "" });
    expect(r.success && r.data.booking).toBeNull();
  });

  it("still edits the old single address box of an old sign up", () => {
    expect(adminPatchSchema.safeParse({ postAddress: "1 Example Street, Exampleton" }).success).toBe(true);
  });

  it.each([
    ["a ticket link that is not https", { ticketUrl: "http://tickets.example.com" }],
    ["a postcode that is not one", { postPostcode: "12345" }],
    ["a finish before the start", { startTime: "19:00", endTime: "18:00" }],
    ["an unknown way in", { booking: "maybe" }],
    ["too many tins", { wants: { ...NOTHING, tinCount: 21 } }],
  ])("refuses %s", (_what, over) => {
    expect(adminPatchSchema.safeParse(over).success).toBe(false);
  });
});

describe("an organiser's change by their manage link", () => {
  // TASK-499 leaves the manage link's fields as they were: the event details are for staff to
  // change for now (see README, "Community fundraising").
  it("still refuses the event answers", () => {
    expect(editSchema.safeParse({ price: "£6" }).success).toBe(false);
  });
});

describe("what the public sees of the new answers", () => {
  const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord => ({
    id: 7,
    slug: "the-example-quiz",
    path: "event",
    kind: "quiz_party",
    title: "The Example Quiz",
    description: "A quiz.",
    eventDate: "2026-12-05",
    startTime: "19:30",
    venue: "Example Village Hall",
    town: "Exampleton",
    targetPence: null,
    public: true,
    status: "approved",
    name: "Robin Testperson",
    email: "robin@example.com",
    phone: "07700 900123",
    socialLink: null,
    socialOk: false,
    wants: { ...NOTHING, leaflets: 0, buckets: 0 },
    postAddress: null,
    postLine1: "9 Private Road",
    postLine2: null,
    postTown: "Hometown",
    postPostcode: "EX9 9XX",
    newsletterOk: false,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2026-10-02T10:00:00.000Z",
    approvedAt: null,
    approvedBy: null,
    updatedAt: "2026-10-02T10:00:00.000Z",
    updatedBy: null,
    cardLine: "Eight rounds and a raffle.",
    endTime: "22:30",
    timeTbc: true,
    venueAddress: "Main Street",
    venuePostcode: "KA1 1AA",
    access: ["a hearing loop"],
    price: "£5",
    booking: "away",
    ticketUrl: "https://tickets.example.com/quiz",
    ageLimit: "18 and over",
    dressCode: null,
    included: null,
    creditName: "The Example Quiz Team",
    ...over,
  });
  const m = meter({ onlinePence: 0, cashPence: 0, targetPence: null });

  it("puts the event answers on the card, credited as they asked, and never the posting address", () => {
    const card = publicCard(record(), m);
    expect(card).toMatchObject({
      cardLine: "Eight rounds and a raffle.",
      endTime: "22:30",
      timeTbc: true,
      venueAddress: "Main Street",
      venuePostcode: "KA1 1AA",
      access: ["a hearing loop"],
      price: "£5",
      booking: "away",
      ticketUrl: "https://tickets.example.com/quiz",
      ageLimit: "18 and over",
      organisedBy: "The Example Quiz Team",
    });
    const text = JSON.stringify(card);
    for (const secret of ["9 Private Road", "Hometown", "EX9 9XX", "robin@example.com", "07700"]) expect(text).not.toContain(secret);
  });

  it("credits a first name and last initial when they gave no name to credit", () => {
    expect(publicCard(record({ creditName: null }), m).organisedBy).toBe("Robin T.");
  });

  it("never credits a raising money page to anyone but the organiser", () => {
    expect(publicCard(record({ path: "raising" }), m).organisedBy).toBe("Robin T.");
  });
});
