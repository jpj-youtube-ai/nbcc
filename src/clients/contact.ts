import { config } from "../config";

// Contact forwarding client (REQ-030). Forwards a website enquiry to the
// configured form service (Formspree-style) or NBCC inbox endpoint. The endpoint
// URL comes from src/config — an SSM SecureString in AWS — never process.env
// directly (golden rule 3). Mirrors src/clients/exampleApi.ts / stripe.ts: a thin
// fetch wrapper reading its credentials through the config module.
//
// Stub seam (mirrors stripe.ts): a real forwarding URL points at a real service;
// local dev, CI and fresh SSM params use a placeholder on the reserved `.example`
// domain. OUTSIDE production, when the URL is a placeholder, forwarding is stubbed
// (no network) so the /api/contact flow can be exercised end to end — locally and
// in CI — without a form-service account. With a real URL the real POST is made in
// any environment, and production NEVER stubs, so a missing/placeholder URL there
// surfaces as a 502 and the front-end degrades to its mailto fallback (REQ-027).
export interface ContactEnquiry {
  firstName: string;
  lastName: string;
  email: string;
  message: string;
}

function isPlaceholderUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".example");
  } catch {
    return true;
  }
}

export const contactConfigured = !isPlaceholderUrl(config.CONTACT_FORWARD_URL);
const useStub = !contactConfigured && config.NODE_ENV !== "production";

export async function forwardEnquiry(enquiry: ContactEnquiry): Promise<void> {
  // Preview/stub: pretend the enquiry forwarded (no network call).
  if (useStub) return;

  const res = await fetch(config.CONTACT_FORWARD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(enquiry),
  });
  if (!res.ok) {
    throw new Error(`Contact forward responded ${res.status}`);
  }
}
