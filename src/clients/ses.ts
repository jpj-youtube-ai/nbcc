import { config } from "../config";
import { createCredentialProvider, signRequest } from "./aws-sigv4";
import { buildSesSendRequest, sesEndpoint, type SesMessage } from "./ses-request";

// The Amazon SES send client (Resend→SES migration). Replaces the Cloudflare Worker relay: the
// app now calls the SESv2 API directly from ECS using the task role — no API key, no shared
// secret, no third party between the app and the mailbox provider. The HTTP call is hand-signed
// (src/clients/aws-sigv4.ts) so no AWS SDK dependency is needed; the payload mapping lives in
// src/clients/ses-request.ts, pure and unit-tested.

export type { SesMessage } from "./ses-request";

// Task-role (or local static) credentials, resolved lazily and cached. The env VALUES come
// through src/config (golden rule 3) — AWS injects them into the container, the config schema
// passes them through as optional keys.
const resolveCredentials = createCredentialProvider({
  accessKeyId: config.AWS_ACCESS_KEY_ID,
  secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  sessionToken: config.AWS_SESSION_TOKEN,
  containerCredentialsRelativeUri: config.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
});

/**
 * Send one email via SESv2. Throws with the REAL HTTP status and response detail on refusal —
 * src/newsletter/send-failure.ts classifies 429/503/504 as "come back later", so the status
 * must survive into the message (SES throttling is a 429 TooManyRequestsException).
 */
// TASK-346: returns the id SES assigns the message, which the audit log stores so a delivery
// event can be matched to the exact send it belongs to. SESv2 has always returned this in the
// response body; it was simply being discarded, which is why email_log had to fall back to
// guessing by recipient and recency.
//
// Null rather than throwing when the body cannot be read: the email HAS been accepted at this
// point, and losing the audit id is not a reason to tell the caller the send failed.
export async function sendSesEmail(
  msg: SesMessage,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = sesEndpoint(config.SES_REGION);
  const body = JSON.stringify(buildSesSendRequest(msg));
  const credentials = await resolveCredentials();
  const headers = signRequest({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    body,
    region: config.SES_REGION,
    service: "ses",
    credentials,
  });
  const res = await fetchImpl(url, { method: "POST", headers, body });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SES send responded ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  try {
    const parsed = (await res.json()) as { MessageId?: unknown };
    return typeof parsed?.MessageId === "string" ? parsed.MessageId : null;
  } catch {
    return null;
  }
}
