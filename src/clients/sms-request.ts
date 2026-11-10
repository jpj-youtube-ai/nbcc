// The pure half of the text message client: the address, the number check and the request body.
// Nothing here touches the network or config, so it is unit-tested on its own. The signed call
// itself lives in src/clients/sms.ts, as src/clients/ses.ts sits beside src/clients/ses-request.ts.

export interface SmsMessage {
  /** The recipient in international form, for example +447700900123. */
  to: string;
  text: string;
  /** The sender name the phone shows, 3 to 11 letters and digits. */
  senderId: string;
}

export function snsEndpoint(region: string): string {
  return `https://sns.${region}.amazonaws.com/`;
}

/** A UK mobile in international form: +447 then nine digits, no spaces and no leading 0. */
export function isE164UkMobile(to: string): boolean {
  return /^\+447\d{9}$/.test(to);
}

// Form encoding where a space is %20 (not +), so the signed body is exactly what is sent.
function enc(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function buildSnsPublishBody(msg: SmsMessage): string {
  const pairs: Array<[string, string]> = [
    ["Action", "Publish"],
    ["Version", "2010-03-31"],
    ["PhoneNumber", msg.to],
    ["Message", msg.text],
    ["MessageAttributes.entry.1.Name", "AWS.SNS.SMS.SenderID"],
    ["MessageAttributes.entry.1.Value.DataType", "String"],
    ["MessageAttributes.entry.1.Value.StringValue", msg.senderId],
    ["MessageAttributes.entry.2.Name", "AWS.SNS.SMS.SMSType"],
    ["MessageAttributes.entry.2.Value.DataType", "String"],
    ["MessageAttributes.entry.2.Value.StringValue", "Transactional"],
  ];
  return pairs.map(([k, v]) => `${k}=${enc(v)}`).join("&");
}
