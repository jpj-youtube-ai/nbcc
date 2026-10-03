import { describe, it, expect } from "vitest";
import {
  signUpSchema,
  publicCard,
  wallEntries,
  wallMessageSchema,
  meter,
  type FundraiserRecord,
  type WallSourceRow,
} from "../../src/fundraising/model";
import {
  IN_MEMORY_NAME_MISSING,
  PERMISSION_MISSING,
  SETUP_BY_MISSING,
  SHOW_TARGET_MISSING,
  familyGifts,
  isInMemory,
  memorySetupWords,
  memoryTitle,
  memoryYearOnDue,
  publicMemory,
} from "../../src/fundraising/in-memory";
import { isQuietFundraiser } from "../../src/fundraising/touch-rules";

// In memory pages (Jaimie, 2026-10-03). On the raising money path a sign up can be in memory of
// someone: their name, optional dates, who is setting it up (family, a friend or a funeral director)
// and "I have the family's permission". The page is quieter, its target shows only if the family
// says so, every message waits for staff, and givers may ask to let the family know. Every name
// here is invented.

const signUp = (over: Record<string, unknown> = {}) => ({
  path: "raising",
  kind: "other",
  kindOther: "Collection at the funeral",
  title: "",
  description: "Margaret loved Christmas, and we would like to remember her by helping others.",
  eventDate: "",
  startTime: "",
  venue: "",
  town: "Exampleton",
  targetPence: null,
  public: true,
  firstName: "Robin",
  lastName: "Testperson",
  email: "robin@example.com",
  phone: "07700 900123",
  instagram: "",
  facebook: "",
  socialOk: false,
  over18: true,
  sharesWithOther: false,
  wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
  newsletterOk: false,
  inMemory: true,
  memoryName: "Margaret Exampleton",
  memoryDates: "1948 to 2026",
  memorySetupBy: "family",
  memoryPermission: true,
  ...over,
});

// The sign up tidy (Jaimie, 2026-10-03): every sign up that is not in memory of someone gives an
// address, for the welcome pack.
const ADDRESS = { postLine1: "1 Example Road", postTown: "Exampleton", postPostcode: "EX1 1EX" };

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

