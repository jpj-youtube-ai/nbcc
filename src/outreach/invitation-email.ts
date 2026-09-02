import { FOOTER_HTML, FOOTER_TEXT } from "../legal/registration";

// TASK-351: the email a volunteer sends a local business, asking them to become a monthly
// supporter. Pure — no pool, no config, no clock — so the copy rules below are unit-tested
// without a database or a mail account.
//
// It mirrors the approved NBCC email family (src/business/invite-email.ts, src/thank-you/letter.ts):
// maroon letterhead, cream body, the Playfair and Poppins stacks with serif/sans fallbacks,
// color-scheme:light so dark-mode clients do not invert it, logo by absolute URL, brand colours
// inlined as hex because email clients do not load the site stylesheet.
//
// COPY RULES, inherited from that family and from the Code of Fundraising Practice:
//   * warm, appreciative, genuine, confident
//   * non-definitive impact language: "could help", never "£X provides Y"
//   * NO dashes of any kind in human copy (the CSS and URLs are not copy)
//   * the charity registration statement in the footer, from the one source of truth
//
// And one rule this email has that the others do not: it is COLD. The recipient did not ask to
// hear from us, which is why it opens by saying who we are and why we are writing, and closes by
// making it effortless to say no.

const MAROON = "#800000";
const CRIMSON = "#C02238";
const CREAM = "#F8F5EE";
const SLATE = "#333333";
const SLATE_SOFT = "#6F6A66";
const LINE = "#E9DFD2";

const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
const BODY = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

