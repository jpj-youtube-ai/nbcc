import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema";

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
  CONTACT_FORWARD_URL: "https://forms.example/x",
  EMAIL_SEND_URL: "https://email.example/send",
  DECLARATION_FORM_BASE_URL: "https://x.example/d",
  ADMIN_NOTIFICATION_EMAIL: "ops@nbcc.scot",
  PORTAL_BASE_URL: "https://x.example",
  ADMIN_SESSION_SECRET: "s",
};

describe("CONTACT_DATABASE_URL config", () => {
  it("parses when present and a valid URL", () => {
    const parsed = configSchema.parse(base);
    expect(parsed.CONTACT_DATABASE_URL).toBe(base.CONTACT_DATABASE_URL);
  });

  it("fails to boot when missing", () => {
    const withoutContact = { ...base };
    delete (withoutContact as Partial<typeof base>).CONTACT_DATABASE_URL;
    expect(() => configSchema.parse(withoutContact)).toThrow();
  });
});