describe("signing up in memory of someone", () => {
  it("keeps who it remembers, the dates, who set it up and their permission", () => {
    const s = ok(signUp());
    expect(s.inMemory).toBe(true);
    expect(s.memoryName).toBe("Margaret Exampleton");
    expect(s.memoryDates).toBe("1948 to 2026");
    expect(s.memorySetupBy).toBe("family");
    expect(s.memoryPermission).toBe(true);
  });

  it("names the page for them when no name for it is given", () => {
    expect(ok(signUp()).title).toBe("In memory of Margaret Exampleton");
    expect(memoryTitle("  Margaret Exampleton ")).toBe("In memory of Margaret Exampleton");
    expect(ok(signUp({ title: "Margaret's Christmas Fund" })).title).toBe("Margaret's Christmas Fund");
  });

  it("still asks anyone else to give it a name", () => {
    expect(fields(signUp({ inMemory: false }))).toHaveProperty("title");
  });

  it("asks for the name, who is setting it up, and the family's permission", () => {
    const f = fields(signUp({ memoryName: "", memorySetupBy: "", memoryPermission: false }));
    expect(f.memoryName).toBe(IN_MEMORY_NAME_MISSING);
    expect(f.memorySetupBy).toBe(SETUP_BY_MISSING);
    expect(f.memoryPermission).toBe(PERMISSION_MISSING);
  });

  // The sign up tidy (Jaimie, 2026-10-03): someone else (a colleague, club or church) may set it up
  // too, and a funeral director names their business.
  it("takes only family, a friend, a funeral director or someone else as who set it up", () => {
    expect(fields(signUp({ memorySetupBy: "neighbour" })).memorySetupBy).toBe(SETUP_BY_MISSING);
    for (const who of ["family", "friend", "funeral_director", "someone_else"]) {
      expect(ok(signUp({ memorySetupBy: who, memoryDirectorBusiness: "Example Funeral Care" })).memorySetupBy).toBe(who);
    }
  });

  it("needs the permission ticked for a funeral director and a friend too", () => {
    expect(fields(signUp({ memorySetupBy: "funeral_director", memoryPermission: false })).memoryPermission).toBe(PERMISSION_MISSING);
    expect(fields(signUp({ memorySetupBy: "friend", memoryPermission: "yes" })).memoryPermission).toBe(PERMISSION_MISSING);
  });

  it("keeps the dates to 60 characters and the name to 100", () => {
    expect(fields(signUp({ memoryDates: "x".repeat(61) }))).toHaveProperty("memoryDates");
    expect(fields(signUp({ memoryName: "x".repeat(101) }))).toHaveProperty("memoryName");
    expect(ok(signUp({ memoryDates: "" })).memoryDates).toBeNull();
  });

  it("asks whether to show a target on the page when there is one, never choosing for them", () => {
    expect(fields(signUp({ targetPence: 50000 })).memoryShowTarget).toBe(SHOW_TARGET_MISSING);
    expect(ok(signUp({ targetPence: 50000, memoryShowTarget: false })).memoryShowTarget).toBe(false);
    expect(ok(signUp({ targetPence: 50000, memoryShowTarget: true })).memoryShowTarget).toBe(true);
    // No target: nothing to show, so not asked.
    expect(ok(signUp({ targetPence: null })).memoryShowTarget).toBeNull();
  });

  it("is never in memory when they say No, or when no answer is sent, and keeps none of it", () => {
    for (const answer of [false, undefined]) {
      const s = ok(signUp({ inMemory: answer, title: "Robin's Walk", ...ADDRESS }));
      expect(s.inMemory).toBe(false);
      expect(s.memoryName).toBeNull();
      expect(s.memoryDates).toBeNull();
      expect(s.memorySetupBy).toBeNull();
      expect(s.memoryPermission).toBeNull();
      expect(s.memoryShowTarget).toBeNull();
    }
  });

  it("is only for raising money: an event is never in memory", () => {
    const s = ok(
      signUp({
        path: "event",
        title: "A Quiz",
        eventDate: "2026-12-05",
        venue: "Example Hall",
        cardLine: "A quiz night.",
        booking: "free",
        ...ADDRESS,
      }),
    );
    expect(s.inMemory).toBe(false);
    expect(s.memoryName).toBeNull();
  });
});

// --- the record ----------------------------------------------------------------------------------

function record(over: Partial<FundraiserRecord> = {}): FundraiserRecord {
  return {
    id: 7,
    slug: "ime",
    path: "raising",
    kind: "other",
    kindLabel: "Other",
    title: "In memory of Margaret Exampleton",
    description: "Remembering Margaret.",
    eventDate: null,
    startTime: null,
    venue: "",
    town: "Exampleton",
    targetPence: 100000,
    public: true,
    status: "approved",
    name: "Robin Testperson",
    email: "robin@example.com",
    phone: "07700 900123",
    socialLink: null,
    socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null,
    postLine1: null,
    postLine2: null,
    postTown: null,
    postPostcode: null,
    newsletterOk: false,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2025-09-01T10:00:00.000Z",
    approvedAt: "2025-09-02T10:00:00.000Z",
    approvedBy: "admin:kim@example.com",
    updatedAt: "2025-09-02T10:00:00.000Z",
    updatedBy: null,
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
    inMemory: true,
    memoryName: "Margaret Exampleton",
    memoryDates: "1948 to 2026",
    memorySetupBy: "friend",
    memoryPermission: true,
    memoryShowTarget: false,
    memoryReminderDoneAt: null,
    ...over,
  };
}

