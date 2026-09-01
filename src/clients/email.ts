import { config } from "../config";
import { sendSesEmail, type SesMessage } from "./ses";
import { buildKindEmail } from "../email/templates";
import { recordEmailSend } from "../db/email-log";

// Transactional email client (TASK-070; Resend→SES migration). Sends every app email straight
// to Amazon SES (src/clients/ses.ts) — the Cloudflare Worker relay and its Resend account are
// gone. The branded bodies the relay used to build now come from src/email/templates.ts; the
// kinds that ship fully rendered content (newsletter, thank-you letters, ball emails…) send it
// verbatim, exactly as the relay's passthrough branches did.
//
// Stub seam (mirrors stripe.ts): outside production, sends are stubbed (no network) unless
// EMAIL_PROVIDER=ses — so the payment→confirmation flow can be exercised end to end, locally and
// in CI, without an AWS account. Production NEVER stubs, whatever the flag says: a misconfigured
// production must fail loudly, not silently swallow receipts.
//
// Audit trail (email-audit feature): EVERY attempt through sendAndLog below lands one metadata
// row in email_log (src/db/email-log.ts) — kind, recipient, name, subject, sent/failed + error;
// never a body (bodies carry one-time links and 2FA codes). Best-effort by contract: a
// bookkeeping failure must never fail, block, or alter the send it describes. Stubbed sends log
// as 'sent' too, so the audit page is exercised end to end in dev/CI.
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

export const emailConfigured = config.EMAIL_PROVIDER === "ses";
const useStub = !emailConfigured && config.NODE_ENV !== "production";
// Exposes the stub seam to callers outside this module (admin-management Phase 3, TASK-188)
// so the login route can tell whether a login-code email actually left the building. Always
// false in production (production never stubs) — see the "Stub safety" note on emailStubbed's
// only production-facing use: the login-code response must never leak the code when this is false.
export const emailStubbed = useStub;

// The transactional sender + configuration set, shared by every kind below except the
// newsletter (which carries its own from/reply-to and the click-tracked newsletter set).
const transactional = () => ({
  from: config.MAIL_FROM,
  configurationSet: config.SES_TRANSACTIONAL_CONFIGURATION_SET || undefined,
});

async function logAttempt(
  kind: string,
  to: string,
  name: string | null,
  subject: string,
  error: string | null,
): Promise<void> {
  try {
    await recordEmailSend({
      kind,
      recipient: to,
      recipientName: name,
      subject,
      status: error ? "failed" : "sent",
      error,
    });
  } catch (err) {
    console.error("email log write failed:", err instanceof Error ? err.message : err);
  }
}

// Every send funnels through here: stub short-circuit, the SES call, and the audit row. The
// original error is ALWAYS rethrown untouched — callers (the newsletter queue's failure
// classifier above all) depend on the real message.
async function sendAndLog(kind: string, name: string | null, msg: SesMessage): Promise<void> {
  if (useStub) {
    await logAttempt(kind, msg.to, name, msg.subject, null);
    return;
  }
  try {
    await sendSesEmail(msg);
  } catch (err) {
    await logAttempt(kind, msg.to, name, msg.subject, err instanceof Error ? err.message : String(err));
    throw err;
  }
  await logAttempt(kind, msg.to, name, msg.subject, null);
}

export async function sendDonationConfirmation(message: DonationConfirmation): Promise<void> {
  const built = buildKindEmail("donation", { html: message.html, text: message.text });
  await sendAndLog("donation", message.fullName ?? null, { to: message.email, ...transactional(), ...built });
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
  const built = buildKindEmail("declaration", {
    declarationLink: message.declarationLink,
    shortLink: message.shortLink,
    amountPence: message.amountPence,
    currency: message.currency,
  });
  await sendAndLog("declaration", null, { to: message.email, ...transactional(), ...built });
}

// The Corporation Tax receipt email for a COMPANY donation (REQ-053, TASK-088). A company gift
// is relieved via Corporation Tax, not Gift Aid, so after a company checkout with NO
// consideration given the donor's billing contact is emailed a receipt. The verbatim content
// (text + html) is built by the pure src/donors/receipt.ts and passed in. Same stub-seam +
// best-effort contract as sendDonationConfirmation.
export interface CompanyReceiptEmail {
  email: string; // the company's billing contact email
  legalName: string;
  amountPence: number;
  currency: string;
  text: string; // the receipt as plain text
  html: string; // the receipt as HTML
}

