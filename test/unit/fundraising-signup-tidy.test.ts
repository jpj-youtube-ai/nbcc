import { describe, it, expect } from "vitest";
import { signUpSchema } from "../../src/fundraising/model";
import {
  TSHIRT_SIZES,
  tshirtLabel,
  isTshirtSize,
  SPORTING_MISSING,
  TSHIRT_MISSING,
  TSHIRT_UNKNOWN,
  SPLIT_CONFIRM_MISSING,
  ADDRESS_LINE1_MISSING,
  ADDRESS_TOWN_MISSING,
  ADDRESS_POSTCODE_MISSING,
  welcomePackSchema,
  DATE_OR_TBC_MISSING,
  GUARDIAN_NAME_MISSING,
  GUARDIAN_CONSENT_MISSING,
} from "../../src/fundraising/signup-tidy";
import { greetGuardian } from "../../src/fundraising/signup-tidy-emails";
import { checkJoin, memberSignUp } from "../../src/fundraising/teams";

// The sign up tidy (Jaimie, 2026-10-03): every new sign up gives an address for the welcome pack;
// someone raising money says whether it is a sporting event, and if so their T-shirt size; and
// someone sharing with another cause ticks to say the split is right. An in memory sign up is never
// asked about sport or a T-shirt, and gives an address only when something is to be posted.
// Every name, place and cause here is invented.

const ADDRESS = { postLine1: "1 Example Road", postLine2: "", postTown: "Exampleton", postPostcode: "ex1 1ex" };

const signUp = (over: Record<string, unknown> = {}) => ({
  // The form as the sign up tidy rebuilt it says so; a page left open from before does not.
  formVersion: 2,
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
  firstName: "Robin",
  lastName: "Testperson",
  email: "robin@example.com",
  phone: "07700 900123",
  instagram: "",
  facebook: "",
  socialOk: true,
  over18: true,
  sharesWithOther: false,
  wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
  newsletterOk: false,
  ...ADDRESS,
  ...over,
});

const memory = { kind: "memory_flowers", inMemory: true, memoryName: "Margaret Exampleton", memorySetupBy: "family", memoryPermission: true, memoryShowTarget: true };
const noAddress = { postLine1: "", postLine2: "", postTown: "", postPostcode: "" };

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

describe("the T-shirt sizes", () => {
  it("are the kids' sizes, then the adults', in order", () => {
    expect(TSHIRT_SIZES.map((s) => s.label)).toEqual([
      "Kids 3 to 4", "Kids 5 to 6", "Kids 7 to 8", "Kids 9 to 10", "Kids 11 to 12", "Kids 13 to 14",
      "Adult XS", "Adult S", "Adult M", "Adult L", "Adult XL", "Adult XXL",
    ]);
    expect(TSHIRT_SIZES.map((s) => s.key)).toEqual([
      "kids_3_4", "kids_5_6", "kids_7_8", "kids_9_10", "kids_11_12", "kids_13_14",
      "adult_xs", "adult_s", "adult_m", "adult_l", "adult_xl", "adult_xxl",
    ]);
  });

  it("checks a size against the list, and names it", () => {
    expect(isTshirtSize("adult_m")).toBe(true);
    expect(isTshirtSize("adult_xxxl")).toBe(false);
    expect(isTshirtSize(null)).toBe(false);
    expect(tshirtLabel("kids_9_10")).toBe("Kids 9 to 10");
    expect(tshirtLabel(null)).toBe("");
  });
});