describe("what the public sees of an in memory page", () => {
  const m = meter({ onlinePence: 25000, cashPence: 0, targetPence: 100000 });

  it("says who it remembers, and the dates", () => {
    expect(publicMemory(record())).toEqual({ name: "Margaret Exampleton", dates: "1948 to 2026", showTarget: false });
    expect(publicCard(record(), m).memory).toEqual({ name: "Margaret Exampleton", dates: "1948 to 2026", showTarget: false });
  });

  it("hides the target and how close it is, unless the family chose to show them", () => {
    const hidden = publicCard(record(), m).meter;
    expect(hidden.raisedPence).toBe(25000);
    expect(hidden.targetPence).toBeNull();
    expect(hidden.percent).toBeNull();
    expect(hidden.barPercent).toBeNull();
    const shown = publicCard(record({ memoryShowTarget: true }), m).meter;
    expect(shown.targetPence).toBe(100000);
    expect(shown.percent).toBe(25);
  });

  it("leaves every other page exactly as it was", () => {
    const card = publicCard(record({ inMemory: false, memoryName: null }), m);
    expect(card.memory ?? null).toBeNull();
    expect(card.meter.targetPence).toBe(100000);
  });

  it("knows a page in memory, and keeps every upbeat automatic email from it", () => {
    expect(isInMemory(record())).toBe(true);
    expect(isInMemory(record({ inMemory: false }))).toBe(false);
    expect(isInMemory({})).toBe(false);
    expect(isQuietFundraiser(record())).toBe(true);
    expect(isQuietFundraiser(record({ inMemory: false, kind: "santa_dash" }))).toBe(false);
  });

  it("says who set it up, with the family's permission", () => {
    expect(memorySetupWords(record({ memorySetupBy: "family" }))).toBe("A family member, with the family's permission");
    expect(memorySetupWords(record({ memorySetupBy: "friend" }))).toBe("A friend, with the family's permission");
    expect(memorySetupWords(record({ memorySetupBy: "funeral_director" }))).toBe("A funeral director, with the family's permission");
  });
});

// --- the wall, and the family's list ------------------------------------------------------------

