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

  // Stripe webhook signing secret (whsec_…) for verifying inbound webhook
  // signatures via stripe.webhooks.constructEvent (REQ-036/TASK-046). A secret —
  // required, non-empty, NEVER defaulted; a placeholder locally/CI, a SecureString
  // in SSM in staging/prod.
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  // Optional: a Stripe Product id (prod_…) to group one-off donations under. The
  // one-off amount stays variable; this only sets the product the inline price
  // hangs off (cleaner Stripe reporting/receipts). Left unset, an inline product
  // is named instead, so it is optional and never blocks boot.
  STRIPE_DONATION_PRODUCT: z.string().optional(),

  // Contact form forwarding (REQ-030). The endpoint URL of the form service
  // (Formspree-style) or NBCC inbox the /api/contact handler POSTs enquiries to.
  // It is the credential that authorises submissions, so it is held as a secret
  // (SSM SecureString in AWS); validated as a URL.
  CONTACT_FORWARD_URL: z.string().url(),

  // Transactional email send endpoint (TASK-070). The provider URL the email
  // client POSTs a single donation-confirmation message to after a successful
  // payment. It authorises sends, so it is held as a secret (SSM SecureString in
  // AWS); validated as a URL. A `.example` host is treated as unconfigured and the
  // send is stubbed outside production (mirrors CONTACT_FORWARD_URL / the Stripe seam).
  EMAIL_SEND_URL: z.string().url(),

  // Base URL for the Gift Aid declaration form the in-person confirmation email links to
  // (TASK-075/REQ-048). The auto-email after a card-present donation embeds a unique,
  // token-addressed declaration link + a QR-encodable short link built on this base, so a
  // walk-in donor can add Gift Aid afterwards. NOT a secret (it ships in emails/QR codes),
  // but AWS-injected like the price IDs (SSM String → task-def secrets). Validated as a URL.
  DECLARATION_FORM_BASE_URL: z.string().url(),
});

export type Config = z.infer<typeof configSchema>;
