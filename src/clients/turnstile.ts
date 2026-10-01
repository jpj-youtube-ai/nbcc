import { config } from "../config";

// Cloudflare Turnstile (TASK-490): is a pass from the contact form's box genuine? This is the only
// code that knows Cloudflare's error codes, so its callers see one of three answers:
//   passed      - carry on
//   refused     - the visitor's pass is missing, invalid, expired or already used: store nothing
//   unavailable - the check itself could not answer (network, timeout, Cloudflare's own error, or
//                 our secret rejected): the caller keeps the message and logs the reason, so a
//                 genuine enquiry is never lost because the checker had a bad moment.
export type CaptchaVerdict =
  | { outcome: "passed" }
  | { outcome: "refused"; reason: string }
  | { outcome: "unavailable"; reason: string };

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;
// Cloudflare's passes are at most 2048 characters; anything longer is not one of theirs.
const MAX_TOKEN_LENGTH = 2048;
// Error codes about OUR request or Cloudflare itself, never about the visitor's pass.
const NOT_THE_VISITORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);

// On only when BOTH keys are set: a secret without a site key would refuse every message, because
// the page could not show the box (see src/config/schema.ts). Boolean() so a config without the
// keys at all (a test's mock) reads as off.
export function captchaEnabled(): boolean {
  return Boolean(config.TURNSTILE_SITE_KEY) && Boolean(config.TURNSTILE_SECRET_KEY);
}

// What GET /api/contact/captcha tells the page: the site key when the check is on, else null.
export function captchaSiteKey(): string | null {
  return captchaEnabled() ? config.TURNSTILE_SITE_KEY : null;
}

export async function verifyCaptcha(
  token: unknown,
  remoteIp: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptchaVerdict> {
  // A missing or oversized pass is refused here, without asking Cloudflare.
  if (typeof token !== "string" || token.trim() === "") return { outcome: "refused", reason: "missing-input-response" };
  if (token.length > MAX_TOKEN_LENGTH) return { outcome: "refused", reason: "invalid-input-response" };

  let res: Response;
  try {
    res = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: config.TURNSTILE_SECRET_KEY,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
    return { outcome: "unavailable", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error" };
  }
  if (!res.ok) return { outcome: "unavailable", reason: `Cloudflare replied ${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { outcome: "unavailable", reason: "unreadable reply" };
  }
  if (!body || typeof body !== "object") return { outcome: "unavailable", reason: "unreadable reply" };
  const result = body as { success?: unknown; "error-codes"?: unknown };
  if (result.success === true) return { outcome: "passed" };

  const codes = Array.isArray(result["error-codes"]) ? result["error-codes"].map(String) : [];
  if (codes.some((code) => NOT_THE_VISITORS.has(code))) return { outcome: "unavailable", reason: codes.join(", ") };
  return { outcome: "refused", reason: codes.join(", ") || "no reason given" };
}
