import { FOOTER_HTML, FOOTER_TEXT } from "../legal/registration";
import { escapeHtml } from "./invitation-email";

// TASK-414: the one follow-up, for a business that did not reply.
//
// Pure - no pool, no config, no clock - so the copy rules are unit-tested without a database or a
// mail account (golden rule 5).
//
// The whole design of this email is "make it easy to say no". A second unanswered email is a
// nuisance unless it costs the reader nothing, so this one is short, says outright that it is the
// last, and gives them a way out in the first paragraph rather than the footer. A business that
// ignores both has told us something, and we stop.

const MAROON = "#800000";
const CRIMSON = "#C02238";
const CREAM = "#F8F5EE";
const SLATE = "#333333";
const SLATE_SOFT = "#6B6459";
const LINE = "#E4DED3";
const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
const BODY = "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";
const PHONE = "01292 811 015";
const PHONE_TEL = "+441292811015";

export interface OutreachNudge {
  businessName: string;
  contactName?: string | null;
  signerName: string;
  signerRole: string;
  donateUrl: string;
  privacyUrl: string;
}

export interface BuiltNudge {
  subject: string;
  html: string;
  text: string;
}

/**
 * Deliberately not "Following up" or "Just checking in", which are the two subject lines every
 * unwanted second email uses. This one says what it is.
 */
export function nudgeSubject(): string {
  return "One last note from us";
}

function greeting(input: OutreachNudge): string {
  const first = (input.contactName ?? "").trim().split(/\s+/)[0];
  return first ? `Hello ${first},` : "Hello,";
}

export function buildOutreachNudgeText(input: OutreachNudge): string {
  return `${greeting(input)}

I wrote a couple of weeks ago about ${input.businessName} supporting the Night
Before Christmas Campaign, and I do not want to keep filling your inbox, so this
is the last you will hear from me about it.

If it is not the right time, there is nothing you need to do. We will not write
again.

If it is, the page is here and it takes a couple of minutes:
${input.donateUrl}

And if you would rather talk it through, reply to this or call ${PHONE},
Monday to Friday.

Either way, thank you for reading.

${input.signerName}
${input.signerRole}
${PHONE}

What we hold and how to ask us to remove it: ${input.privacyUrl}

${FOOTER_TEXT}`;
}

export function buildOutreachNudgeHtml(input: OutreachNudge): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(nudgeSubject())}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFDFA;border:1px solid ${LINE};border-radius:10px;overflow:hidden;">

      <tr><td style="padding:26px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;font-family:${BODY};font-weight:700;color:${MAROON};font-size:14px;line-height:1.5;">Night Before Christmas Campaign</td>
          <td style="vertical-align:middle;text-align:right;">
            <img src="${LOGO_URL}" alt="Night Before Christmas Campaign" width="150" style="display:inline-block;height:auto;max-width:150px;border:0;" />
            <div style="font-family:${BODY};font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:${MAROON};font-size:13px;margin-top:2px;">Here all year</div>
          </td>
        </tr></table>
      </td></tr>

      <tr><td style="padding:22px 32px 8px;">
        <h1 style="margin:0;font-family:${HEAD};font-size:24px;font-weight:600;color:${MAROON};line-height:1.25;">
          One last note from us
        </h1>
      </td></tr>

      <tr><td style="padding:0 32px 16px;font-family:${BODY};color:${SLATE};font-size:16px;line-height:1.7;">
        <p style="margin:0 0 16px;">${escapeHtml(greeting(input))}</p>
        <p style="margin:0 0 16px;">
          I wrote a couple of weeks ago about <b>${escapeHtml(input.businessName)}</b> supporting the
          Night Before Christmas Campaign, and I do not want to keep filling your inbox, so this is
          the last you will hear from me about it.
        </p>
        <p style="margin:0 0 16px;">
          If it is not the right time, there is nothing you need to do. We will not write again.
        </p>
      </td></tr>

      <tr><td align="center" style="padding:0 32px 24px;">
        <a href="${escapeHtml(input.donateUrl)}"
           style="display:inline-block;background:${CRIMSON};color:#FFFFFF;font-family:${BODY};font-size:16px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:999px;">
          Become a supporter
        </a>
      </td></tr>

      <tr><td style="padding:0 32px 24px;font-family:${BODY};color:${SLATE};font-size:16px;line-height:1.7;">
        <p style="margin:0 0 16px;">
          And if you would rather talk it through, reply to this or call
          <a href="tel:${PHONE_TEL}" style="color:${MAROON};font-weight:600;">${PHONE}</a>, Monday to Friday.
        </p>
        <p style="margin:0 0 4px;">Either way, thank you for reading.</p>
        <p style="margin:16px 0 0;font-weight:600;">${escapeHtml(input.signerName)}</p>
        <p style="margin:0 0 10px;color:${SLATE_SOFT};font-size:14px;">${escapeHtml(input.signerRole)}</p>
        <p style="margin:0;font-size:14px;">
          <a href="${escapeHtml(input.privacyUrl)}" style="color:${MAROON};font-weight:600;">What we hold, and how to ask us to remove it</a>
        </p>
      </td></tr>

      <tr><td style="background:${MAROON};padding:18px 32px;font-family:${BODY};color:rgba(248,245,238,.82);font-size:12px;line-height:1.7;">
        ${FOOTER_HTML}
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function buildOutreachNudge(input: OutreachNudge): BuiltNudge {
  return {
    subject: nudgeSubject(),
    html: buildOutreachNudgeHtml(input),
    text: buildOutreachNudgeText(input),
  };
}