const row = (over: Partial<WallSourceRow> = {}): WallSourceRow => ({
  donationId: 1,
  fullName: "Alex Example",
  anonymous: false,
  showName: true,
  showAmount: true,
  amountPence: 2000,
  refundedPence: 0,
  message: "Thinking of you all.",
  hidden: false,
  createdAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

describe("messages on an in memory page", () => {
  it("shows a gift whose message staff have not yet checked, without the message", () => {
    const [entry] = wallEntries([row({ held: true })]);
    expect(entry.name).toBe("Alex E.");
    expect(entry.amountPence).toBe(2000);
    expect(entry.message).toBeNull();
  });

  it("shows the message once staff have approved it", () => {
    expect(wallEntries([row({ held: false })])[0].message).toBe("Thinking of you all.");
  });

  it("lets a giver ask to let the family know, unticked unless they tick it", () => {
    const base = { sessionId: "cs_test_abc", message: "" };
    const off = wallMessageSchema.safeParse(base);
    expect(off.success && off.data.familyNotify === true).toBe(false);
    const on = wallMessageSchema.safeParse({ ...base, familyNotify: true });
    expect(on.success && on.data.familyNotify).toBe(true);
  });
});

describe("the family's list of who gave", () => {
  const rows = [
    row({ donationId: 1, familyNotify: true, fullName: "Alex Example", anonymous: true, showName: false, held: false }),
    row({ donationId: 2, familyNotify: false, fullName: "Sam Sample" }),
    row({ donationId: 3, familyNotify: true, fullName: "Jo Example", message: "Rest well.", held: true, createdAt: "2026-10-02T10:00:00.000Z" }),
    row({ donationId: 4, familyNotify: true, fullName: "Pat Example", paidIn: true }),
    row({ donationId: 5, familyNotify: true, fullName: "Lee Example", amountPence: 1000, refundedPence: 1000 }),
  ];

  it("names only those who ticked Let the family know, by the name they gave, newest first", () => {
    const list = familyGifts(rows, new Set([3]));
    expect(list.map((g) => g.donationId)).toEqual([3, 1]);
    expect(list[1].name).toBe("Alex Example");
    expect(list[0].thanked).toBe(true);
  });

  it("never carries an amount or an email, and a message only once staff have approved it", () => {
    const list = familyGifts(rows, new Set());
    for (const g of list) {
      expect(g).not.toHaveProperty("amountPence");
      expect(g).not.toHaveProperty("email");
      expect(JSON.stringify(g)).not.toMatch(/2000|20\.00/);
    }
    expect(list.find((g) => g.donationId === 3)?.message).toBeNull();
    expect(list.find((g) => g.donationId === 1)?.message).toBe("Thinking of you all.");
  });
});

describe("a year on", () => {
  it("reminds staff a year after the page went live, until someone has dealt with it", () => {
    expect(memoryYearOnDue(record({ approvedAt: "2025-10-03T09:00:00.000Z" }), "2026-10-02")).toBe(false);
    expect(memoryYearOnDue(record({ approvedAt: "2025-10-03T09:00:00.000Z" }), "2026-10-03")).toBe(true);
    expect(memoryYearOnDue(record({ approvedAt: "2025-10-03T09:00:00.000Z" }), "2027-03-01")).toBe(true);
    expect(memoryYearOnDue(record({ approvedAt: "2025-10-03T09:00:00.000Z", memoryReminderDoneAt: "2026-10-04T09:00:00.000Z" }), "2026-10-05")).toBe(false);
  });

  it("only for an in memory page that went live", () => {
    expect(memoryYearOnDue(record({ inMemory: false, approvedAt: "2024-01-01T09:00:00.000Z" }), "2026-10-03")).toBe(false);
    expect(memoryYearOnDue(record({ status: "new", approvedAt: null }), "2026-10-03")).toBe(false);
    expect(memoryYearOnDue(record({ status: "declined", approvedAt: "2024-01-01T09:00:00.000Z" }), "2026-10-03")).toBe(false);
    expect(memoryYearOnDue(record({ status: "finished", approvedAt: "2024-01-01T09:00:00.000Z" }), "2026-10-03")).toBe(true);
  });
});

describe("the smart call prompts", () => {
  it("never prompt an upbeat call about an in memory page (behind, ahead, quiet, tins, posters)", async () => {
    const { callPrompts } = await import("../../src/fundraising/call-prompts");
    const f = {
      ...record({ eventDate: "2026-10-10", targetPence: 100000, kind: "bake_sale" }),
      meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 100000 }),
    };
    const facts = { lastOnlineGiftAt: null, calls: [], sponsorFormAsked: false };
    expect(callPrompts(f, facts, "2026-10-03")).toEqual([]);
    expect(callPrompts({ ...f, inMemory: false }, facts, "2026-10-03").length).toBeGreaterThan(0);
  });
});

describe("what the admin is told about an in memory page", () => {
  it("who set it up, and whether the year on reminder is due", async () => {
    const { memoryAdminFacts } = await import("../../src/fundraising/in-memory");
    expect(memoryAdminFacts(record({ approvedAt: "2025-10-01T09:00:00.000Z" }), "2026-10-03")).toEqual({
      memorySetupWords: "A friend, with the family's permission",
      memoryYearOnDue: true,
    });
    expect(memoryAdminFacts(record({ inMemory: false }), "2026-10-03")).toEqual({});
  });
});

describe("the Monday summary", () => {
  it("lists the messages to check, and the in memory pages a year on, as things waiting", async () => {
    const { summaryCounts, summaryLines } = await import("../../src/fundraising/summary");
    const f = { ...record({ approvedAt: "2025-09-20T09:00:00.000Z" }), meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }), editWaiting: false };
    const counts = summaryCounts({ now: new Date("2026-10-05T08:00:00Z"), fundraisers: [f], gifts: [], cash: [], calls: [], invites: [], messagesToCheck: 2 });
    expect(counts.messagesToCheck).toBe(2);
    expect(counts.memoryYearOn).toBe(1);
    expect(counts.waiting).toBe(3);
    const lines = summaryLines(counts);
    expect(lines.waiting).toContain("2 messages to check on in memory pages");
    expect(lines.waiting).toContain("1 in memory page a year on: decide whether to get in touch");
  });

  it("says nothing of either when there are none", async () => {
    const { summaryCounts, summaryLines } = await import("../../src/fundraising/summary");
    const lines = summaryLines(summaryCounts({ now: new Date("2026-10-05T08:00:00Z"), fundraisers: [], gifts: [], cash: [], calls: [], invites: [] }));
    expect(lines.waiting.join(" ")).not.toMatch(/in memory/);
  });
});