describe("the address for the welcome pack", () => {
  it("is needed on every new sign up, naming each box missing", () => {
    expect(fields(signUp(noAddress))).toEqual({
      postLine1: ADDRESS_LINE1_MISSING,
      postTown: ADDRESS_TOWN_MISSING,
      postPostcode: ADDRESS_POSTCODE_MISSING,
    });
    expect(fields(signUp({ ...noAddress, path: "event", eventDate: "2026-12-05", cardLine: "Come along!", venue: "Example Hall", booking: "free" }))).toMatchObject({
      postLine1: ADDRESS_LINE1_MISSING,
    });
  });

  it("is needed when the new form never sends the boxes at all", () => {
    const body = signUp() as Record<string, unknown>;
    for (const k of Object.keys(ADDRESS)) delete body[k];
    expect(Object.keys(fields(body)).sort()).toEqual(["postLine1", "postPostcode", "postTown"]);
  });

  it("checks the postcode is a UK one, and tidies it", () => {
    expect(fields(signUp({ postPostcode: "12345" })).postPostcode).toMatch(/UK postcode/);
    expect(ok(signUp()).postPostcode).toBe("EX1 1EX");
  });

  it("is kept even when nothing is to be posted, as the welcome pack is", () => {
    const s = ok(signUp());
    expect([s.postLine1, s.postLine2, s.postTown, s.postPostcode]).toEqual(["1 Example Road", null, "Exampleton", "EX1 1EX"]);
  });

  it("is not needed in memory, unless something is to be posted", () => {
    expect(fields(signUp({ ...memory, ...noAddress }))).toEqual({});
    const posted = { wants: { posterCount: 5, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false } };
    expect(Object.keys(fields(signUp({ ...memory, ...noAddress, ...posted }))).sort()).toEqual(["postLine1", "postPostcode", "postTown"]);
  });

  it("says each missing box kindly", () => {
    expect(ADDRESS_LINE1_MISSING).toBe("Please add the first line of your address, so we can post your welcome pack.");
    expect(ADDRESS_TOWN_MISSING).toBe("Please add your town.");
    expect(ADDRESS_POSTCODE_MISSING).toBe("Please add your postcode.");
  });
});

describe("is it a sporting event?", () => {
  it("keeps a No, with no t-shirt", () => {
    const s = ok(signUp({ kind: "quiz", isSporting: false, tshirtSize: "adult_m" }));
    expect(s.isSporting).toBe(false);
    expect(s.tshirtSize).toBeNull();
  });

  it("needs a T-shirt size with a Yes, and only one from the list", () => {
    expect(fields(signUp({ isSporting: true }))).toEqual({ tshirtSize: TSHIRT_MISSING });
    expect(fields(signUp({ isSporting: true, tshirtSize: "adult_xxxl" }))).toEqual({ tshirtSize: TSHIRT_UNKNOWN });
    const s = ok(signUp({ isSporting: true, tshirtSize: "kids_7_8" }));
    expect([s.isSporting, s.tshirtSize]).toEqual([true, "kids_7_8"]);
  });

  it("is not needed from an old page that never asked it", () => {
    const s = ok(signUp());
    expect([s.isSporting, s.tshirtSize]).toEqual([null, null]);
  });

  it("is never kept for an event", () => {
    const s = ok(signUp({ path: "event", cardLine: "Come along!", venue: "Example Hall", booking: "free", isSporting: true }));
    expect([s.isSporting, s.tshirtSize]).toEqual([null, null]);
  });

  it("is never asked, or needed, in memory of someone", () => {
    expect(fields(signUp({ ...memory, isSporting: true }))).toEqual({});
    const s = ok(signUp({ ...memory, isSporting: true, tshirtSize: "adult_l" }));
    expect([s.isSporting, s.tshirtSize]).toEqual([null, null]);
  });

  it("says what is missing kindly", () => {
    expect(SPORTING_MISSING).toBe("Please tell us whether it is a sporting event.");
    expect(TSHIRT_MISSING).toBe("Please choose a T-shirt size.");
  });
});

