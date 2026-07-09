import { describe, it, expect } from "vitest";
import { storySubmissionSchema, buildStoryRecord } from "../../src/stories/schema";

// Pure, DB-free validation + mapping for POST /api/my-story (Task B1). Field names and
// enum values mirror Task A's form exactly (my-story.html `name=`/`value=` attributes),
// since both the JSON path and the native form-encoded path (booleans arrive as strings)
// share this one schema.

const validJsonPayload = () => ({
  submitterRole: "supported",
  storyText: "The Red Bag made such a difference to our Christmas this year.",
  shortQuote: "It meant the world to us.",
  useScope: "public",
  shareFirstName: true,
  shareTown: false,
  thirdPartyConsent: false,
  contactForMore: true,
  firstName: "Ada",
  email: "ada@example.com",
  phone: "07700 900000",
  town: "Ayr",
  gender: "woman",
  heardAbout: "Facebook",
  ageBand: "25_44",
  recipientType: "child",
  confirmOver16: true,
});

describe("storySubmissionSchema", () => {
  it("accepts a fully populated, valid JSON payload", () => {
    const result = storySubmissionSchema.safeParse(validJsonPayload());
    expect(result.success).toBe(true);
  });

  it("accepts a minimal payload (only the required fields)", () => {
    const result = storySubmissionSchema.safeParse({
      storyText: "A short story.",
      useScope: "internal_only",
      confirmOver16: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing storyText", () => {
    const { storyText, ...rest } = validJsonPayload();
    void storyText;
    const result = storySubmissionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an empty/whitespace-only storyText", () => {
    const result = storySubmissionSchema.safeParse({ ...validJsonPayload(), storyText: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects storyText over the length cap", () => {
    const result = storySubmissionSchema.safeParse({
      ...validJsonPayload(),
      storyText: "x".repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects shortQuote over its length cap", () => {
    const result = storySubmissionSchema.safeParse({
      ...validJsonPayload(),
      shortQuote: "x".repeat(301),
    });
    expect(result.success).toBe(false);
  });

  it("rejects confirmOver16 = false", () => {
    const result = storySubmissionSchema.safeParse({ ...validJsonPayload(), confirmOver16: false });
    expect(result.success).toBe(false);
  });

  it("rejects a missing confirmOver16", () => {
    const { confirmOver16, ...rest } = validJsonPayload();
    void confirmOver16;
    const result = storySubmissionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid useScope enum value", () => {
    const result = storySubmissionSchema.safeParse({ ...validJsonPayload(), useScope: "everywhere" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid submitterRole enum value", () => {
    const result = storySubmissionSchema.safeParse({ ...validJsonPayload(), submitterRole: "wizard" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid ageBand enum value", () => {
    const result = storySubmissionSchema.safeParse({ ...validJsonPayload(), ageBand: "12_15" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid recipientType enum value", () => {
    const result = storySubmissionSchema.safeParse({ ...validJsonPayload(), recipientType: "adult" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed email when present", () => {
    const result = storySubmissionSchema.safeParse({ ...validJsonPayload(), email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts an absent email (optional)", () => {
    const { email, ...rest } = validJsonPayload();
    void email;
    const result = storySubmissionSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  describe("form-encoded boolean coercion", () => {
    // A native (no-JS) form POST sends checked boxes as the string "on" and everything
    // else as absent; some clients may also send "true"/"false" strings.
    it("coerces 'on' to true for boolean fields", () => {
      const result = storySubmissionSchema.safeParse({
        storyText: "A story.",
        useScope: "public",
        shareFirstName: "on",
        confirmOver16: "on",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.shareFirstName).toBe(true);
        expect(result.data.confirmOver16).toBe(true);
      }
    });

    it("coerces the string 'true' to true", () => {
      const result = storySubmissionSchema.safeParse({
        storyText: "A story.",
        useScope: "public",
        confirmOver16: "true",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.confirmOver16).toBe(true);
    });

    it("coerces the string 'false' to false (still fails the confirm gate)", () => {
      const result = storySubmissionSchema.safeParse({
        storyText: "A story.",
        useScope: "public",
        confirmOver16: "false",
      });
      expect(result.success).toBe(false);
    });

    it("treats an absent checkbox field as false", () => {
      const result = storySubmissionSchema.safeParse({
        storyText: "A story.",
        useScope: "internal_only",
        confirmOver16: "on",
        // shareFirstName omitted entirely, as a real unchecked checkbox would be
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.shareFirstName).toBe(false);
    });
  });

  describe("honeypot", () => {
    it("accepts an empty honeypot field", () => {
      const result = storySubmissionSchema.safeParse({ ...validJsonPayload(), website: "" });
      expect(result.success).toBe(true);
    });

    it("still parses (does not error) when the honeypot is filled — the route decides to drop it", () => {
      const result = storySubmissionSchema.safeParse({ ...validJsonPayload(), website: "http://spam.example" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.website).toBe("http://spam.example");
    });
  });
});

// G2 item 10: a professional partner (social work, school, support service) is very
// often telling someone else's story (a child or vulnerable adult they support), so their
// submission must affirmatively confirm third-party permission — the schema is the
// authoritative backstop (also covers the no-JS path, where a native `required` cannot be
// put on the conditionally-hidden checkbox, see my-story.html's data-reveal="professional").
describe("storySubmissionSchema — professional partner third party consent (G2 item 10)", () => {
  it("rejects a professional_partner submission without thirdPartyConsent", () => {
    const result = storySubmissionSchema.safeParse({
      ...validJsonPayload(),
      submitterRole: "professional_partner",
      thirdPartyConsent: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "thirdPartyConsent")).toBe(true);
    }
  });

  it("accepts a professional_partner submission WITH thirdPartyConsent", () => {
    const result = storySubmissionSchema.safeParse({
      ...validJsonPayload(),
      submitterRole: "professional_partner",
      thirdPartyConsent: true,
    });
    expect(result.success).toBe(true);
  });

  it("does not require thirdPartyConsent for a non professional submitter role", () => {
    const result = storySubmissionSchema.safeParse({
      ...validJsonPayload(),
      submitterRole: "supported",
      thirdPartyConsent: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a professional_partner submission even when thirdPartyConsent is simply absent", () => {
    const { thirdPartyConsent, ...rest } = validJsonPayload();
    void thirdPartyConsent;
    const result = storySubmissionSchema.safeParse({ ...rest, submitterRole: "professional_partner" });
    expect(result.success).toBe(false);
  });

  it("coerces the form-encoded 'on' string for thirdPartyConsent on the professional path", () => {
    const result = storySubmissionSchema.safeParse({
      storyText: "A story about someone I support.",
      useScope: "internal_only",
      confirmOver16: "on",
      submitterRole: "professional_partner",
      thirdPartyConsent: "on",
    });
    expect(result.success).toBe(true);
  });
});

describe("buildStoryRecord", () => {
  it("maps validated input onto snake_case StoryRecord columns", () => {
    const parsed = storySubmissionSchema.parse(validJsonPayload());
    const record = buildStoryRecord(parsed);

    expect(record).toMatchObject({
      submitter_role: "supported",
      story_text: "The Red Bag made such a difference to our Christmas this year.",
      short_quote: "It meant the world to us.",
      use_scope: "public",
      consent_share_first_name: true,
      consent_share_town: false,
      third_party_consent: false,
      contact_for_more: true,
      submitter_first_name: "Ada",
      submitter_email: "ada@example.com",
      submitter_phone: "07700 900000",
      submitter_town: "Ayr",
      gender: "woman",
      heard_about: "Facebook",
      age_band: "25_44",
      recipient_type: "child",
      confirmed_over_16: true,
    });
  });

  it("applies defaults for a minimal payload", () => {
    const parsed = storySubmissionSchema.parse({
      storyText: "A short story.",
      useScope: "internal_only",
      confirmOver16: true,
    });
    const record = buildStoryRecord(parsed);

    expect(record.use_scope).toBe("internal_only");
    expect(record.consent_share_first_name).toBe(false);
    expect(record.consent_share_town).toBe(false);
    expect(record.third_party_consent).toBe(false);
    expect(record.contact_for_more).toBe(false);
    expect(record.confirmed_over_16).toBe(true);
    expect(record.submitter_role ?? null).toBeNull();
    expect(record.short_quote ?? null).toBeNull();
    expect(record.submitter_first_name ?? null).toBeNull();
    expect(record.submitter_email ?? null).toBeNull();
  });
});
