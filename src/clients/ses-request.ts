// The PURE half of the SES client (Resend→SES migration): message shape → SESv2 SendEmail
// request body, and the regional endpoint. Deliberately config-free so it can be unit-tested
// (test/unit/email-templates.test.ts) without importing src/config, which exits the process
// when the full environment is absent. src/clients/ses.ts wires these to config + SigV4.

export interface SesMessage {
  to: string;
  from: string;
  replyTo?: string;
  cc?: string;
  subject: string;
  html?: string;
  text?: string;
  // Extra top-level MIME headers — the newsletter's RFC 8058 List-Unsubscribe pair rides here.
  headers?: Record<string, string>;
  // SES configuration set: routes delivery/bounce/complaint (and, for the newsletter set,
  // click) events to the SNS topic behind POST /api/webhooks/ses. Omitted = no events.
  configurationSet?: string;
}

export function sesEndpoint(region: string): string {
  return `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
}

// The SESv2 SendEmail body for one message. Optional fields are OMITTED, not sent empty —
// SES rejects empty address lists.
export function buildSesSendRequest(msg: SesMessage): Record<string, unknown> {
  const simple: Record<string, unknown> = {
    Subject: { Data: msg.subject },
    Body: {
      ...(msg.html ? { Html: { Data: msg.html } } : {}),
      ...(msg.text ? { Text: { Data: msg.text } } : {}),
    },
  };
  const headerEntries = Object.entries(msg.headers ?? {});
  if (headerEntries.length > 0) {
    simple.Headers = headerEntries.map(([Name, Value]) => ({ Name, Value }));
  }
  return {
    FromEmailAddress: msg.from,
    Destination: {
      ToAddresses: [msg.to],
      ...(msg.cc ? { CcAddresses: [msg.cc] } : {}),
    },
    ...(msg.replyTo ? { ReplyToAddresses: [msg.replyTo] } : {}),
    Content: { Simple: simple },
    ...(msg.configurationSet ? { ConfigurationSetName: msg.configurationSet } : {}),
  };
}