describe("checking the split", () => {
  const sharing = { sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Bank" };

  it("needs the tick to say it is right when sharing", () => {
    expect(fields(signUp(sharing))).toEqual({ splitConfirmed: SPLIT_CONFIRM_MISSING });
    expect(fields(signUp({ ...sharing, splitConfirmed: false }))).toEqual({ splitConfirmed: SPLIT_CONFIRM_MISSING });
    expect(ok(signUp({ ...sharing, splitConfirmed: true })).splitConfirmed).toBe(true);
  });

  it("is not asked when nothing is shared", () => {
    expect(ok(signUp()).splitConfirmed).toBe(false);
  });

  it("says it kindly", () => {
    expect(SPLIT_CONFIRM_MISSING).toBe("Please tick to say the split is right.");
  });
});

describe("a staff correction of sport and the t-shirt", () => {
  it("takes a Yes with a size, a Yes waiting for one, and a No", () => {
    expect(welcomePackSchema.parse({ isSporting: true, tshirtSize: "adult_s" })).toEqual({ isSporting: true, tshirtSize: "adult_s" });
    expect(welcomePackSchema.parse({ isSporting: true, tshirtSize: null })).toEqual({ isSporting: true, tshirtSize: null });
    expect(welcomePackSchema.parse({ isSporting: false, tshirtSize: "adult_s" })).toEqual({ isSporting: false, tshirtSize: null });
  });

  it("refuses a size not on the list, or no answer", () => {
    expect(welcomePackSchema.safeParse({ isSporting: true, tshirtSize: "huge" }).success).toBe(false);
    expect(welcomePackSchema.safeParse({ tshirtSize: "adult_s" }).success).toBe(false);
    expect(welcomePackSchema.safeParse({ isSporting: true, tshirtSize: "adult_s", other: 1 }).success).toBe(false);
  });
});

describe("a date not decided yet (Jaimie, 2026-10-03)", () => {
  const event = (over: Record<string, unknown> = {}) =>
    signUp({ path: "event", kind: "quiz", venue: "Example Hall", cardLine: "Come along.", booking: "free", wants: { shoutOut: false, attend: false }, ...over });

  it("lets an event sign up without a date when they tick Not decided yet", () => {
    expect(fields(event({ eventDate: "" }))).toEqual({ eventDate: DATE_OR_TBC_MISSING });
    const s = ok(event({ eventDate: "", dateTbc: true }));
    expect([s.eventDate, s.dateTbc]).toEqual([null, true]);
  });

  it("keeps the tick only while there is no date", () => {
    expect(ok(event({ dateTbc: true })).dateTbc).toBe(false);
    expect(ok(signUp({ eventDate: "", dateTbc: true })).dateTbc).toBe(true);
    expect(ok(signUp({ eventDate: "" })).dateTbc).toBe(false);
  });

  it("asks warmly", () => {
    expect(DATE_OR_TBC_MISSING).toBe("Please add the date, or tick Not decided yet.");
  });
});

describe("joining a team for someone under 18", () => {
  const team = { sharesWithOther: false, nbccSharePercent: null, otherCauseName: null, teamShareMode: null };
  const join = (over: Record<string, unknown> = {}) => ({ firstName: "Jack", lastName: "Sample", email: "parent@example.com", over18: true, why: "", ...over });

  it("needs the parent's or guardian's first name and their tick", () => {
    expect(checkJoin(join({ memberUnder18: true }), team).fields).toEqual({ guardianFirstName: GUARDIAN_NAME_MISSING, guardianConsent: GUARDIAN_CONSENT_MISSING });
    const j = checkJoin(join({ memberUnder18: true, guardianFirstName: " Sarah ", guardianConsent: true }), team).join!;
    expect([j.guardianFirstName, j.guardianConsent]).toEqual(["Sarah", true]);
  });

  it("asks nothing more of an adult, or of a page cached from before", () => {
    expect(checkJoin(join({ memberUnder18: false, guardianFirstName: "Sarah" }), team).join).toMatchObject({ guardianFirstName: null, guardianConsent: null });
    expect(checkJoin(join(), team).join).toMatchObject({ guardianFirstName: null });
  });

  it("keeps them on the member page", () => {
    const j = checkJoin(join({ memberUnder18: true, guardianFirstName: "Sarah", guardianConsent: true }), team).join!;
    const page = memberSignUp({ title: "Exampleton Juniors", kind: "santa_dash", public: true } as never, j);
    expect([page.guardianFirstName, page.childConsent]).toEqual(["Sarah", true]);
  });

  it("says what is missing kindly", () => {
    expect(GUARDIAN_NAME_MISSING).toBe("Please add your first name, as their parent or guardian.");
    expect(GUARDIAN_CONSENT_MISSING).toBe("Please tick to say you are their parent or guardian, and happy for their first name to be shown.");
  });
});

describe("greeting the parent of a child's page", () => {
  const mail = { subject: "Your page is live", html: "<p>Hi Jack,</p><p>It&#39;s live.</p>", text: "Hi Jack,\n\nIt's live." };

  it("says Hi to the parent, and whose page it is about", () => {
    const out = greetGuardian(mail, { name: "Jack Sample", firstName: "Jack", guardianFirstName: "Sarah" });
    expect(out.text).toBe("Hi Sarah, this is about Jack's page.\n\nIt's live.");
    expect(out.html).toBe("<p>Hi Sarah, this is about Jack&#39;s page.</p><p>It&#39;s live.</p>");
  });

  it("leaves every other email as it is", () => {
    expect(greetGuardian(mail, { name: "Jack Sample", firstName: "Jack", guardianFirstName: null })).toBe(mail);
    expect(greetGuardian(mail, { name: "Jack Sample" })).toBe(mail);
  });

  it("never puts markup in from a name", () => {
    const out = greetGuardian(mail, { name: "Jack Sample", firstName: "Jack", guardianFirstName: "<b>x</b>" });
    expect(out.html).not.toContain("<b>");
  });
});
