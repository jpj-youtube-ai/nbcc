import { describe, it, expect, beforeEach } from "vitest";
import { signUpSchema, publicCard, meter, checkOrganiserEdit, editSchema, type FundraiserRecord } from "../../src/fundraising/model";
import { ALL_BUILT_IN_CATEGORIES, rememberCategories } from "../../src/fundraising/categories";
import { teamMemberList } from "../../src/fundraising/teams";
import { greetGuardian } from "../../src/fundraising/signup-tidy-emails";
import { buildSignUpStaffEmail, type StaffSummary } from "../../src/fundraising/emails";
import { SPORTING_KIND_MISMATCH } from "../../src/fundraising/signup-tidy";

// The sign up tidy, after review (2026-10-03). A form left open across the deploy still sends the
// old shape: it must not be refused for questions it never showed. Funeral details stay private; a
// child on a team is shown by first name only; an event's organiser edits match the sign up; and a
// sporting answer agrees with the category. Every name here is invented.

beforeEach(() => rememberCategories(ALL_BUILT_IN_CATEGORIES));

function fields(body: unknown): Record<string, string> {
  const r = signUpSchema.safeParse(body);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) out[i.path.join(".")] ??= i.message;
  return out;
}
function ok(body: unknown) {
  const r = signUpSchema.safeParse(body);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
}

// Exactly what assets/js/fundraise.js sent before the sign up tidy (its payload(), from main).
const oldPayload = (over: Record<string, unknown> = {}) => ({
  path: "raising",
  kind: "quiz",
  kindOther: "",
  title: "Robin's Quiz",
  description: "A quiz for NBCC.",
  eventDate: "",
  startTime: "",
  venue: "",
  town: "",
  targetPence: 20000,
  public: true,
  firstName: "Robin",
  lastName: "Testperson",
  email: "robin@example.com",
  phone: "07700 900123",
  instagram: "",
  facebook: "",
  socialOk: true,
  over18: true,
  sharesWithOther: false,
  nbccSharePercent: null,
  otherCauseName: "",
  inMemory: false,
  memoryName: "",
  memoryDates: "",
  memorySetupBy: "",
  memoryPermission: false,
  memoryShowTarget: null,
  wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
  postLine1: "",
  postLine2: "",
  postTown: "",
  postPostcode: "",
  newsletterOk: false,
  cardLine: "",
  endTime: "",
  venueAddress: "",
  venuePostcode: "",
  price: "",
  ageLimit: "",
  dressCode: "",
  included: "",
  creditName: "",
  timeTbc: false,
  access: [],
  booking: "",
  ticketUrl: "",
  team: "me",
  teamShareMode: null,
  teamMembers: [],
  company: "",
  captchaToken: "",
  ...over,
});