export async function sendCompanyReceipt(message: CompanyReceiptEmail): Promise<void> {
  const built = buildKindEmail("receipt", { html: message.html, text: message.text });
  await sendAndLog("receipt", message.legalName ?? null, { to: message.email, ...transactional(), ...built });
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
  const built = buildKindEmail("refund", { html: message.html, text: message.text });
  await sendAndLog("refund", message.fullName ?? null, { to: message.email, ...transactional(), ...built });
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
  const built = buildKindEmail("portal", { fullName: message.fullName, link: message.link });
  await sendAndLog("portal", message.fullName ?? null, { to: message.email, ...transactional(), ...built });
}

// Admin team invite / password-reset emails (admin-management Phase 1, Task 5). A staff invite or
// an admin/self-service password reset is a one-time, expiring, purpose-scoped link (built by
// adminActionLink on PORTAL_BASE_URL, signed with ADMIN_SESSION_SECRET — src/admin/tokens.ts).
// Mirrors sendPortalMagicLink exactly: same minimal payload shape, same stub-seam + best-effort
// contract as the other sends.
export interface AdminInviteEmail {
  email: string;
  fullName: string;
  link: string; // the one-time, expiring invite-accept URL (/invite?token=...)
}

export async function sendAdminInvite(message: AdminInviteEmail): Promise<void> {
  const built = buildKindEmail("adminInvite", { fullName: message.fullName, link: message.link });
  await sendAndLog("adminInvite", message.fullName ?? null, { to: message.email, ...transactional(), ...built });
}

export interface AdminResetEmail {
  email: string;
  fullName: string;
  link: string; // the one-time, expiring password-reset URL (/reset?token=...)
}

export async function sendAdminReset(message: AdminResetEmail): Promise<void> {
  const built = buildKindEmail("adminReset", { fullName: message.fullName, link: message.link });
  await sendAndLog("adminReset", message.fullName ?? null, { to: message.email, ...transactional(), ...built });
}

// Admin login-code email (admin-management Phase 3 · mandatory email 2FA, TASK-188). After a
// password-valid login from an untrusted device, the platform emails a one-time 6-digit code
// (generated + hashed by src/admin/two-factor.ts) so the admin can complete step 2. See
// emailStubbed above: on non-production, when this stubs, the login route falls back to
// returning the code directly in its response so 2FA can still be completed. The audit row
// carries the SUBJECT only — the subject deliberately does not contain the code.
export interface AdminLoginCodeEmail {
  email: string;
  fullName: string;
  code: string; // the 6-digit login code (never logged)
}

export async function sendAdminLoginCode(message: AdminLoginCodeEmail): Promise<void> {
  const built = buildKindEmail("loginCode", { fullName: message.fullName, code: message.code });
  await sendAndLog("loginCode", message.fullName ?? null, { to: message.email, ...transactional(), ...built });
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
  const built = buildKindEmail("lapsedDonor", { fullName: message.fullName });
  await sendAndLog("lapsedDonor", message.fullName ?? null, { to: message.email, ...transactional(), ...built });
}

export interface SubscriptionLapsedAdminEmail {
  email: string; // the admin inbox (config.ADMIN_NOTIFICATION_EMAIL)
  donorName: string;
  subscriptionId: string;
}

export async function sendSubscriptionLapsedAdmin(message: SubscriptionLapsedAdminEmail): Promise<void> {
  const built = buildKindEmail("lapsedAdmin", {
    donorName: message.donorName,
    subscriptionId: message.subscriptionId,
  });
  await sendAndLog("lapsedAdmin", null, { to: message.email, ...transactional(), ...built });
}

