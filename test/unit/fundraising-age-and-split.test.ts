import { describe, it, expect } from "vitest";
import {
  signUpSchema,
  editSchema,
  adminPatchSchema,
  splitSchema,
  splitStatement,
  OVER_18_MISSING,
  UNDER_18,
  SHARES_MISSING,
  SHARE_PERCENT_MISSING,
  SHARE_PERCENT_RANGE,
  OTHER_CAUSE_MISSING,
  OTHER_CAUSE_MAX,
} from "../../src/fundraising/model";

// Jaimie, 2026-10-03: two more questions on the sign up form, on both paths. Are you 18 or over (the
// server refuses a sign up without Yes), and are you sharing what you raise with another cause (and
// if so, NBCC's whole percentage, 1 to 99, and the other cause's name). The split makes the statement
// the Charities and Benevolent Fundraising (Scotland) Regulations 2009 ask for. Every name here,
// the other cause's included, is invented.

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
  // The sign up tidy (Jaimie, 2026-10-03): every new sign up gives an address, for the welcome pack,
  // and someone sharing ticks to say the split is right (test/unit/fundraising-signup-tidy.test.ts).
  postLine1: "1 Example Road",
  postTown: "Exampleton",
  postPostcode: "EX1 1EX",
  splitConfirmed: true,
  newsletterOk: false,
  ...over,
});

const fields = (schema: { safeParse: (b: unknown) => { success: boolean; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } }, body: unknown) => {
  const r = schema.safeParse(body);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error!.issues) out[i.path.join(".")] ??= i.message;
  return out;
};
const ok = (body: unknown) => {
  const r = signUpSchema.safeParse(body);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};

describe("18 or over", () => {
  it("is asked of everyone, with nothing taken as an answer", () => {
    const body = signUp() as Record<string, unknown>;
    delete body.over18;
    expect(fields(signUpSchema, body)).toEqual({ over18: OVER_18_MISSING });
    expect(fields(signUpSchema, signUp({ over18: "yes" }))).toEqual({ over18: OVER_18_MISSING });
    expect(fields(signUpSchema, signUp({ over18: null }))).toEqual({ over18: OVER_18_MISSING });
  });

  it("refuses a sign up from someone under 18, on either path", () => {
    expect(fields(signUpSchema, signUp({ over18: false }))).toEqual({ over18: UNDER_18 });
    expect(fields(signUpSchema, signUp({ path: "event", over18: false })).over18).toBe(UNDER_18);
  });

  it("keeps the Yes", () => {
    expect(ok(signUp()).over18).toBe(true);
  });

  it("says it kindly and plainly", () => {
    expect(OVER_18_MISSING).toBe("Tell us whether you are 18 or over.");
    // The sign up tidy (Jaimie, 2026-10-03): the same words on every form, with no example to copy.
    expect(UNDER_18).toBe(
      "You need to be 18 or over to sign up. A parent, carer or another adult you trust can do it for you and name you on the page. If you'd like to talk it through, call 01292 811 015 or email events@nbcc.scot.",
    );
  });
});