// A cold approach is the one email whose recipient has most reason to want a person on the end of
// a phone rather than a reply box, so both are on it. Same number and address as the ball emails
// and the contact page.
const PHONE = "01292 811 015";
const PHONE_TEL = "+441292811015";
const CONTACT_EMAIL = "info@nbcc.scot";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface OutreachInvitation {
  /** The business itself, used in the greeting when no contact name is known. */
  businessName: string;
  /** The person, where a volunteer knows one. "Hello Jane" against "Hello" is the whole game. */
  contactName?: string | null;
  /**
   * The volunteer's own words, from the box on the admin page. Optional, and the reason this
   * email is worth sending at all: one specific line about THIS business is the difference
   * between a letter and a mailshot.
   */
  personalMessage?: string | null;
  /** Who it is from, by name and role. From the shared SIGNERS list. */
  signerName: string;
  signerRole: string;
  /** Absolute links, passed in so this module stays config-free. */
  donateUrl: string;
  bookletUrl: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * "Hello Jane," where we know a name, "Hello," where we do not.
 *
 * Deliberately never "Dear Sir or Madam" or "Hello Ayr Joinery Ltd" — both announce a mailshot,
 * and a business owner can spot one in the first three words.
 */
function greeting(input: OutreachInvitation): string {
  const first = (input.contactName ?? "").trim().split(/\s+/)[0];
  return first ? `Hello ${first},` : "Hello,";
}

export function outreachSubject(): string {
  // Says what it is, does not shout, and reads the same in a preview pane as in the inbox list.
  return "A small idea from a local charity";
}

export function buildOutreachEmailText(input: OutreachInvitation): string {
  const personal = (input.personalMessage ?? "").trim();
  return `${greeting(input)}

I am writing from the Night Before Christmas Campaign, a volunteer led charity here
in Ayrshire. We are here all year for children, young people and vulnerable adults
across South West Scotland, with school clothing and crisis support whenever it is
needed, and every December a full bag for those who would otherwise wake up on
Christmas morning with nothing to open.
${personal ? `\n${personal}\n` : ""}
I wondered whether ${input.businessName} might consider becoming one of our business
supporters. A regular monthly gift, at whatever level suits you, could help us plan
ahead rather than hope. Businesses that support us are listed on our website, receive
a certificate for the wall, and get a proper thank you from us on social media.

There is a short booklet here that explains what we do and where the money goes:
${input.bookletUrl}

And if you would like to start today, this is the page:
${input.donateUrl}

If you would rather we did not contact you again, just reply and say so and we will
make sure of it. And if you would simply like a chat first, reply to this email and
it comes straight to us, or call ${PHONE}, Monday to Friday.

Thank you for reading this far.

${input.signerName}
${input.signerRole}
${PHONE}
${CONTACT_EMAIL}

${FOOTER_TEXT}`;
}

export function buildOutreachEmailHtml(input: OutreachInvitation): string {
  const personal = (input.personalMessage ?? "").trim();

  // The volunteer's own words, given room and a quiet rule beside them so they read as a note
  // rather than another paragraph of the same letter. Line breaks are honoured because people
  // type them; everything else is escaped.
  const personalHtml = personal
    ? `<tr><td style="padding:0 32px 20px;">
        <div style="border-left:3px solid ${CRIMSON};padding:2px 0 2px 16px;color:${SLATE};font-size:16px;line-height:1.7;font-style:italic;">
          ${escapeHtml(personal).replace(/\r?\n/g, "<br />")}
        </div>
      </td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- color-scheme: light keeps the maroon and cream from being inverted in dark-mode clients. -->
<meta name="color-scheme" content="light" />
<title>${escapeHtml(outreachSubject())}</title>
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
          A small idea from a local charity
        </h1>
      </td></tr>

      <tr><td style="padding:0 32px 16px;font-family:${BODY};color:${SLATE};font-size:16px;line-height:1.7;">
        <p style="margin:0 0 16px;">${escapeHtml(greeting(input))}</p>
        <p style="margin:0 0 16px;">
          I am writing from the <b>Night Before Christmas Campaign</b>, a volunteer led charity here in
          Ayrshire. We are here all year for children, young people and vulnerable adults across South
          West Scotland, with school clothing and crisis support whenever it is needed, and every
          December a full bag for those who would otherwise wake up on Christmas morning with nothing
          to open.
        </p>
      </td></tr>

      ${personalHtml}

      <tr><td style="padding:0 32px 16px;font-family:${BODY};color:${SLATE};font-size:16px;line-height:1.7;">
        <p style="margin:0 0 16px;">
          I wondered whether <b>${escapeHtml(input.businessName)}</b> might consider becoming one of our
          business supporters. A regular monthly gift, at whatever level suits you, could help us plan
          ahead rather than hope. Businesses that support us are listed on our website, receive a
          certificate for the wall, and get a proper thank you from us on social media.
        </p>
        <p style="margin:0 0 24px;">
          There is a <a href="${escapeHtml(input.bookletUrl)}" style="color:${MAROON};font-weight:600;">short booklet here</a>
          that explains what we do and where the money goes.
        </p>
      </td></tr>

      <tr><td align="center" style="padding:0 32px 28px;">
        <a href="${escapeHtml(input.donateUrl)}"
           style="display:inline-block;background:${CRIMSON};color:#FFFFFF;font-family:${BODY};font-size:16px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:999px;">
          Become a supporter
        </a>
      </td></tr>

      <tr><td style="padding:0 32px 24px;font-family:${BODY};color:${SLATE};font-size:16px;line-height:1.7;">
        <p style="margin:0 0 16px;">
          If you would rather we did not contact you again, just reply and say so and we will make sure
          of it. And if you would simply like a chat first, reply to this email and it comes straight
          to us, or call <a href="tel:${PHONE_TEL}" style="color:${MAROON};font-weight:600;">${PHONE}</a>,
          Monday to Friday.
        </p>
        <p style="margin:0 0 4px;">Thank you for reading this far.</p>
        <p style="margin:16px 0 0;font-weight:600;">${escapeHtml(input.signerName)}</p>
        <p style="margin:0 0 10px;color:${SLATE_SOFT};font-size:14px;">${escapeHtml(input.signerRole)}</p>
        <p style="margin:0;font-size:14px;">
          <a href="tel:${PHONE_TEL}" style="color:${MAROON};font-weight:600;">${PHONE}</a>
          <span style="color:${SLATE_SOFT};">&nbsp;&nbsp;</span>
          <a href="mailto:${CONTACT_EMAIL}" style="color:${MAROON};font-weight:600;">${CONTACT_EMAIL}</a>
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

export function buildOutreachEmail(input: OutreachInvitation): BuiltEmail {
  return {
    subject: outreachSubject(),
    html: buildOutreachEmailHtml(input),
    text: buildOutreachEmailText(input),
  };
}
