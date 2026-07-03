import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema";

// A fully-populated, valid env: every REQUIRED key present. Individual tests
// clone this and drop or break one key to prove it is required/validated.
const validEnv = (): Record<string, string> => ({
  DATABASE_URL: "postgres://app:app@localhost:5432/charity",
  EXTERNAL_API_ONE_BASE_URL: "https://sandbox.api-one.example",
  EXTERNAL_API_ONE_KEY: "k",
  EXTERNAL_API_TWO_KEY: "k",
  // Stripe checkout (TASK-037, REQ-028/REQ-029).
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SUCCESS_URL: "https://example.org/donate/thank-you",
  STRIPE_CANCEL_URL: "https://example.org/donate",
  STRIPE_PRICE_BRONZE: "price_bronze",
  STRIPE_PRICE_SILVER: "price_silver",
  STRIPE_PRICE_GOLD: "price_gold",
  STRIPE_PRICE_PLATINUM: "price_platinum",
  // Stripe webhook signing secret (TASK-046, REQ-036).
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  // Contact forwarding (TASK-039, REQ-030).
  CONTACT_FORWARD_URL: "https://formspree.io/f/test",
  EMAIL_SEND_URL: "https://email.example/send",
  DECLARATION_FORM_BASE_URL: "https://nbcc.example",
  ADMIN_NOTIFICATION_EMAIL: "admin@nbcc.example",
  PORTAL_BASE_URL: "https://nbcc.example",
});

describe("config schema", () => {
  it("rejects an env that is missing DATABASE_URL", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a fully populated env", () => {
    const result = configSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
  });
});

describe("config schema — Stripe checkout keys (REQ-028/REQ-029)", () => {
  const REQUIRED = [
    "STRIPE_SECRET_KEY",
    "STRIPE_SUCCESS_URL",
    "STRIPE_CANCEL_URL",
    "STRIPE_PRICE_BRONZE",
    "STRIPE_PRICE_SILVER",
    "STRIPE_PRICE_GOLD",
    "STRIPE_PRICE_PLATINUM",
    "STRIPE_WEBHOOK_SECRET",
  ];

  it.each(REQUIRED)("requires %s", (key) => {
    const env = validEnv();
    delete env[key];
    expect(configSchema.safeParse(env).success).toBe(false);
  });

  it("rejects an empty STRIPE_SECRET_KEY (a secret must be non-empty)", () => {
    expect(configSchema.safeParse({ ...validEnv(), STRIPE_SECRET_KEY: "" }).success).toBe(false);
  });

  it.each(["STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL"])("validates %s as a URL", (key) => {
    expect(configSchema.safeParse({ ...validEnv(), [key]: "not-a-url" }).success).toBe(false);
  });
});

describe("config schema — contact forwarding key (REQ-030)", () => {
  it("requires CONTACT_FORWARD_URL", () => {
    const env = validEnv();
    delete env.CONTACT_FORWARD_URL;
    expect(configSchema.safeParse(env).success).toBe(false);
  });

  it("validates CONTACT_FORWARD_URL as a URL", () => {
    expect(configSchema.safeParse({ ...validEnv(), CONTACT_FORWARD_URL: "not-a-url" }).success).toBe(
      false,
    );
  });

  it("requires ADMIN_NOTIFICATION_EMAIL and validates it as an email (TASK-092)", () => {
    const { ADMIN_NOTIFICATION_EMAIL, ...without } = validEnv();
    void ADMIN_NOTIFICATION_EMAIL;
    expect(configSchema.safeParse(without).success).toBe(false); // required
    expect(configSchema.safeParse({ ...validEnv(), ADMIN_NOTIFICATION_EMAIL: "not-an-email" }).success).toBe(false);
  });

  it("requires PORTAL_BASE_URL and validates it as a URL (TASK-100)", () => {
    const { PORTAL_BASE_URL, ...without } = validEnv();
    void PORTAL_BASE_URL;
    expect(configSchema.safeParse(without).success).toBe(false); // required
    expect(configSchema.safeParse({ ...validEnv(), PORTAL_BASE_URL: "not-a-url" }).success).toBe(false);
  });

  it("treats STRIPE_DONATION_PRODUCT as optional", () => {
    // absent is fine (validEnv omits it)...
    expect(configSchema.safeParse(validEnv()).success).toBe(true);
    // ...and a prod_ id is accepted when present.
    expect(
      configSchema.safeParse({ ...validEnv(), STRIPE_DONATION_PRODUCT: "prod_abc123" }).success,
    ).toBe(true);
  });

  it("parses the Stripe values onto the typed config", () => {
    const parsed = configSchema.safeParse(validEnv());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.STRIPE_SECRET_KEY).toBe("sk_test_123");
      expect(parsed.data.STRIPE_SUCCESS_URL).toBe("https://example.org/donate/thank-you");
      expect(parsed.data.STRIPE_PRICE_GOLD).toBe("price_gold");
    }
  });
});