// The admin newsletter send (TASK-161/REQ-069). Sends ONE individual message per consenting
// donor, with From + Reply-To set by the caller (config.NEWSLETTER_FROM_EMAIL /
// NEWSLETTER_REPLY_TO_EMAIL) so replies reach a real inbox (not noreply). Each message's html
// already carries the recipient's unsubscribe link (built by the route from
// buildNewsletterHtml). The newsletter rides the CLICK-TRACKED configuration set
// (SES_NEWSLETTER_CONFIGURATION_SET) so delivery/bounce/complaint/click events flow back to
// POST /api/webhooks/ses; transactional mail deliberately does not.
export interface NewsletterEmail {
  email: string; // recipient
  from: string; // config.NEWSLETTER_FROM_EMAIL
  replyTo: string; // config.NEWSLETTER_REPLY_TO_EMAIL
  subject: string;
  html: string;
  // TASK-275: the plain-text alternative. Newsletters went out HTML-only, which counts against a
  // sender with spam filters and leaves text-only clients and some screen readers with nothing. The
  // thank-you letters have carried one for ages; the newsletter was the one send that skipped it.
  text?: string;
  // TASK-272: the recipient's own one-click unsubscribe URL, sent as the List-Unsubscribe /
  // List-Unsubscribe-Post headers (RFC 8058) that Gmail and Yahoo require of bulk senders.
  // Without them people reach for "report spam" instead of the in-body link — and a complaint
  // costs the sending domain far more than an unsubscribe does.
  unsubscribeUrl?: string;
  // No attachments field on purpose: uploaded files are HOSTED (public /newsletter/document/<uuid>
  // pages) and linked from the body, never attached — links keep deliverability clean
  // (hosted-documents design, 2026-07-22).
}

