import { config } from "../config";

// Transactional email client (TASK-070). Sends a single donation-confirmation
// message to the configured provider after a successful payment. The endpoint URL
// comes from src/config — an SSM SecureString in AWS — never process.env directly
// (golden rule 3). Mirrors src/clients/contact.ts: a thin fetch wrapper reading its
// credentials through the config module.
//
// Stub seam (mirrors contact.ts / stripe.ts): a real send URL points at a real
// provider; local dev, CI and fresh SSM params use a placeholder on the reserved
// `.example` domain. OUTSIDE production, when the URL is a placeholder, sending is
// stubbed (no network) so the payment→confirmation flow can be exercised end to end
// — locally and in CI — without a provider account. With a real URL the real POST is
// made in any environment, and production NEVER stubs. This is the SINGLE, minimal
// donation-confirmation email — not the full REQ-060 templated system.
export interface DonationConfirmation {
  email: string;
  fullName: string;
  amountPence: number;
  currency: string;
  // The built email content (TASK-098): a Gift Aid line + manage/cancel copy where they apply,
  // from the pure src/donors/confirmation.ts. Optional so a bare payload still sends.
  text?: string;
  html?: string;
}

function isPlaceholderUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".example");
  } catch {
    return true;
  }
}

export const emailConfigured = !isPlaceholderUrl(config.EMAIL_SEND_URL);
const useStub = !emailConfigured && config.NODE_ENV !== "production";

export async function sendDonationConfirmation(message: DonationConfirmation): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`Email send responded ${res.status}`);
  }
}

// The in-person Gift Aid declaration email (TASK-075/REQ-048). After a card-present
// donation with no Gift Aid, the walk-in donor is emailed a unique, token-addressed
// declaration link plus a QR-encodable short link so they can add Gift Aid afterwards.
// The links are built in the processor (from DECLARATION_FORM_BASE_URL + the donation's
// unique token) and passed in, so they are unit-testable there; this client only ships
// the payload. Same stub-seam + best-effort contract as sendDonationConfirmation.
export interface DeclarationEmail {
  email: string;
  declarationLink: string; // the full, token-addressed Gift Aid declaration form URL
  shortLink: string; // the QR-encodable short link (same token, compact path)
  amountPence: number;
  currency: string;
}

export async function sendDeclarationEmail(message: DeclarationEmail): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`Declaration email send responded ${res.status}`);
  }
}

// The Corporation Tax receipt email for a COMPANY donation (REQ-053, TASK-088). A company gift
// is relieved via Corporation Tax, not Gift Aid, so after a company checkout with NO
// consideration given the donor's billing contact is emailed a receipt. The verbatim content
// (text + html) is built by the pure src/donors/receipt.ts and passed in, so this client only
// ships the payload. Same stub-seam + best-effort contract as sendDonationConfirmation.
export interface CompanyReceiptEmail {
  email: string; // the company's billing contact email
  legalName: string;
  amountPence: number;
  currency: string;
  text: string; // the receipt as plain text
  html: string; // the receipt as HTML
}

export async function sendCompanyReceipt(message: CompanyReceiptEmail): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`Company receipt email send responded ${res.status}`);
  }
}

// The refund-confirmation email for an INDIVIDUAL donor (REQ-063 · TASK-099). After a
// refund/dispute on an individual's donation, a consented donor is emailed a confirmation stating
// the refunded amount + date. The verbatim content (text + html) is built by the pure
// src/donors/confirmation.ts (buildRefundConfirmation) and passed in. Same stub-seam + best-effort
// contract as the other sends.
export interface RefundConfirmationEmail {
  email: string;
  fullName: string;
  refundedPence: number;
  currency: string;
  text: string;
  html: string;
}

export async function sendRefundConfirmation(message: RefundConfirmationEmail): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`Refund confirmation email send responded ${res.status}`);
  }
}

