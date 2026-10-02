import { describe, it, expect } from "vitest";
import {
  signUpSchema,
  adminPatchSchema,
  editSchema,
  organiserNameFor,
  socialLinkFor,
  EDITABLE_FIELDS,
  MAX_QR_CODES,
  type FundraiserRecord,
} from "../../src/fundraising/model";

// TASK-511: the sign up form, round two. The name in two boxes, "Something else" said in their own
// words, Instagram and Facebook in boxes of their own, printed QR codes, and every yes or no answered
// on purpose: nothing is chosen for them, so a missing answer is asked for, never taken as No. The
// newsletter stays an unticked box they tick to opt in. Every name and handle here is invented.

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
  wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
  newsletterOk: false,
  ...over,
});

const fields = (body: unknown): Record<string, string> => {
  const r = signUpSchema.safeParse(body);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) out[i.path.join(".")] ??= i.message;
  return out;
};
const ok = (body: unknown) => {
  const r = signUpSchema.safeParse(body);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};

describe("the name, in two boxes", () => {
  it("keeps the first name and the surname, and the whole name for everything that reads it", () => {
    const d = ok(signUp({ firstName: "  Robin ", lastName: " Testperson  " }));
    expect(d).toMatchObject({ firstName: "Robin", lastName: "Testperson", name: "Robin Testperson" });
  });

  it("needs both", () => {
    expect(fields(signUp({ firstName: "" }))).toEqual({ firstName: "Please tell us your first name." });
    expect(fields(signUp({ lastName: "  " }))).toEqual({ lastName: "Please tell us your surname." });
  });

  it("no longer takes one name box on its own", () => {
    const body = signUp({ name: "Robin Testperson" }) as Record<string, unknown>;
    delete body.firstName;
    delete body.lastName;
    expect(Object.keys(fields(body)).sort()).toEqual(["firstName", "lastName"]);
  });

  it("keeps each to 50 characters", () => {
    expect(fields(signUp({ firstName: "R".repeat(51) })).firstName).toMatch(/50 characters/);
    expect(ok(signUp({ firstName: "R".repeat(50) })).firstName).toHaveLength(50);
  });
});