export async function sendNewsletter(message: NewsletterEmail): Promise<void> {
  // TASK-302 contract, unchanged across the provider swap: a refusal must carry the real status
  // + detail (the SES client throws exactly that, and sendAndLog rethrows it untouched), so the
  // queue can tell "come back later" (429) from "give up on this address" — see
  // src/newsletter/send-failure.ts.
  await sendAndLog("newsletter", null, {
    to: message.email,
    from: message.from,
    replyTo: message.replyTo,
    subject: message.subject,
    html: message.html,
    text: message.text,
    configurationSet: config.SES_NEWSLETTER_CONFIGURATION_SET || undefined,
    ...(message.unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });
}

// The admin thank-you letter send (TASK-163/REQ-069; from-address + text part TASK-165; CC TASK-168).
// After an admin composes a thank-you in the "Thank you" view, the platform emails the donor the fully
// rendered, branded letter (built by the pure src/thank-you/letter.ts) with a plain-text alternative,
// optionally copying a CC. From + Reply-To are set to config.GIVING_FROM_EMAIL (giving@nbcc.scot) so a
// reply reaches a real NBCC inbox and the send authenticates on the verified domain. The content is
// sent VERBATIM — this is the design the transactional templates mirror, not the other way round.
export interface ThankYouLetterEmail {
  email: string; // recipient
  cc?: string; // optional CC recipient (TASK-168); omitted when unset
  from: string; // config.GIVING_FROM_EMAIL
  replyTo: string; // same as from
  subject: string;
  html: string;
  text?: string; // plain-text alternative (improves deliverability)
}

// Shared by every "app fully owns this branded email" send below: verbatim content on the
// transactional configuration set, logged under its own kind so the audit page can tell a
// thank-you letter from a ball receipt.
async function sendVerbatim(
  kind: string,
  name: string | null,
  message: {
    email: string;
    cc?: string;
    from: string;
    replyTo: string;
    subject: string;
    html: string;
    text?: string;
  },
): Promise<void> {
  await sendAndLog(kind, name, {
    to: message.email,
    cc: message.cc,
    from: message.from,
    replyTo: message.replyTo,
    subject: message.subject,
    html: message.html,
    text: message.text,
    configurationSet: config.SES_TRANSACTIONAL_CONFIGURATION_SET || undefined,
  });
}

export async function sendThankYou(message: ThankYouLetterEmail): Promise<void> {
  await sendVerbatim("thankYou", null, message);
}

// The business-supporter thank-you INVITE email (TASK-213). When a NEW business monthly supporter's
// fulfilment record is created, we email them the private link to the /business/thank-you page so they
// can choose how NBCC thanks them (without this email the token-gated page is unreachable). The fully
// rendered, branded content (subject + html + text) is built by the pure src/business/invite-email.ts
// and passed in; From + Reply-To are config.GIVING_FROM_EMAIL (giving@nbcc.scot) so a reply reaches a
// real NBCC inbox (same as the admin thank-you letter). Sent verbatim, like sendThankYou.
export interface BusinessSupporterInviteEmail {
  email: string; // recipient — the business's contact email
  from: string; // config.GIVING_FROM_EMAIL
  replyTo: string; // same as from
  subject: string;
  html: string;
  text: string; // plain-text alternative (improves deliverability)
}

export async function sendBusinessSupporterInvite(message: BusinessSupporterInviteEmail): Promise<void> {
  await sendVerbatim("businessInvite", null, message);
}

// The business-supporter CAPTURE-CONFIRMATION email (TASK-221). After a business supporter submits
// their recognition choices (through the inline thank-you form OR the emailed token link — both capture
// via postFulfilment), we email them a warm "here is what you chose" confirmation listing their choices
// and their download links. The fully rendered, branded content (subject + html + text) is built by the
// pure src/business/capture-confirmation-email.ts and passed in; From + Reply-To are
// config.GIVING_FROM_EMAIL (giving@nbcc.scot). Sent verbatim, like the invite.
export interface BusinessCaptureConfirmationEmail {
  email: string; // recipient — the business's contact email
  from: string; // config.GIVING_FROM_EMAIL
  replyTo: string; // same as from
  subject: string;
  html: string;
  text: string; // plain-text alternative (improves deliverability)
}

export async function sendBusinessCaptureConfirmation(message: BusinessCaptureConfirmationEmail): Promise<void> {
  await sendVerbatim("businessCapture", null, message);
}

// The business-supporter thank-you REMINDER email (TASK-222). When a business supporter has not yet
// chosen how they would like to be thanked, the daily runner nudges them twice: a warm 5-day reminder
// and a gentle 14-day last note. The fully rendered, branded content (subject + html + text) is built
// by the pure src/business/reminder-email.ts and passed in; From + Reply-To are config.GIVING_FROM_EMAIL
// (giving@nbcc.scot), exactly like the invite. Sent verbatim.
export interface BusinessSupporterReminderEmail {
  email: string; // recipient — the business's contact email
  from: string; // config.GIVING_FROM_EMAIL
  replyTo: string; // same as from
  subject: string;
  html: string;
  text: string; // plain-text alternative (improves deliverability)
}

export async function sendBusinessSupporterReminder(message: BusinessSupporterReminderEmail): Promise<void> {
  await sendVerbatim("businessReminder", null, message);
}

// The Festive Ball booking confirmation (TASK-313). Someone has just paid up to £1,000, so this
// is the receipt they hold until November. Content is built by the pure
// src/ball/confirmation-email.ts and passed in; From + Reply-To are config.BALL_FROM_EMAIL
// (events@nbcc.scot) — the APEX domain, deliberately NOT news.nbcc.scot, which is the
// newsletter's send-only sender and must not carry transactional receipts. Sent verbatim.
export interface BallConfirmationMessage {
  email: string; // the buyer
  from: string; // config.BALL_FROM_EMAIL
  replyTo: string; // same as from — a reply must reach a real inbox
  subject: string;
  html: string;
  text: string;
}

export async function sendBallConfirmation(message: BallConfirmationMessage): Promise<void> {
  await sendVerbatim("ballConfirmation", null, message);
}

// The Festive Ball "a week to go" reminder (TASK-313 plan 5). Same shape and same verbatim send
// as the booking confirmation; separate function so the two can be told apart in logs and so a
// change to one never silently alters the other.
export async function sendBallReminder(message: BallConfirmationMessage): Promise<void> {
  await sendVerbatim("ballReminder", null, message);
}

// TASK-338: the run-up emails (guest read-back, chase, last call). Its own function for the same
// reason as sendBallReminder above: so the three can be told apart in logs and in a bounce
// report, and so a change to one cannot silently alter another.
export async function sendBallRunUp(message: BallConfirmationMessage): Promise<void> {
  await sendVerbatim("ballRunUp", null, message);
}