// The self-serve portal magic-link email (TASK-100/REQ-061). A passwordless, one-time, expiring
// link (built by portalMagicLink on PORTAL_BASE_URL) is emailed so the donor can access the portal
// without a password. Same stub-seam + best-effort contract as the other sends.
export interface PortalMagicLinkEmail {
  email: string;
  fullName: string;
  link: string; // the one-time, expiring magic-link URL
}

export async function sendPortalMagicLink(message: PortalMagicLinkEmail): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`Portal magic-link email send responded ${res.status}`);
  }
}

// Subscription-lapsed notices (TASK-092/REQ-065). When a monthly subscription lapses (Stripe
// Smart Retries exhausted) the platform sends, post-commit and best-effort, two messages: a
// notice to the donor (only when they gave an email + consent — gated by the caller) and a fixed
// operational notice to the NBCC admin inbox (config.ADMIN_NOTIFICATION_EMAIL). Same stub-seam +
// best-effort contract as the other sends.
export interface SubscriptionLapsedDonorEmail {
  email: string; // the donor's contact email
  fullName: string;
  subscriptionId: string;
}

export async function sendSubscriptionLapsedDonor(message: SubscriptionLapsedDonorEmail): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`Subscription lapsed (donor) email send responded ${res.status}`);
  }
}

export interface SubscriptionLapsedAdminEmail {
  email: string; // the admin inbox (config.ADMIN_NOTIFICATION_EMAIL)
  donorName: string;
  subscriptionId: string;
}

export async function sendSubscriptionLapsedAdmin(message: SubscriptionLapsedAdminEmail): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`Subscription lapsed (admin) email send responded ${res.status}`);
  }
}

// The admin newsletter send (TASK-161/REQ-069; relay contract fixed TASK-162). Sends ONE individual
// message per consenting donor, with From + Reply-To set to config.NEWSLETTER_FROM_EMAIL so replies
// reach a real inbox (not noreply). Each message's html already carries the recipient's unsubscribe
// link (built by the route from buildNewsletterHtml). Same stub-seam + best-effort contract as the
// other sends: a placeholder EMAIL_SEND_URL means no network outside production.
//
// The recipient rides in `email` (the field the relay Worker reads — services/email-relay), and the
// posted body carries `newsletter: true` so the relay maps it via its dedicated newsletter branch
// (honouring this message's subject + from + replyTo) instead of the donation-confirmation default.
export interface NewsletterEmail {
  email: string; // recipient — the relay's recipient field
  from: string; // config.NEWSLETTER_FROM_EMAIL
  replyTo: string; // same as from
  subject: string;
  html: string;
}

export async function sendNewsletter(message: NewsletterEmail): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...message, newsletter: true }),
  });
  if (!res.ok) {
    throw new Error(`Newsletter email send responded ${res.status}`);
  }
}

// The admin thank-you letter send (TASK-163/REQ-069). After an admin composes a thank-you in the
// "Thank you" view, the platform emails the donor the fully rendered, branded letter (built by the
// pure src/thank-you/letter.ts). Like sendNewsletter, From + Reply-To are set to
// config.GIVING_FROM_EMAIL (the giving inbox) so a reply reaches a real NBCC inbox, and the body carries
// `thankYou: true` so the relay maps it via its dedicated thank-you branch (honouring this message's
// subject + from + replyTo) instead of the donation-confirmation default. Same stub-seam + best-effort
// contract as the other sends: a placeholder EMAIL_SEND_URL means no network outside production.
export interface ThankYouLetterEmail {
  email: string; // recipient — the relay's recipient field
  cc?: string; // optional CC recipient (TASK-168); omitted from the payload when unset
  from: string; // config.GIVING_FROM_EMAIL
  replyTo: string; // same as from
  subject: string;
  html: string;
}

export async function sendThankYou(message: ThankYouLetterEmail): Promise<void> {
  // Preview/stub: pretend the email sent (no network call).
  if (useStub) return;

  const res = await fetch(config.EMAIL_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...message, thankYou: true }),
  });
  if (!res.ok) {
    throw new Error(`Thank-you email send responded ${res.status}`);
  }
}
