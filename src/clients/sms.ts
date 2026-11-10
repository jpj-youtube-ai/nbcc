import { config } from "../config";
import { createCredentialProvider, signRequest } from "./aws-sigv4";
import { buildSnsPublishBody, isE164UkMobile, snsEndpoint, type SmsMessage } from "./sms-request";

// The text message client: one Amazon SNS Publish call, hand signed with the ECS task role exactly
// as src/clients/ses.ts signs SES calls. No key for anyone to type in. Nothing sends a text yet;
// the Elf Detective School photo alerts are the first caller.

export type { SmsMessage } from "./sms-request";

export const smsConfigured = config.SMS_PROVIDER === "sns";
// Outside production the stub sends nothing and touches no network. Production never stubs,
// whatever the flag says, as email never does.
const useStub = !smsConfigured && config.NODE_ENV !== "production";

const resolveCredentials = createCredentialProvider({
  accessKeyId: config.AWS_ACCESS_KEY_ID,
  secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  sessionToken: config.AWS_SESSION_TOKEN,
  containerCredentialsRelativeUri: config.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
});

// Never more than the last three digits of a number in a log line.
const tail = (to: string) => `…${to.slice(-3)}`;

// Amazon's refusal for a bad number echoes the number, so any run of six or more digits (with or
// without a leading +) in an error is cut down to its last three.
const redactDigits = (text: string) => text.replace(/\+?\d{6,}/g, (m) => `…${m.slice(-3)}`);

/**
 * Send one text. Throws "not a UK mobile" for anything but +447 and nine digits, and throws with
 * the real HTTP status when Amazon refuses, so a caller can count a failed text and carry on.
 */
export async function sendText(
  msg: SmsMessage,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<"sent" | "stubbed"> {
  if (!isE164UkMobile(msg.to)) throw new Error("not a UK mobile");
  if (useStub) return "stubbed";
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = snsEndpoint(config.SMS_REGION);
  const body = buildSnsPublishBody(msg);
  const credentials = await resolveCredentials();
  const headers = signRequest({
    method: "POST",
    url,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    region: config.SMS_REGION,
    service: "sns",
    credentials,
  });
  const res = await fetchImpl(url, { method: "POST", headers, body });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SNS publish responded ${res.status}: ${redactDigits(detail.slice(0, 300))}`);
  }
  console.log(`text sent to ${tail(msg.to)}`);
  return "sent";
}
