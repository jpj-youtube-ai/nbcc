import { describe, it, expect, beforeEach } from "vitest";
import { signUpSchema, UNDER_18, publicCard, meter, type FundraiserRecord } from "../../src/fundraising/model";
import { ALL_BUILT_IN_CATEGORIES, MEMORY_CATEGORIES, formCategories, memoryCategories, rememberCategories } from "../../src/fundraising/categories";
import {
  CHILD_NAME_MISSING,
  CHILD_CONSENT_MISSING,
  ORG_NAME_MISSING,
  MEMORY_BUSINESS_MISSING,
  MEMORY_GIVING_MISSING,
  ATTEND_WHEN_SOMETHING_ON,
  organisedByFor,
} from "../../src/fundraising/signup-tidy";
import { SETUP_BY, SETUP_BY_LABELS } from "../../src/fundraising/in-memory";

// The sign up form fits the person filling it in (Jaimie and the appropriateness audit,
// 2026-10-03). In memory of someone is its own path, asked only what fits; someone may raise money
// for their child; a business, school or group is named on the page; and "No" to Get involved still
// gets a page, just not on the list. Every name, place and cause here is invented.

beforeEach(() => rememberCategories(ALL_BUILT_IN_CATEGORIES));

const ADDRESS = { postLine1: "1 Example Road", postLine2: "", postTown: "Exampleton", postPostcode: "EX1 1EX" };
const WANTS = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false };

const signUp = (over: Record<string, unknown> = {}) => ({
  path: "raising",
  kind: "quiz",
  title: "Robin's Quiz",
  description: "A quiz for NBCC.",
  eventDate: "",
  startTime: "",
  venue: "",
  town: "",
  targetPence: null,
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
  wants: WANTS,
  newsletterOk: true,
  ...ADDRESS,
  ...over,
});

// The in memory path, as the form now sends it: no shout out, no come along, no newsletter.
const memorySignUp = (over: Record<string, unknown> = {}) => {
  const body: Record<string, unknown> = {
    ...signUp(),
    kind: "memory_flowers",
    title: "",
    description: "",
    inMemory: true,
    memoryName: "Margaret Exampleton",
    memorySetupBy: "family",
    memoryPermission: true,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, envelopeCount: 0 },
    newsletterOk: false,
    postLine1: "",
    postTown: "",
    postPostcode: "",
    ...over,
  };
  return body;
};

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

describe("under 18", () => {
  it("says what to do, warmly, with no example to copy", () => {
    expect(UNDER_18).toBe(
      "You need to be 18 or over to sign up. A parent, carer or another adult you trust can do it for you and name you on the page. If you'd like to talk it through, call 01292 811 015 or email events@nbcc.scot.",
    );
  });
});

