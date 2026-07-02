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
