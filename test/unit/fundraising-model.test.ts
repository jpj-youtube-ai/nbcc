import { describe, it, expect } from "vitest";
import { STARTING_CATEGORIES, categoryLabel } from "../../src/fundraising/categories";
import {
  signUpSchema,
  editSchema,
  adminPatchSchema,
  slugify,
  isValidSlug,
  RESERVED_SLUGS,
  meter,
  giftNetPence,
  shortName,
  wallEntries,
  publicCard,
  publicPage,
  type FundraiserRecord,
  type WallSourceRow,
} from "../../src/fundraising/model";

// TASK-493: the rules of community fundraising, kept pure so they are tested without a database.
// Every name, address and number here is invented.

const signUp = (over: Record<string, unknown> = {}) => ({
  path: "raising",
  kind: "santa_dash",
  title: "Robin's Santa Dash",
  description: "Running round the park in a Santa suit for NBCC.",
  eventDate: "2026-12-05",
  startTime: "10:30",
  venue: "Example Park",
  town: "Exampleton",
  targetPence: 50000,
  public: true,
  // TASK-511: the name in two boxes, and Facebook in a box of its own.
  firstName: "Robin",
  lastName: "Testperson",
  email: "robin@example.com",
  phone: "07700 900123",
  facebook: "https://www.facebook.com/example.page",
  socialOk: true,
  over18: true,
  sharesWithOther: false,
  wants: { leaflets: 0, buckets: 0, shoutOut: true, attend: false },
  postAddress: "",
  // The sign up tidy (Jaimie, 2026-10-03): every new sign up gives an address, for the welcome pack.
  postLine1: "1 Example Road",
  postTown: "Exampleton",
  postPostcode: "EX1 1EX",
  newsletterOk: false,
  ...over,
});

