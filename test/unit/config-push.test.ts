import { describe, it, expect } from "vitest";
import { configSchema, productionConfigProblems, pushIsConfigured, vapidSubject } from "../../src/config/schema";

// The VAPID keys for admin phone notifications (TASK-619).
//
// They default to empty like the Turnstile pair, and for the same reason: Terraform creates the
// SSM parameters holding REPLACE_ME and the real keys are pasted in out of band, so CI, a laptop
// and the first deploy after the merge all have to boot happily without them.
//
// Unlike Turnstile they are NOT required in production. A missing spam check is a silent hole in a
// defence; missing notification keys just mean nobody's phone buzzes, which is obvious to the one
// person who asked for it and harmless to everyone else. Making them required would mean the
// merge that ships this feature cannot deploy until someone has pasted a key in by hand.

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

describe("the push keys in config", () => {
  it("default to empty, so every environment boots with notifications simply off", () => {
    const c = configSchema.parse(base);
    expect(c.VAPID_PUBLIC_KEY).toBe("");
    expect(c.VAPID_PRIVATE_KEY).toBe("");
  });

  it("are not required in production, so shipping the feature does not block the deploy", () => {
    const c = configSchema.parse({ ...base, NODE_ENV: "production" });
    expect(productionConfigProblems(c).filter((p) => p.includes("VAPID"))).toEqual([]);
  });
});

describe("whether push is switched on", () => {
  it("needs BOTH keys", () => {
    expect(pushIsConfigured({ VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" })).toBe(false);
    expect(pushIsConfigured({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "" })).toBe(false);
    expect(pushIsConfigured({ VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "priv" })).toBe(false);
    expect(pushIsConfigured({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toBe(true);
  });

  // Terraform writes REPLACE_ME so the task can start before anyone has pasted the real key in.
  // Treating that as a key would start the minute-by-minute sweep and fail every single send.
  it("counts the Terraform placeholder as off", () => {
    expect(pushIsConfigured({ VAPID_PUBLIC_KEY: "REPLACE_ME", VAPID_PRIVATE_KEY: "REPLACE_ME" })).toBe(false);
    expect(pushIsConfigured({ VAPID_PUBLIC_KEY: "real", VAPID_PRIVATE_KEY: "REPLACE_ME" })).toBe(false);
  });

  it("ignores the whitespace a pasted key often carries", () => {
    expect(pushIsConfigured({ VAPID_PUBLIC_KEY: "  ", VAPID_PRIVATE_KEY: "  " })).toBe(false);
  });
});

describe("who the push service can complain to", () => {
  // RFC 8292 wants a contact in the token. Rather than a fourth config value to wire through five
  // files, it reuses the inbox that already receives every operational notice.
  it("is the operations inbox, as a mailto", () => {
    expect(vapidSubject(configSchema.parse(base))).toBe("mailto:ops@nbcc.scot");
  });
});
