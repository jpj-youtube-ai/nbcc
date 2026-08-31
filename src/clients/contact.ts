import { config } from "../config";
import { sendSesEmail } from "./ses";
import { buildContactEmail } from "../email/templates";

// Contact enquiry client (REQ-030; Resend→SES migration). A website enquiry is now a normal SES
// send to the NBCC inbox (config.CONTACT_TO_EMAIL) with Reply-To set to the enquirer — the
// forwarding Worker (CONTACT_FORWARD_URL) is gone. The email body comes from the pure
// src/email/templates.ts builder so it is unit-testable without a network.
//
// Stub seam (mirrors email.ts / stripe.ts): outside production, forwarding is stubbed (no
// network) unless EMAIL_PROVIDER=ses, so the /api/contact flow can be exercised end to end —
// locally and in CI — without an AWS account. Production NEVER stubs; a failed send surfaces as
// a 502 and the front-end degrades to its mailto fallback (REQ-027).
export interface ContactEnquiry {
  firstName: string;
  lastName: string;
  email: string;
  message: string;
}

export const contactConfigured = config.EMAIL_PROVIDER === "ses";
const useStub = !contactConfigured && config.NODE_ENV !== "production";

export async function forwardEnquiry(enquiry: ContactEnquiry): Promise<void> {
  // Preview/stub: pretend the enquiry forwarded (no network call).
  if (useStub) return;

  const built = buildContactEmail(enquiry);
  await sendSesEmail({
    to: config.CONTACT_TO_EMAIL,
    from: config.MAIL_FROM,
    replyTo: enquiry.email,
    subject: built.subject,
    html: built.html,
    text: built.text,
    configurationSet: config.SES_TRANSACTIONAL_CONFIGURATION_SET || undefined,
  });
}
