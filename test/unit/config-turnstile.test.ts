import { describe, it, expect, vi, afterEach } from "vitest";
import { configSchema, productionConfigProblems } from "../../src/config/schema";

// TASK-490: the contact form's Cloudflare Turnstile keys. Off (empty) by default so local dev and
// CI boot with no call to Cloudflare; required in production, so the check can never silently
// switch itself off there.

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

describe("Turnstile keys in config", () => {
  it("default to empty, so local dev and CI boot with the check off", () => {
    const c = configSchema.parse(base);
    expect(c.TURNSTILE_SITE_KEY).toBe("");
    expect(c.TURNSTILE_SECRET_KEY).toBe("");
    expect(productionConfigProblems(c)).toEqual([]);
  });

  it("are both required in production, so the check can never silently be off there", () => {
    const c = configSchema.parse({ ...base, NODE_ENV: "production" });
    expect(productionConfigProblems(c)).toEqual([
      "TURNSTILE_SITE_KEY is required in production",
      "TURNSTILE_SECRET_KEY is required in production",
    ]);
  });

  it("satisfy production once both are set, even while the secret is still REPLACE_ME", () => {
    const c = configSchema.parse({
      ...base,
      NODE_ENV: "production",
      TURNSTILE_SITE_KEY: "0x4AAAAAAFLWXsnTJas6eb4L",
      TURNSTILE_SECRET_KEY: "REPLACE_ME",
    });
    expect(productionConfigProblems(c)).toEqual([]);
  });
});

describe("the shared config in production", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // The 2am backup and the 8am reminders load this same config. They never serve the contact form,
  // so only the web server (src/index.ts) insists on the spam check's keys.
  it("loads without the Turnstile keys, so the scheduled jobs never depend on them", async () => {
    for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    vi.resetModules();
    const { config } = await import("../../src/config");
    expect(config.NODE_ENV).toBe("production");
    expect(exit).not.toHaveBeenCalled();
  });
});
