import { z } from "zod";

// Pure schema - NO side effects. Safe to import in tests.
export const configSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z.string().url(),

  EXTERNAL_API_ONE_BASE_URL: z.string().url(),
  EXTERNAL_API_ONE_KEY: z.string().min(1),
  EXTERNAL_API_TWO_KEY: z.string().min(1),

  // Stripe checkout (REQ-028/REQ-029). STRIPE_SECRET_KEY is a secret — required,
  // non-empty, NEVER defaulted (a default would mask a missing secret). The
  // success/cancel URLs are where Stripe redirects after checkout. The four
  // recurring monthly price IDs are keyed by plan (the donate tiers, REQ-022).
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_SUCCESS_URL: z.string().url(),
  STRIPE_CANCEL_URL: z.string().url(),
  STRIPE_PRICE_BRONZE: z.string().min(1),
  STRIPE_PRICE_SILVER: z.string().min(1),
  STRIPE_PRICE_GOLD: z.string().min(1),
  STRIPE_PRICE_PLATINUM: z.string().min(1),

  // Contact form forwarding (REQ-030). The endpoint URL of the form service
  // (Formspree-style) or NBCC inbox the /api/contact handler POSTs enquiries to.
  // It is the credential that authorises submissions, so it is held as a secret
  // (SSM SecureString in AWS); validated as a URL.
  CONTACT_FORWARD_URL: z.string().url(),
});

export type Config = z.infer<typeof configSchema>;