describe("staff correcting the in memory details", () => {
  it("takes the name, the dates, who set it up and the target choice, never the permission", async () => {
    const { memoryEditSchema } = await import("../../src/fundraising/in-memory");
    const ok = memoryEditSchema.safeParse({ memoryName: " Margaret Exampleton ", memoryDates: "", memorySetupBy: "funeral_director", memoryShowTarget: true });
    expect(ok.success && ok.data).toEqual({ memoryName: "Margaret Exampleton", memoryDates: null, memorySetupBy: "funeral_director", memoryShowTarget: true });
    expect(memoryEditSchema.safeParse({ memoryName: "Jean", memorySetupBy: "friend", memoryShowTarget: null }).success).toBe(true);
    const bad = memoryEditSchema.safeParse({ memoryName: "", memorySetupBy: "neighbour", memoryShowTarget: "yes" });
    expect(bad.success).toBe(false);
    const msgs = bad.success ? [] : bad.error.issues.map((i) => i.path.join("."));
    expect(msgs).toEqual(expect.arrayContaining(["memoryName", "memorySetupBy", "memoryShowTarget"]));
    expect(memoryEditSchema.safeParse({ memoryName: "Jean", memorySetupBy: "friend", memoryShowTarget: false, memoryPermission: false }).success).toBe(false);
  });
});

describe("review: keeping amounts private from the family", () => {
  it("gives the family the day each gift came, never the time", () => {
    const list = familyGifts([row({ donationId: 7, familyNotify: true, createdAt: "2026-10-02T23:30:00.000Z" })], new Set());
    // 23:30 UTC on 2 October is 00:30 on 3 October in the UK.
    expect(list[0].createdAt).toBe("2026-10-03");
  });

  it("gives the public wall of an in memory page days, not times", async () => {
    const { publicPage } = await import("../../src/fundraising/model");
    const m = meter({ onlinePence: 2000, cashPence: 0, targetPence: null });
    const p = publicPage(record(), m, wallEntries([row({ createdAt: "2026-10-02T10:15:00.000Z" })]));
    expect(p.wall[0].createdAt).toBe("2026-10-02");
    const other = publicPage(record({ inMemory: false }), m, wallEntries([row({ createdAt: "2026-10-02T10:15:00.000Z" })]));
    expect(other.wall[0].createdAt).toBe("2026-10-02T10:15:00.000Z");
  });
});

describe("review: names and dates are one plain line", () => {
  it("takes out line breaks and control characters", async () => {
    const { memoryEditSchema } = await import("../../src/fundraising/in-memory");
    const s = ok(signUp({ memoryName: "Margaret\nExampleton\u0007", memoryDates: "1948\r\nto 2026" }));
    expect(s.memoryName).toBe("Margaret Exampleton");
    expect(s.memoryDates).toBe("1948 to 2026");
    const e = memoryEditSchema.safeParse({ memoryName: "Jean\tExample", memoryDates: "1950\n2026", memorySetupBy: "friend", memoryShowTarget: null });
    expect(e.success && e.data.memoryName).toBe("Jean Example");
    expect(e.success && e.data.memoryDates).toBe("1950 2026");
  });
});

describe("review: an in memory page is always just me", () => {
  it("is refused as a team, with a clear message", async () => {
    const { IN_MEMORY_NOT_TEAM } = await import("../../src/fundraising/in-memory");
    expect(fields(signUp({ team: "team" })).team).toBe(IN_MEMORY_NOT_TEAM);
    expect(fields(signUp({ team: "me" }))).toEqual({});
    expect(fields(signUp({ inMemory: false, title: "Our Walk", team: "team" })).team).toBeUndefined();
  });
});
