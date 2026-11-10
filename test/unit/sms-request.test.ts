import { describe, it, expect } from "vitest";
import { buildSnsPublishBody, isE164UkMobile, snsEndpoint } from "../../src/clients/sms-request";
import { configSchema } from "../../src/config/schema";

// 07700 900 123 is Ofcom's reserved drama range: never a real person's number.
describe("buildSnsPublishBody", () => {
  it("builds the form encoded Publish call with the sender name and the transactional type", () => {
    const body = buildSnsPublishBody({ to: "+447700900123", text: "hello", senderId: "NBCC" });
    expect(body).toContain("Action=Publish");
    expect(body).toContain("Version=2010-03-31");
    expect(body).toContain("PhoneNumber=%2B447700900123");
    expect(body).toContain("Message=hello");
    expect(body).toContain("MessageAttributes.entry.1.Name=AWS.SNS.SMS.SenderID");
    expect(body).toContain("MessageAttributes.entry.1.Value.DataType=String");
    expect(body).toContain("MessageAttributes.entry.1.Value.StringValue=NBCC");
    expect(body).toContain("MessageAttributes.entry.2.Name=AWS.SNS.SMS.SMSType");
    expect(body).toContain("MessageAttributes.entry.2.Value.StringValue=Transactional");
  });

  it("encodes spaces and punctuation in the message", () => {
    const body = buildSnsPublishBody({ to: "+447700900123", text: "a b&c", senderId: "NBCC" });
    expect(body).toContain("Message=a%20b%26c");
  });
});

describe("isE164UkMobile", () => {
  it("accepts +447 and nine digits only", () => {
    expect(isE164UkMobile("+447700900123")).toBe(true);
    expect(isE164UkMobile("07700 900 123")).toBe(false);
    expect(isE164UkMobile("07700900123")).toBe(false);
    expect(isE164UkMobile("+4477009001234")).toBe(false);
    expect(isE164UkMobile("+44770090012")).toBe(false);
  });
});

describe("snsEndpoint", () => {
  it("is the regional SNS address", () => {
    expect(snsEndpoint("eu-west-2")).toBe("https://sns.eu-west-2.amazonaws.com/");
  });
});

describe("SMS keys in the config schema", () => {
  const base = {
    DATABASE_URL: "postgres://app:app@localhost:5432/charity",
    STORIES_DATABASE_URL: "postgres://stories_app:stories@localhost:5432/stories",
    CONTACT_DATABASE_URL: "postgres://contact_app:contact@localhost:5432/contact",
    EXTERNAL_API_ONE_BASE_URL: "https://api.example/one",
    EXTERNAL_API_ONE_KEY: "k1",
    EXTERNAL_API_TWO_KEY: "k2",
    STRIPE_SECRET_KEY: "sk",
    STRIPE_PUBLISHABLE_KEY: "pk",
    STRIPE_SUCCESS_URL: "https://x.example/s",
    STRIPE_CANCEL_URL: "https://x.example/c",
    STRIPE_PRICE_BRONZE: "p",
    STRIPE_PRICE_SILVER: "p",
    STRIPE_PRICE_GOLD: "p",
    STRIPE_PRICE_PLATINUM: "p",
    STRIPE_WEBHOOK_SECRET: "whsec",
    DECLARATION_FORM_BASE_URL: "https://x.example/d",
    ADMIN_NOTIFICATION_EMAIL: "ops@nbcc.scot",
    PORTAL_BASE_URL: "https://x.example",
    BALL_BASE_URL: "https://x.example",
    BALL_PREVIEW_PASSWORD: "preview-pw",
    ADMIN_SESSION_SECRET: "s",
  };

  it("defaults to the stub, NBCC and eu-west-2", () => {
    const c = configSchema.parse(base);
    expect(c.SMS_PROVIDER).toBe("stub");
    expect(c.SMS_SENDER_ID).toBe("NBCC");
    expect(c.SMS_REGION).toBe("eu-west-2");
  });

  it("accepts NBCC and refuses a name with spaces, punctuation or too few letters", () => {
    expect(configSchema.safeParse({ ...base, SMS_SENDER_ID: "NBCC" }).success).toBe(true);
    expect(configSchema.safeParse({ ...base, SMS_SENDER_ID: "NBCC Elf!" }).success).toBe(false);
    expect(configSchema.safeParse({ ...base, SMS_SENDER_ID: "NB" }).success).toBe(false);
    expect(configSchema.safeParse({ ...base, SMS_PROVIDER: "carrier-pigeon" }).success).toBe(false);
  });
});