describe("the sign up form", () => {
  it("accepts a full raising money sign up and tidies it", () => {
    const r = signUpSchema.safeParse(signUp({ formVersion: 2 }));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({
      path: "raising",
      kind: "santa_dash",
      title: "Robin's Santa Dash",
      eventDate: "2026-12-05",
      startTime: "10:30",
      targetPence: 50000,
      public: true,
      name: "Robin Testperson",
      email: "robin@example.com",
      socialLink: "https://www.facebook.com/example.page",
      // The sign up tidy (Jaimie, 2026-10-03): the address is kept, for the welcome pack.
      postLine1: "1 Example Road",
      wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, envelopeCount: 0, shoutOut: true, attend: false },
    });
  });

  it("ignores the honeypot and the captcha pass rather than storing them", () => {
    const r = signUpSchema.safeParse(signUp({ company: "", captchaToken: "x" }));
    expect(r.success && "company" in r.data).toBe(false);
  });

  it("needs only the essentials: no date, place, target or link", () => {
    const r = signUpSchema.safeParse(
      signUp({ eventDate: "", startTime: "", venue: "", town: "", targetPence: null, facebook: "", wants: { shoutOut: false, attend: false } }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.eventDate).toBeNull();
    expect(r.data.startTime).toBeNull();
    expect(r.data.targetPence).toBeNull();
    expect(r.data.socialLink).toBeNull();
    expect(r.data.wants).toEqual({ posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false });
  });

  // Fundraising categories: every one on offer to start with (src/fundraising/categories.ts).
  it.each(STARTING_CATEGORIES.map((c) => c.key))("knows the kind %s, with a name for people", (kind) => {
    // TASK-511: Other says what, in a few words.
    expect(signUpSchema.safeParse(signUp({ kind, kindOther: "A sponsored silence" })).success).toBe(true);
    expect(categoryLabel(kind)).toMatch(/^[A-Z]/);
  });

  it.each([
    ["no name for it", { title: "" }],
    ["a description over 1,000 characters", { description: "a".repeat(1001) }],
    ["an unknown kind", { kind: "skydive" }],
    ["an unknown path", { path: "both" }],
    ["a target under £10", { targetPence: 999 }],
    ["a target over £100,000", { targetPence: 10000001 }],
    ["a target in fractions of a penny", { targetPence: 1000.5 }],
    ["no phone number", { phone: "" }],
    ["a phone number that is not one", { phone: "call me" }],
    ["a bad email", { email: "robin.example.com" }],
    ["a date that is not a date", { eventDate: "2026-02-30" }],
    ["a time that is not a time", { startTime: "25:00" }],
    ["a link that is not a web address", { facebook: "javascript:alert(1)" }],
    ["more leaflets than we could post", { wants: { leaflets: 5000, buckets: 0, shoutOut: false, attend: false } }],
  ])("refuses %s", (_what, over) => {
    expect(signUpSchema.safeParse(signUp(over)).success).toBe(false);
  });

  // TASK-499: the address is now separate boxes (test/unit/fundraising-signup-details.test.ts).
  // The sign up tidy (Jaimie, 2026-10-03): every new sign up gives one, for the welcome pack, whether
  // or not anything else is to be posted.
  it("asks for an address, with or without leaflets or buckets", () => {
    const wants = { leaflets: 20, buckets: 1, shoutOut: false, attend: false };
    const noAddress = { postLine1: "", postTown: "", postPostcode: "" };
    // The new form says so (formVersion 2); a page left open from before is only asked when posting.
    const without = signUpSchema.safeParse(signUp({ wants, ...noAddress }));
    expect(without.success).toBe(false);
    if (!without.success) expect(without.error.issues.map((i) => i.path[0])).toEqual(["postLine1", "postTown", "postPostcode"]);
    const address = { postLine1: "1 Example Street", postTown: "Exampleton", postPostcode: "EX1 1EX" };
    expect(signUpSchema.safeParse(signUp({ wants, ...address })).success).toBe(true);
    const nothingPosted = signUpSchema.safeParse(signUp({ ...noAddress, formVersion: 2 }));
    expect(nothingPosted.success).toBe(false);
    expect(signUpSchema.safeParse(signUp(noAddress)).success).toBe(true);
    if (!nothingPosted.success) expect(nothingPosted.error.issues.map((i) => i.path[0])).toEqual(["postLine1", "postTown", "postPostcode"]);
  });

  // The sign up tidy (Jaimie, 2026-10-03): an event page has a meter now, so an event keeps its target.
  it("asks for the date when someone is holding an event, and keeps a target for one", () => {
    expect(signUpSchema.safeParse(signUp({ path: "event", eventDate: "" })).success).toBe(false);
    const event = { cardLine: "Cakes for NBCC.", booking: "free" }; // TASK-499: asked of every event
    const r = signUpSchema.safeParse(signUp({ path: "event", kind: "bake_sale_2", targetPence: 50000, ...event }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.targetPence).toBe(50000);
  });

  it("speaks plainly when it refuses, without dashes", () => {
    const r = signUpSchema.safeParse(signUp({ phone: "" }));
    expect(r.success).toBe(false);
    if (!r.success) {
      for (const issue of r.error.issues) expect(issue.message).not.toMatch(/[–—]| - /);
    }
  });
});

describe("an organiser's change, sent by their manage link", () => {
  it("takes only the fields an organiser may change", () => {
    const r = editSchema.safeParse({ description: "Now with reindeer.", targetPence: 75000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ description: "Now with reindeer.", targetPence: 75000 });
  });

  it("refuses anything else, like the title, the slug or the status", () => {
    expect(editSchema.safeParse({ title: "Something else" }).success).toBe(false);
    expect(editSchema.safeParse({ slug: "elsewhere" }).success).toBe(false);
    expect(editSchema.safeParse({ status: "approved" }).success).toBe(false);
  });

  it("refuses an empty change", () => {
    expect(editSchema.safeParse({}).success).toBe(false);
  });

  it("lets a target, date, time or link be cleared", () => {
    const r = editSchema.safeParse({ targetPence: null, eventDate: "", startTime: "", socialLink: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ targetPence: null, eventDate: null, startTime: null, socialLink: null });
  });
});

describe("a staff edit", () => {
  it("takes any field, including the slug and an uploaded picture", () => {
    const r = adminPatchSchema.safeParse({
      title: "Robin's Big Santa Dash",
      slug: "robins-big-santa-dash",
      imageSrc: "/media/events/0f8fad5b-d9cb-469f-a165-70867728950e",
      public: false,
    });
    expect(r.success).toBe(true);
  });

  it("refuses a picture from another website, a bad slug, and the status", () => {
    expect(adminPatchSchema.safeParse({ imageSrc: "https://elsewhere.example/a.jpg" }).success).toBe(false);
    expect(adminPatchSchema.safeParse({ slug: "Not A Slug" }).success).toBe(false);
    expect(adminPatchSchema.safeParse({ status: "approved" }).success).toBe(false);
  });

  it("clears a picture with an empty string", () => {
    const r = adminPatchSchema.safeParse({ imageSrc: "" });
    expect(r.success && r.data.imageSrc).toBeNull();
  });
});

describe("slugs", () => {
  it("are made from the name, plain and short", () => {
    expect(slugify("Robin's Santa Dash!")).toBe("robins-santa-dash");
    expect(slugify("Café Morning in Ayr")).toBe("cafe-morning-in-ayr");
    expect(slugify("!!!")).toBe("fundraiser");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(60);
  });

  it("are checked when staff type one", () => {
    expect(isValidSlug("robins-santa-dash-2")).toBe(true);
    expect(isValidSlug("-robin")).toBe(false);
    expect(isValidSlug("robin--dash")).toBe(false);
    expect(isValidSlug("Robin")).toBe(false);
    expect(isValidSlug("a".repeat(61))).toBe(false);
    // An address the site already uses for its own pages.
    expect(isValidSlug("manage")).toBe(false);
    // TASK-498: the help page at /fundraise/help.
    expect(isValidSlug("help")).toBe(false);
  });

  // TASK-498: a sign up called "Help" or "Manage" is given help-2 or manage-2 when it is made
  // (freeSlug in src/db/fundraisers.ts treats every reserved slug as taken), so neither page is ever
  // hidden behind a fundraiser.
  it("never take the addresses of the site's own fundraising pages", () => {
    // TASK-504: the logo pack and the blank sponsor form too.
    // The sign up tidy (Jaimie, 2026-10-03): "t-shirt" is the page to choose a t-shirt size.
    expect([...RESERVED_SLUGS].sort()).toEqual(["help", "logos", "manage", "sponsor-form", "t-shirt"]);
    for (const reserved of RESERVED_SLUGS) expect(slugify(reserved)).toBe(reserved);
  });
});

describe("the meter", () => {
  it("adds paid online gifts and cash", () => {
    expect(meter({ onlinePence: 12000, cashPence: 3000, targetPence: 50000 })).toEqual({
      raisedPence: 15000,
      onlinePence: 12000,
      cashPence: 3000,
      giftAidPence: 0,
      targetPence: 50000,
      percent: 30,
      barPercent: 30,
      overTarget: false,
    });
  });

  it("can pass 100%, with the bar full", () => {
    const m = meter({ onlinePence: 60000, cashPence: 15000, targetPence: 50000 });
    expect(m.percent).toBe(150);
    expect(m.barPercent).toBe(100);
    expect(m.overTarget).toBe(true);
  });

  it("shows only the amount when there is no target", () => {
    const m = meter({ onlinePence: 2500, cashPence: 0, targetPence: null });
    expect(m).toMatchObject({ raisedPence: 2500, targetPence: null, percent: null, barPercent: null, overTarget: false });
  });

  it("rounds the percentage down, so 99.9% never reads as 100%", () => {
    expect(meter({ onlinePence: 49950, cashPence: 0, targetPence: 50000 }).percent).toBe(99);
  });

  it("takes refunds off a gift, and never below nothing", () => {
    expect(giftNetPence(5000, 0)).toBe(5000);
    expect(giftNetPence(5000, 2000)).toBe(3000);
    expect(giftNetPence(5000, 9000)).toBe(0);
  });
});

describe("names on the page", () => {
  it("are a first name and a last initial", () => {
    expect(shortName("Robin Testperson")).toBe("Robin T.");
    expect(shortName("  mary jane  smith ")).toBe("Mary S.");
    expect(shortName("Cher")).toBe("Cher");
    expect(shortName("")).toBe("Anonymous");
  });
});

describe("the supporter wall", () => {
  const row = (over: Partial<WallSourceRow> = {}): WallSourceRow => ({
    donationId: 1,
    fullName: "Alex Example",
    anonymous: false,
    showName: true,
    showAmount: true,
    amountPence: 2000,
    refundedPence: 0,
    message: "Go Robin!",
    hidden: false,
    createdAt: "2026-10-02T10:00:00.000Z",
    ...over,
  });

  it("shows newest first, with the name, the amount and the message", () => {
    const wall = wallEntries([
      row({ donationId: 1, createdAt: "2026-10-01T10:00:00.000Z" }),
      row({ donationId: 2, createdAt: "2026-10-02T10:00:00.000Z", fullName: "Sam Sample" }),
    ]);
    expect(wall).toEqual([
      { name: "Sam S.", amountPence: 2000, giftAidPence: null, message: "Go Robin!", createdAt: "2026-10-02T10:00:00.000Z" },
      { name: "Alex E.", amountPence: 2000, giftAidPence: null, message: "Go Robin!", createdAt: "2026-10-01T10:00:00.000Z" },
    ]);
  });

  it("says Anonymous when they asked, or when they gave anonymously", () => {
    expect(wallEntries([row({ showName: false })])[0].name).toBe("Anonymous");
    expect(wallEntries([row({ anonymous: true })])[0].name).toBe("Anonymous");
  });

  it("leaves the amount off when they asked", () => {
    expect(wallEntries([row({ showAmount: false })])[0].amountPence).toBeNull();
  });

  // Staff hide the MESSAGE; the gift itself, with its name and amount rules, stays on the wall.
  it("never shows a hidden message, but keeps the gift on the wall", () => {
    expect(wallEntries([row({ hidden: true })])).toEqual([
      { name: "Alex E.", amountPence: 2000, giftAidPence: null, message: null, createdAt: "2026-10-02T10:00:00.000Z" },
    ]);
  });

  it("never shows a gift refunded in full", () => {
    expect(wallEntries([row({ refundedPence: 2000 })])).toEqual([]);
  });

  // A donor whose details were redacted at the end of the retention period (src/db/admin.ts).
  it("shows a redacted giver as Anonymous", () => {
    expect(wallEntries([row({ fullName: "Redacted" })])[0].name).toBe("Anonymous");
  });

  it("shows what is left of a part refunded gift, and no blank message", () => {
    expect(wallEntries([row({ refundedPence: 500, message: "  " })])[0]).toMatchObject({ amountPence: 1500, message: null });
  });
});

describe("what the public sees", () => {
  const record: FundraiserRecord = {
    id: 7,
    slug: "robins-santa-dash",
    path: "raising",
    kind: "santa_dash",
    title: "Robin's Santa Dash",
    description: "Running round the park.",
    eventDate: "2026-12-05",
    startTime: "10:30",
    venue: "Example Park",
    town: "Exampleton",
    targetPence: 50000,
    public: true,
    status: "approved",
    name: "Robin Testperson",
    email: "robin@example.com",
    phone: "07700 900123",
    socialLink: "https://www.facebook.com/example.page",
    socialOk: true,
    over18: true,
    sharesWithOther: false,
    wants: { leaflets: 10, buckets: 1, shoutOut: true, attend: true },
    postAddress: "1 Example Street",
    newsletterOk: true,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2026-10-02T10:00:00.000Z",
    approvedAt: "2026-10-02T11:00:00.000Z",
    approvedBy: "admin:someone@example.com",
    updatedAt: "2026-10-02T11:00:00.000Z",
    updatedBy: "admin:someone@example.com",
  };
  const m = meter({ onlinePence: 1000, cashPence: 0, targetPence: 50000 });

  it("is a card with the meter and the organiser's short name, and nothing private", () => {
    const card = publicCard(record, m);
    expect(card).toMatchObject({
      id: 7,
      slug: "robins-santa-dash",
      path: "raising",
      kindLabel: "Santa dash",
      organisedBy: "Robin T.",
      url: "/fundraise/robins-santa-dash",
      meter: m,
    });
    const text = JSON.stringify(card);
    for (const secret of ["robin@example.com", "07700", "1 Example Street", "Testperson", "admin:"]) {
      expect(text).not.toContain(secret);
    }
  });

  // Event pages: an event sign up has a page of its own now, at /event/<short name>.
  it("gives an event sign up its own page, at /event/", () => {
    expect(publicCard({ ...record, path: "event" }, m).url).toBe(`/event/${record.slug}`);
  });

  it("is a page with the wall and what the give form needs", () => {
    const page = publicPage(record, m, []);
    expect(page.wall).toEqual([]);
    expect(page.giving).toEqual({ fundraiserId: 7, minimumPence: 200 });
    expect(JSON.stringify(page)).not.toContain("robin@example.com");
  });
});