describe("in memory of someone", () => {
  it("has its own ways of giving, offered only on that path", () => {
    expect(MEMORY_CATEGORIES.map((c) => c.label)).toEqual([
      "Donations instead of flowers",
      "A collection at the funeral or service",
      "A memorial walk, run or event",
    ]);
    // A to Z, as every list of categories is, with Other ("Something else" on this path) last.
    expect(memoryCategories().map((c) => c.key)).toEqual(["memory_service", "memory_event", "memory_flowers", "other"]);
    expect(formCategories().some((c) => c.key.startsWith("memory_"))).toBe(false);
  });

  it("takes a sign up with only what the path asks", () => {
    const s = ok(memorySignUp());
    expect(s.inMemory).toBe(true);
    expect(s.title).toBe("In memory of Margaret Exampleton");
    expect(s.description).toBe("");
    expect(s.wants.shoutOut).toBe(false);
    expect(s.wants.attend).toBe(false);
    expect(s.newsletterOk).toBe(false);
  });

  it("asks how people will be giving, from its own list or Something else", () => {
    expect(fields(memorySignUp({ kind: "quiz" }))).toEqual({ kind: MEMORY_GIVING_MISSING });
    expect(fields(memorySignUp({ kind: undefined }))).toEqual({ kind: MEMORY_GIVING_MISSING });
    expect(ok(memorySignUp({ kind: "other", kindOther: "A collection at the golf club" })).kind).toBe("other");
  });

  it("never offers its ways of giving to anyone else", () => {
    expect(Object.keys(fields(signUp({ kind: "memory_flowers" })))).toEqual(["kind"]);
  });

  it("keeps envelopes, and the address only when something is to be posted", () => {
    const wants = { posterCount: 2, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 30, envelopeCount: 50 };
    expect(Object.keys(fields(memorySignUp({ wants }))).sort()).toEqual(["postLine1", "postPostcode", "postTown"]);
    const s = ok(memorySignUp({ wants, ...ADDRESS }));
    expect(s.wants).toMatchObject({ envelopeCount: 50, qrCount: 30, posterCount: 2 });
    expect(s.postTown).toBe("Exampleton");
  });

  it("drops envelopes asked for on any other path", () => {
    expect(ok(signUp({ wants: { ...WANTS, envelopeCount: 40 } })).wants.envelopeCount).toBe(0);
  });

  it("takes someone else setting it up, like a colleague, club or church", () => {
    expect(SETUP_BY).toContain("someone_else");
    expect(SETUP_BY_LABELS.someone_else).toBe("Someone else, like a colleague, club or church");
    expect(ok(memorySignUp({ memorySetupBy: "someone_else" })).memorySetupBy).toBe("someone_else");
  });

  it("asks a funeral director for the business name, and keeps the family's contact if given", () => {
    expect(fields(memorySignUp({ memorySetupBy: "funeral_director" }))).toEqual({ memoryDirectorBusiness: MEMORY_BUSINESS_MISSING });
    const s = ok(
      memorySignUp({
        memorySetupBy: "funeral_director",
        memoryDirectorBusiness: "Exampleton Funeral Care",
        memoryFamilyContactName: "Alex Exampleton",
        memoryFamilyContactEmail: "alex@example.com",
      }),
    );
    expect([s.memoryDirectorBusiness, s.memoryFamilyContactName, s.memoryFamilyContactEmail]).toEqual([
      "Exampleton Funeral Care",
      "Alex Exampleton",
      "alex@example.com",
    ]);
    expect(fields(memorySignUp({ memorySetupBy: "funeral_director", memoryDirectorBusiness: "X Care", memoryFamilyContactEmail: "not an email" }))).toHaveProperty(
      "memoryFamilyContactEmail",
    );
  });

  it("keeps the business and family contact only for a funeral director", () => {
    const s = ok(memorySignUp({ memoryDirectorBusiness: "Exampleton Funeral Care", memoryFamilyContactName: "Alex" }));
    expect([s.memoryDirectorBusiness, s.memoryFamilyContactName]).toEqual([null, null]);
  });

  it("keeps a good time to call", () => {
    expect(ok(memorySignUp({ callTime: "After 2pm" })).callTime).toBe("After 2pm");
    expect(ok(memorySignUp()).callTime).toBeNull();
  });

  it("never takes a child's name or a business for the page", () => {
    const s = ok(memorySignUp({ childFundraiser: "child", childFirstName: "Ella", childConsent: true, forOrganisation: true, orgName: "Exampleton Ltd" }));
    expect([s.childFirstName, s.orgName]).toEqual([null, null]);
  });
});

describe("raising money for a child", () => {
  it("needs their first name and the parent's tick", () => {
    expect(fields(signUp({ childFundraiser: "child" }))).toEqual({ childFirstName: CHILD_NAME_MISSING, childConsent: CHILD_CONSENT_MISSING });
    const s = ok(signUp({ childFundraiser: "child", childFirstName: " Ella ", childConsent: true }));
    expect([s.childFirstName, s.childConsent]).toEqual(["Ella", true]);
  });

  it("keeps nothing for someone fundraising themselves, or from an old page", () => {
    expect(ok(signUp({ childFundraiser: "me", childFirstName: "Ella" })).childFirstName).toBeNull();
    expect(ok(signUp()).childConsent).toBeNull();
  });
});

describe("a business, school or group", () => {
  it("needs its name, and keeps whether the employer will match", () => {
    expect(fields(signUp({ forOrganisation: true }))).toEqual({ orgName: ORG_NAME_MISSING });
    const s = ok(signUp({ forOrganisation: true, orgName: "Exampleton Bakery", employerMatch: "not_sure" }));
    expect([s.orgName, s.employerMatch]).toEqual(["Exampleton Bakery", "not_sure"]);
    expect(fields(signUp({ forOrganisation: true, orgName: "Exampleton Bakery", employerMatch: "maybe" }))).toHaveProperty("employerMatch");
  });

  it("keeps nothing on a No", () => {
    const s = ok(signUp({ forOrganisation: false, orgName: "Exampleton Bakery", employerMatch: "yes" }));
    expect([s.orgName, s.employerMatch]).toEqual([null, null]);
  });
});