describe("sharing with another cause", () => {
  it("is asked of everyone, with nothing taken as an answer", () => {
    const body = signUp() as Record<string, unknown>;
    delete body.sharesWithOther;
    expect(fields(signUpSchema, body)).toEqual({ sharesWithOther: SHARES_MISSING });
    expect(fields(signUpSchema, signUp({ path: "event", sharesWithOther: undefined })).sharesWithOther).toBe(SHARES_MISSING);
  });

  it("needs NBCC's percentage and the other cause's name when sharing", () => {
    expect(fields(signUpSchema, signUp({ sharesWithOther: true }))).toEqual({
      nbccSharePercent: SHARE_PERCENT_MISSING,
      otherCauseName: OTHER_CAUSE_MISSING,
    });
    expect(fields(signUpSchema, signUp({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "   " }))).toEqual({
      otherCauseName: OTHER_CAUSE_MISSING,
    });
  });

  it("takes a whole percentage from 1 to 99 only", () => {
    const share = (p: unknown) => signUp({ sharesWithOther: true, nbccSharePercent: p, otherCauseName: "Kilmarnock Food Larder" });
    for (const bad of [0, 100, 50.5, -1, "fifty"]) expect(fields(signUpSchema, share(bad)).nbccSharePercent, String(bad)).toBe(SHARE_PERCENT_RANGE);
    expect(ok(share(1)).nbccSharePercent).toBe(1);
    expect(ok(share(99)).nbccSharePercent).toBe(99);
    // The form sends what was typed in the box: a whole number in words of digits is fine.
    expect(ok(share("75")).nbccSharePercent).toBe(75);
  });

  it("keeps the other cause's name to a sensible length", () => {
    const share = (n: string) => signUp({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: n });
    expect(fields(signUpSchema, share("K".repeat(OTHER_CAUSE_MAX + 1))).otherCauseName).toMatch(/120 characters/);
    expect(ok(share("  Kilmarnock Food Larder  ")).otherCauseName).toBe("Kilmarnock Food Larder");
  });

  it("keeps the split when sharing", () => {
    const d = ok(signUp({ path: "event", sharesWithOther: true, nbccSharePercent: 60, otherCauseName: "Kilmarnock Food Larder", eventDate: "2026-12-05", venue: "Example Hall", cardLine: "A quiz.", booking: "free" }));
    expect(d).toMatchObject({ sharesWithOther: true, nbccSharePercent: 60, otherCauseName: "Kilmarnock Food Larder" });
  });

  it("drops a percentage and a name sent with No", () => {
    const d = ok(signUp({ sharesWithOther: false, nbccSharePercent: 40, otherCauseName: "Kilmarnock Food Larder" }));
    expect(d).toMatchObject({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null });
  });
});

describe("the statement the 2009 regulations ask for", () => {
  it("says NBCC's share and who has the rest", () => {
    expect(splitStatement({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Kilmarnock Food Larder" })).toBe(
      "50% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Kilmarnock Food Larder.",
    );
  });

  it("does not double a full stop the name already ends with", () => {
    expect(splitStatement({ sharesWithOther: true, nbccSharePercent: 25, otherCauseName: "Exampleton Pets Ltd." })).toBe(
      "25% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Exampleton Pets Ltd.",
    );
  });

  it("is nothing when not sharing, or never asked", () => {
    expect(splitStatement({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null })).toBeNull();
    expect(splitStatement({})).toBeNull();
    expect(splitStatement({ sharesWithOther: null })).toBeNull();
  });
});

describe("the split after sign up", () => {
  it("can never be changed by the organiser", () => {
    for (const change of [{ sharesWithOther: false }, { nbccSharePercent: 80 }, { otherCauseName: "Another Cause" }, { over18: true }]) {
      expect(editSchema.safeParse(change).success, JSON.stringify(change)).toBe(false);
    }
  });

  it("is not part of staff's ordinary edit: it has a check of its own", () => {
    for (const change of [{ sharesWithOther: false }, { nbccSharePercent: 80 }, { otherCauseName: "Another Cause" }, { over18: false }]) {
      expect(adminPatchSchema.safeParse(change).success, JSON.stringify(change)).toBe(false);
    }
  });

  it("is corrected by staff with the same rules as the form", () => {
    expect(splitSchema.safeParse({ sharesWithOther: true, nbccSharePercent: 70, otherCauseName: "Kilmarnock Food Larder" }).success).toBe(true);
    expect(fields(splitSchema, { sharesWithOther: true, nbccSharePercent: 100, otherCauseName: "" })).toEqual({
      nbccSharePercent: SHARE_PERCENT_RANGE,
      otherCauseName: OTHER_CAUSE_MISSING,
    });
    expect(fields(splitSchema, {})).toEqual({ sharesWithOther: SHARES_MISSING });
    const off = splitSchema.safeParse({ sharesWithOther: false, nbccSharePercent: 70, otherCauseName: "Kilmarnock Food Larder" });
    expect(off.success && off.data).toEqual({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null });
    expect(splitSchema.safeParse({ sharesWithOther: false, slug: "x" }).success).toBe(false);
  });
});
