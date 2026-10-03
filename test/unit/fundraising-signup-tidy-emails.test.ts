import { describe, it, expect } from "vitest";
import { buildSignUpStaffEmail, buildSignUpThanksEmail, type StaffSummary } from "../../src/fundraising/emails";
import { buildMemoryReceiptEmail, buildTshirtAskEmail } from "../../src/fundraising/signup-tidy-emails";

// The sign up tidy's emails (Jaimie and the appropriateness audit, 2026-10-03): the thank you's
// greeting; the summary to the events inbox with the new answers, and a gentle one for a page in
// memory of someone; a short receipt for in memory (fixed words, no name); and the email staff send
// to ask for a T-shirt size. Every name here is invented.

const base: StaffSummary = {
  id: 7,
  path: "raising",
  kind: "walk",
  kindOther: null,
  title: "Sam's Walk",
  description: "Five miles for NBCC.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "",
  targetPence: 20000,
  public: true,
  name: "Sam Sample",
  firstName: "Sam",
  lastName: "Sample",
  email: "sam@example.com",
  phone: "07700 900456",
  instagram: null,
  facebook: null,
  socialLink: null,
  socialOk: true,
  over18: true,
  sharesWithOther: false,
  nbccSharePercent: null,
  otherCauseName: null,
  wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false },
  postLine1: "1 Example Road",
  postLine2: null,
  postTown: "Exampleton",
  postPostcode: "EX1 1EX",
  newsletterOk: false,
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
} as unknown as StaffSummary;

describe("the thank you for signing up", () => {
  it("says hello with a comma after Hi there", () => {
    expect(buildSignUpThanksEmail("Jo").text).toContain("Hi there, Jo,");
    expect(buildSignUpThanksEmail("").text).toContain("Hi there,");
  });
});

describe("the summary to the events inbox", () => {
  const text = (f: Partial<StaffSummary>) => buildSignUpStaffEmail({ ...base, ...f } as StaffSummary, { adminUrl: "https://nbcc.test/admin" }).text;

  it("shows the welcome pack's address, sport and the T-shirt", () => {
    const t = text({ isSporting: true, tshirtSize: "adult_m" });
    expect(t).toContain("Address for the welcome pack: 1 Example Road, Exampleton, EX1 1EX");
    expect(t).toContain("Sporting event: Yes");
    expect(t).toContain("T-shirt size: Adult M");
    expect(text({ isSporting: true, tshirtSize: null })).toContain("T-shirt size: Not given yet. Ask them from Admin > Fundraising");
    expect(text({ isSporting: false })).toContain("Sporting event: No");
  });

  it("says when the date is still to be confirmed", () => {
    expect(text({ dateTbc: true })).toContain("When: Date to be confirmed");
    expect(text({})).toContain("When: Not given");
  });

  it("shows a child, a business and when to call", () => {
    const t = text({ childFirstName: "Ella", childConsent: true, orgName: "Exampleton Bakery", employerMatch: "not_sure", callTime: "Evenings" });
    expect(t).toContain("Fundraising for their child: Ella. They ticked to say they are a parent or guardian");
    expect(t).toContain("Business, school or group: Exampleton Bakery");
    expect(t).toContain("Employer will match: Not sure yet");
    expect(t).toContain("A good time to call: Evenings");
  });

  it("says when they would rather it was kept off Get involved, from the sign up or the stored row", () => {
    expect(text({ listed: false })).toContain("On the NBCC website: Not on Get involved, only people they send the link to. It still gets a page");
    expect(text({ offListBy: "organiser", offListAt: "2026-10-03T09:00:00Z" } as Partial<StaffSummary>)).toContain(
      "On the NBCC website: Not on Get involved, only people they send the link to",
    );
    expect(text({ listed: true })).toContain("On the NBCC website: Yes, they would like it shown");
  });

  it("is gentle for a page in memory of someone", () => {
    const mail = buildSignUpStaffEmail(
      {
        ...base,
        inMemory: true,
        memoryName: "Margaret Exampleton",
        memorySetupBy: "funeral_director",
        memoryDirectorBusiness: "Exampleton Funeral Care",
        memoryFamilyContactName: "Alex Exampleton",
        memoryFamilyContactEmail: "alex@example.com",
        wants: { ...base.wants, envelopeCount: 50 },
      } as StaffSummary,
      { adminUrl: "https://nbcc.test/admin" },
    );
    expect(mail.subject).toBe("New page in memory of Margaret Exampleton");
    expect(mail.text).toContain("A NEW PAGE IN MEMORY OF MARGARET EXAMPLETON");
    expect(mail.text).toContain("No thank you email has gone to them, only a short note to say we have their details. Please give them a ring.");
    expect(mail.text).toContain("Funeral director: Exampleton Funeral Care");
    expect(mail.text).toContain("Send the names of people who gave to: Alex Exampleton, alex@example.com");
    expect(mail.text).toContain("Collection envelopes: 50");
    expect(mail.text).not.toMatch(/Exciting|Go team|!/);
    expect(mail.text).not.toContain("Address for the welcome pack");
  });
});

describe("the receipt for a page in memory of someone", () => {
  it("is short and fixed, with no name in it", () => {
    const mail = buildMemoryReceiptEmail();
    expect(mail.subject).toBe("We have your details for the page");
    expect(mail.text).toContain("We have your details for the page. Someone from NBCC will ring you in the next few days.");
    expect(mail.text).not.toMatch(/!/);
    const words = mail.html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ");
    expect(words).not.toMatch(/\bHi\b|!/);
  });
});

describe("asking for a T-shirt size", () => {
  const mail = buildTshirtAskEmail("Sam", "https://nbcc.test/fundraise/t-shirt#abc");

  it("links to the private page to choose one", () => {
    expect(mail.subject).toBe("Your NBCC T-shirt: what size would you like?");
    expect(mail.html).toContain('href="https://nbcc.test/fundraise/t-shirt#abc"');
    expect(mail.text).toContain("Choose my size: https://nbcc.test/fundraise/t-shirt#abc");
    expect(mail.text).toContain("Hi Sam,");
    expect(mail.text).toContain("If it's for a child, choose their size. The link works for 60 days.");
  });

  it("falls back to Hi there for a name it cannot use safely", () => {
    expect(buildTshirtAskEmail("<b>x</b>", "https://nbcc.test/fundraise/t-shirt#abc").text).toContain("Hi there,");
  });
});

describe("the thank you for joining a team, for someone under 18", () => {
  it("greets their parent or guardian", async () => {
    const { vi } = await import("vitest");
    vi.doMock("../../src/config", () => ({ config: { PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.scot" } }));
    vi.doMock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
    const { sendJoinEmails } = await import("../../src/fundraising/team-send");
    const sent: Array<{ kind: string; text?: string }> = [];
    const send = async (kind: string, _name: string, m: { text?: string }) => {
      sent.push({ kind, text: m.text });
    };
    const member = { id: 2, name: "Jack Sample", firstName: "Jack", email: "parent@example.com", title: "Jack's page", guardianFirstName: "Sarah", wants: {} };
    const team = { id: 1, name: "Robin Organiser", title: "Exampleton Juniors", email: "robin@example.com", slug: "ej" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendJoinEmails(member as any, team as any, send as any);
    expect(sent[0].text).toContain("Hi Sarah, this is about Jack's page.");
  });
});