describe("who the page says organised it", () => {
  const rec = (over: Partial<FundraiserRecord>) => ({ name: "Robin Testperson", path: "raising", creditName: null, ...over }) as FundraiserRecord;

  it("leaves the organiser's short name to the page, as before", () => {
    expect(organisedByFor(rec({}))).toBeNull();
  });
  it("is the child's first name when it is for a child", () => {
    expect(organisedByFor(rec({ childFirstName: "Ella" }))).toBe("Ella");
  });
  it("is the business, school or group", () => {
    expect(organisedByFor(rec({ orgName: "Exampleton Primary" }))).toBe("Exampleton Primary");
    expect(organisedByFor(rec({ childFirstName: "Ella", orgName: "Exampleton Primary" }))).toBe("Ella, with Exampleton Primary");
  });
  it("is the funeral director, for the family", () => {
    expect(organisedByFor(rec({ inMemory: true, memorySetupBy: "funeral_director", memoryDirectorBusiness: "Exampleton Funeral Care" }))).toBe(
      "Exampleton Funeral Care, for the family",
    );
  });
  it("keeps an event's credit name first", () => {
    expect(organisedByFor(rec({ path: "event", creditName: "The Exampleton WI", orgName: "Exampleton WI" }))).toBe("The Exampleton WI");
  });
  it("is what the public card says", () => {
    const f = rec({ id: 1, slug: "x", kind: "quiz", title: "Quiz", description: "", wants: WANTS, orgName: "Exampleton Bakery" } as Partial<FundraiserRecord>);
    expect(publicCard(f, meter({ onlinePence: 0, cashPence: 0, targetPence: null })).organisedBy).toBe("Exampleton Bakery");
  });
});

describe("Get involved, or only people with the link", () => {
  it("keeps a page either way, and says whether to list it", () => {
    const s = ok(signUp({ listed: false }));
    expect([s.public, s.listed]).toEqual([true, false]);
    expect(ok(signUp({ listed: true })).listed).toBe(true);
  });

  it("reads an old page's answer as it always did", () => {
    const s = ok(signUp({ public: false }));
    expect([s.public, s.listed]).toEqual([false, true]);
  });
});

describe("someone from NBCC coming along", () => {
  it("is asked only when there is something to come along to", () => {
    const body = signUp({ wants: { ...WANTS, attend: undefined } });
    expect(fields(body)).toEqual({});
    expect(fields(signUp({ venue: "Example Hall", wants: { ...WANTS, attend: undefined } }))).toEqual({ "wants.attend": ATTEND_WHEN_SOMETHING_ON });
    expect(fields(signUp({ eventDate: "2026-12-05", wants: { ...WANTS, attend: undefined } }))).toEqual({ "wants.attend": ATTEND_WHEN_SOMETHING_ON });
  });
});

describe("holding an event", () => {
  const event = (over: Record<string, unknown> = {}) =>
    signUp({ path: "event", eventDate: "2026-12-05", venue: "Example Hall", cardLine: "Come along!", booking: "free", ...over });

  it("may ask for printed QR codes for its page, and give an amount it hopes to raise", () => {
    const s = ok(event({ targetPence: 30000, wants: { ...WANTS, qrCount: 20 } }));
    expect([s.wants.qrCount, s.targetPence]).toEqual([20, 30000]);
  });

  it("may be free entry with donations welcome", () => {
    expect(ok(event({ booking: "donations" })).booking).toBe("donations");
  });
});

describe("collection envelopes, as a request staff tick off", () => {
  it("are a printed request of their own, read from what they asked for", async () => {
    const { REQUEST_KINDS, KIND_INFO, parseWants } = await import("../../src/fundraising/requests");
    expect(REQUEST_KINDS).toContain("envelopes");
    expect(KIND_INFO.envelopes).toEqual({ group: "printed", label: "Collection envelopes", wantsKey: "envelopeCount" });
    expect(parseWants({ envelopeCount: 40 }).envelopeCount).toBe(40);
    expect(parseWants({}).envelopeCount).toBe(0);
  });
});