describe("what kind, in words that follow what they chose", () => {
  it("asks a raiser what they are doing, and an event holder what kind of event", () => {
    expect(fields(signUp({ kind: "" })).kind).toBe("Choose what you are doing to raise money.");
    expect(fields(signUp({ kind: undefined })).kind).toBe("Choose what you are doing to raise money.");
    expect(fields(signUp({ path: "event", kind: "nonsense", cardLine: "x", booking: "free", venue: "Hall" })).kind).toBe("Choose what kind of event it is.");
  });

  it("never says event or fundraise in one breath", () => {
    for (const path of ["raising", "event"]) {
      expect(fields(signUp({ path, kind: "" })).kind).not.toMatch(/event or|fundraiser or|\//);
    }
  });

  it("asks what Something else is, in up to 80 characters, worded for their path", () => {
    expect(fields(signUp({ kind: "other" })).kindOther).toBe("Tell us what you are doing, in a few words.");
    expect(fields(signUp({ path: "event", kind: "other", cardLine: "x", booking: "free", venue: "Hall" })).kindOther).toBe(
      "Tell us what kind of event it is, in a few words.",
    );
    expect(fields(signUp({ kind: "other", kindOther: "x".repeat(81) })).kindOther).toMatch(/80 characters/);
    expect(ok(signUp({ kind: "other", kindOther: "  A sponsored silence  " })).kindOther).toBe("A sponsored silence");
  });

  it("keeps what Something else is only when they chose it", () => {
    expect(ok(signUp({ kind: "santa_dash", kindOther: "A sponsored silence" })).kindOther).toBeNull();
  });
});

describe("Instagram and Facebook", () => {
  it("tidies each to a full link, and fills the old social link for anything that reads it", () => {
    const d = ok(signUp({ instagram: "@robin.bakes", facebook: "facebook.com/robinbakes" }));
    expect(d).toMatchObject({
      instagram: "https://www.instagram.com/robin.bakes",
      facebook: "https://www.facebook.com/robinbakes",
      socialLink: "https://www.facebook.com/robinbakes",
    });
    expect(ok(signUp({ instagram: "robin.bakes" })).socialLink).toBe("https://www.instagram.com/robin.bakes");
  });

  it("needs neither", () => {
    const d = ok(signUp({ instagram: "", facebook: undefined }));
    expect(d).toMatchObject({ instagram: null, facebook: null, socialLink: null });
  });

  it("puts a plain message by the box that is wrong", () => {
    expect(fields(signUp({ instagram: "https://www.facebook.com/robin" })).instagram).toMatch(/Instagram/);
    expect(fields(signUp({ facebook: "Robin Bakes" })).facebook).toMatch(/Facebook/);
  });

  it("never stores an old style link sent on its own", () => {
    expect(ok(signUp({ socialLink: "https://evil.example/" })).socialLink).toBeNull();
  });
});

describe("yes or no, answered on purpose", () => {
  it("asks whether we can post about it, with nothing chosen for them", () => {
    expect(fields(signUp({ socialOk: undefined })).socialOk).toBe("Tell us whether we can post about it on NBCC’s social media.");
    expect(fields(signUp({ socialOk: null })).socialOk).toBe("Tell us whether we can post about it on NBCC’s social media.");
    expect(ok(signUp({ socialOk: false })).socialOk).toBe(false);
  });

  it("asks about a shout out and someone coming along", () => {
    const f = fields(signUp({ wants: { posterCount: 0 } }));
    expect(f["wants.shoutOut"]).toBe("Tell us whether you would like a shout out from us.");
    expect(f["wants.attend"]).toBe("Tell us whether you would like someone from NBCC to come along.");
  });

  it("takes a shout out without permission to post, as staff ask for the OK", () => {
    const d = ok(signUp({ socialOk: false, wants: { shoutOut: true, attend: false } }));
    expect(d.wants.shoutOut).toBe(true);
    expect(d.socialOk).toBe(false);
  });

  it("asks whether to show it on the NBCC website", () => {
    expect(fields(signUp({ public: undefined })).public).toBe("Tell us whether to show it on the NBCC website.");
  });

  it("keeps the newsletter an unticked box they tick to join", () => {
    const body = signUp() as Record<string, unknown>;
    delete body.newsletterOk;
    expect(ok(body).newsletterOk).toBe(false);
  });
});

describe("printed QR codes", () => {
  it("takes from none up to 200", () => {
    expect(MAX_QR_CODES).toBe(200);
    expect(ok(signUp({ wants: { qrCount: 200, shoutOut: false, attend: false }, postLine1: "1 Example Road", postTown: "Exampleton", postPostcode: "KA1 1AA" })).wants.qrCount).toBe(200);
    expect(fields(signUp({ wants: { qrCount: 201, shoutOut: false, attend: false } }))["wants.qrCount"]).toBe("We can print up to 200 QR codes.");
    expect(fields(signUp({ wants: { qrCount: -1, shoutOut: false, attend: false } }))["wants.qrCount"]).toBe("Give a whole number, or 0 for none.");
    expect(ok(signUp({ wants: { shoutOut: false, attend: false } })).wants.qrCount).toBe(0);
  });

  it("needs an address to post them to", () => {
    expect(Object.keys(fields(signUp({ wants: { qrCount: 20, shoutOut: false, attend: false } }))).sort()).toEqual(["postLine1", "postPostcode", "postTown"]);
  });

  it("are for a page, so an event, which has none, asks for none", () => {
    const d = ok(signUp({ path: "event", kind: "quiz_party", cardLine: "A quiz.", booking: "free", venue: "Hall", wants: { qrCount: 20, shoutOut: false, attend: false } }));
    expect(d.wants.qrCount).toBe(0);
    expect(d.postLine1).toBeNull();
  });
});

describe("staff changes to the new answers", () => {
  it("take the split name, what Something else is, the two links and QR codes", () => {
    const r = adminPatchSchema.safeParse({
      firstName: "Robin",
      lastName: "Quill",
      kindOther: "A sponsored silence",
      instagram: "@robin.bakes",
      facebook: "",
      wants: { qrCount: 50 },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({ firstName: "Robin", lastName: "Quill", kindOther: "A sponsored silence", instagram: "https://www.instagram.com/robin.bakes", facebook: null });
    expect(r.data.wants?.qrCount).toBe(50);
  });

  it("refuses a first name or surname taken away, and a link that is not theirs", () => {
    const r = adminPatchSchema.safeParse({ firstName: "", facebook: "https://www.instagram.com/x" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path.join(".")).sort()).toEqual(["facebook", "firstName"]);
  });
});

describe("the whole name, kept for everything that reads it", () => {
  const before = { firstName: "Robin", lastName: "Quill", name: "Robin Quill" } as Pick<FundraiserRecord, "firstName" | "lastName" | "name">;

  it("follows a change to either part", () => {
    expect(organiserNameFor(before, { firstName: "Rob" })).toBe("Rob Quill");
    expect(organiserNameFor(before, { lastName: "Feather" })).toBe("Robin Feather");
  });

  it("is left alone when neither part changes, and for a sign up from before, which has one name", () => {
    expect(organiserNameFor(before, { title: "x" })).toBeUndefined();
    expect(organiserNameFor({ firstName: null, lastName: null, name: "Old Name" }, { name: "New Name" })).toBeUndefined();
  });
});

// Review fix: the organiser's private area changes Instagram and Facebook too (still approved by
// staff), and the old single link always follows them, so nothing reading it is ever out of step.
describe("an organiser's change to their links", () => {
  it("takes Instagram and Facebook, tidied, as things they may change", () => {
    expect(EDITABLE_FIELDS).toEqual(expect.arrayContaining(["instagram", "facebook", "socialLink"]));
    const r = editSchema.safeParse({ instagram: "@robin.bakes", facebook: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ instagram: "https://www.instagram.com/robin.bakes", facebook: null });
    const bad = editSchema.safeParse({ facebook: "https://www.instagram.com/robin" });
    expect(bad.success).toBe(false);
  });
});

describe("the old single link, kept in step", () => {
  const roundTwo = { instagram: "https://www.instagram.com/a", facebook: null, socialLink: "https://www.instagram.com/a", firstName: "Robin" };
  const before = { instagram: null, facebook: null, socialLink: "https://www.facebook.com/old.page", firstName: null };

  it("follows a change to either link: Facebook first, then Instagram", () => {
    expect(socialLinkFor(roundTwo, { facebook: "https://www.facebook.com/b" })).toBe("https://www.facebook.com/b");
    expect(socialLinkFor(roundTwo, { instagram: "https://www.instagram.com/c" })).toBe("https://www.instagram.com/c");
    expect(socialLinkFor(roundTwo, { instagram: null })).toBeNull();
  });

  it("is left alone when neither link changes", () => {
    expect(socialLinkFor(roundTwo, { title: "x" })).toBeUndefined();
  });

  it("keeps a sign up from before's one link until a new one is given", () => {
    expect(socialLinkFor(before, { instagram: null })).toBe("https://www.facebook.com/old.page");
    expect(socialLinkFor(before, { instagram: "https://www.instagram.com/n" })).toBe("https://www.instagram.com/n");
  });
});