describe("a form left open from before the deploy", () => {
  it("is taken for raising money, with no address it was never asked for", () => {
    const s = ok(oldPayload());
    expect([s.postLine1, s.isSporting, s.listed, s.public]).toEqual([null, null, true, true]);
  });

  it("is taken for an event", () => {
    const s = ok(oldPayload({ path: "event", inMemory: null, eventDate: "2026-12-05", venue: "Example Hall", cardLine: "Come along.", booking: "free", targetPence: null }));
    expect(s.path).toBe("event");
  });

  it("is taken when sharing, without the tick it never showed", () => {
    const s = ok(oldPayload({ sharesWithOther: true, nbccSharePercent: "50", otherCauseName: "Exampleton Food Bank" }));
    expect([s.sharesWithOther, s.nbccSharePercent, s.splitConfirmed]).toEqual([true, 50, false]);
  });

  it("is taken in memory of someone, with the category it offered then", () => {
    const s = ok(oldPayload({ kind: "other", kindOther: "A collection", inMemory: true, memoryName: "Margaret Exampleton", memorySetupBy: "family", memoryPermission: true, memoryShowTarget: true }));
    expect([s.inMemory, s.kind]).toEqual([true, "other"]);
    expect(ok(oldPayload({ kind: "walk", inMemory: true, memoryName: "Margaret Exampleton", memorySetupBy: "friend", memoryPermission: true, memoryShowTarget: false })).kind).toBe("walk");
  });

  it("still needs an address when it asked for something to be posted, as it always did", () => {
    expect(Object.keys(fields(oldPayload({ wants: { posterCount: 5, shoutOut: false, attend: false } }))).sort()).toEqual(["postLine1", "postPostcode", "postTown"]);
  });

  it("is told apart from the new form by its version", () => {
    expect(Object.keys(fields(oldPayload({ formVersion: 2 }))).sort()).toEqual(["postLine1", "postPostcode", "postTown"]);
    expect(fields(oldPayload({ formVersion: 2, postLine1: "1 Example Road", postTown: "Exampleton", postPostcode: "EX1 1EX", sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Bank" }))).toHaveProperty(
      "splitConfirmed",
    );
  });
});

describe("a sporting answer and the category agree", () => {
  const body = (over: Record<string, unknown>) =>
    oldPayload({ formVersion: 2, postLine1: "1 Example Road", postTown: "Exampleton", postPostcode: "EX1 1EX", ...over });

  it("refuses a sporting category for a No, and another for a Yes", () => {
    expect(fields(body({ isSporting: false, kind: "walk" }))).toEqual({ kind: SPORTING_KIND_MISMATCH });
    expect(fields(body({ isSporting: true, tshirtSize: "adult_m", kind: "quiz" }))).toEqual({ kind: SPORTING_KIND_MISMATCH });
  });

  it("takes Other for either, and a matching category", () => {
    expect(fields(body({ isSporting: true, tshirtSize: "adult_m", kind: "other", kindOther: "A swim" }))).toEqual({});
    expect(fields(body({ isSporting: true, tshirtSize: "adult_m", kind: "walk" }))).toEqual({});
    expect(fields(body({ isSporting: false, kind: "quiz" }))).toEqual({});
  });
});

const rec = (over: Partial<FundraiserRecord>) =>
  ({
    id: 1, slug: "x", path: "raising", kind: "quiz", title: "A page", description: "", name: "Jack Sample", firstName: "Jack", creditName: null,
    eventDate: "2026-12-05", startTime: "11:00", venue: "Exampleton Crematorium", town: "Exampleton",
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    access: [], status: "approved", public: true,
    ...over,
  }) as FundraiserRecord;
const m = meter({ onlinePence: 0, cashPence: 0, targetPence: null });

describe("a funeral's day and place", () => {
  it("never reach the public for a page in memory of someone", () => {
    const card = publicCard(rec({ inMemory: true, memoryName: "Margaret Exampleton", memorySetupBy: "family" }), m);
    expect([card.eventDate, card.startTime, card.venue, card.town]).toEqual([null, null, "", ""]);
  });

  it("are shown as ever for any other page", () => {
    const card = publicCard(rec({}), m);
    expect([card.eventDate, card.startTime, card.venue, card.town]).toEqual(["2026-12-05", "11:00", "Exampleton Crematorium", "Exampleton"]);
  });
});

describe("a child on a team", () => {
  it("is shown by first name only on their page", () => {
    expect(publicCard(rec({ guardianFirstName: "Sarah" }), m).organisedBy).toBe("Jack");
    expect(publicCard(rec({}), m).organisedBy).toBe("Jack S.");
  });

  it("is shown by first name only in the team's list of members", () => {
    const row = { id: 2, slug: "js", name: "Jack Sample", firstName: "Jack", status: "approved" as const, public: true, path: "raising" as const, teamLeftAt: null, meter: m };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = teamMemberList([{ ...row, guardianFirstName: "Sarah" } as any, { ...row, id: 3, slug: "as", name: "Ava Sample", firstName: "Ava" } as any]);
    expect(list.map((c) => c.name)).toEqual(["Ava S.", "Jack"]);
  });
});

describe("greeting the parent, whatever the case of the name", () => {
  it("replaces the greeting itself, not a matched name", () => {
    const mail = { html: "<p>Hi jack,</p><p>News.</p>", text: "Hi jack,\n\nNews." };
    const out = greetGuardian(mail, { name: "JACK sample", firstName: "JACK", guardianFirstName: "sarah" });
    expect(out.text).toBe("Hi Sarah, this is about Jack's page.\n\nNews.");
    expect(out.html).toBe("<p>Hi Sarah, this is about Jack&#39;s page.</p><p>News.</p>");
  });
});

describe("an organiser's change to an event", () => {
  const event = rec({ path: "event", booking: "free", cardLine: "Come along.", dateTbc: true, eventDate: null });

  it("may give an amount it hopes to raise, as the sign up may", () => {
    const change = editSchema.parse({ targetPence: 30000 });
    expect(checkOrganiserEdit(event, change).fields).toEqual({});
  });

  it("may leave the date empty while it is not decided yet, and not otherwise", () => {
    expect(checkOrganiserEdit(event, editSchema.parse({ eventDate: "" })).fields).toEqual({});
    expect(checkOrganiserEdit(rec({ path: "event", booking: "free", dateTbc: false }), editSchema.parse({ eventDate: "" })).fields).toHaveProperty("eventDate");
  });
});

describe("the summary for a page in memory of someone", () => {
  it("has no shout out or come along rows", () => {
    const mail = buildSignUpStaffEmail(
      { ...rec({ inMemory: true, memoryName: "Margaret Exampleton", memorySetupBy: "family" }), email: "a@example.com", phone: "07700 900456", socialOk: true, newsletterOk: false } as unknown as StaffSummary,
      { adminUrl: "https://nbcc.test/admin" },
    );
    expect(mail.text).not.toMatch(/shout out|come along/i);
  });
});
