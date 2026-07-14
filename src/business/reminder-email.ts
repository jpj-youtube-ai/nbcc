// TASK-222: pure, branded business-supporter thank-you REMINDER email builder. When a business
// supporter has not yet chosen how they would like to be thanked, the daily runner nudges them
// twice: a warm 5-day reminder (stage 1) and a gentle 14-day last note (stage 2). Both carry the
// SAME private link to the token-gated /business/thank-you page (TASK-212) that the original invite
// (TASK-213) sent. DB-free and config-free (CLAUDE.md golden rule 5): given the business name, the
// public site base, the fulfilment record's token and which stage is due, it returns { subject,
// html, text }.
//
// It mirrors the approved NBCC email family (src/thank-you/letter.ts / src/business/invite-email.ts):
// the same maroon letterhead, cream body, maroon contact/legal footer (so it carries the phone +
// giving@ details), color-scheme:light meta so dark-mode clients don't invert it, the Playfair +
// Poppins stacks with serif/sans fallbacks, and the logo by absolute URL. letter.ts keeps its shell +
// palette module-private, so — exactly as invite-email.ts already does — we MIRROR the shared document
// structure here rather than refactor the approved letter. The tokenised link is built with the same
// businessThankYouLink helper the invite uses, so a reminder points at the same page on the same base.
//
// COPY RULES (task constraints): warm, grateful, low-pressure "just checking in" for ALL bands (not
// only platinum); ONE clear crimson call to action to the private thank-you page; non-definitive
// impact language ("could help", never "£X provides Y" — Code of Fundraising Practice); and NO dashes
// of any kind (em, en or hyphen) anywhere in the human copy. The CSS and the URL may contain hyphens
// (they are not copy). The 14-day note (stage 2) is a touch more "last nudge, no pressure" than the
// 5-day one (stage 1); both stay warm and gentle.

import { businessThankYouLink } from "./invite-email";

// Brand palette (hex mirrors of the CSS tokens; inlined because email has no stylesheet).
const MAROON = "#800000";
const CRIMSON = "#C02238";
const CREAM = "#F8F5EE";
const SLATE = "#333333";
const CREAM_82 = "rgba(248,245,238,.82)";

// Font stacks mirror the site tokens (--font-head / --font-body); web fonts don't load in email, so
// these fall back to the serif/sans the mockup's own stacks name.
const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
const BODY = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
// The real logo needs an ABSOLUTE URL in email (relative paths don't resolve in a mail client).
const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

// Minimal HTML escaping for the caller-supplied business name. Ampersand first so we don't
// double-escape the entities we introduce (mirrors invite-email.ts escapeHtml).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Which reminder is being sent: 1 = the 5-day nudge, 2 = the 14-day last note.
export type ReminderStage = 1 | 2;

export interface BusinessSupporterReminder {
  subject: string;
  html: string;
  text: string;
}

// The per-stage copy. Both stages share the gratitude opener, the non-definitive impact line and the
// single CTA; they differ only in the "checking in" (stage 1) vs "gentle last note" (stage 2) framing.
// Every string here is dash-free (task copy constraint).
interface StageCopy {
  subject: (name: string) => string;
  subhead: string; // the reassuring line under the greeting
  intro: string; // the "checking in" / "last note" paragraph
  closing: string; // the CTA lead-in paragraph
}

// Shared, stage-independent copy. GRATITUDE explains WHY they are being thanked (a monthly business
// supporter); IMPACT is deliberately non-definitive ("could help provide").
const GRATITUDE =
  "Thank you once again for being a monthly business supporter of the Night Before Christmas Campaign. Your ongoing support means a great deal to us, and to the children, young people and vulnerable adults we are here for across South West Scotland.";
const IMPACT =
  "Your monthly support could help provide Red Bags Full of Joy: thoughtful presents that bring dignity, comfort and a moment of joy at Christmas.";
const CTA_LABEL = "Choose how we thank you";

const STAGE_COPY: Record<ReminderStage, StageCopy> = {
  1: {
    subject: (name) => `Just checking in, ${name}`,
    subhead: "We would still love to thank you properly.",
    intro:
      "We wrote to you recently with a private link to choose how you would like us to say thank you, and we wanted to gently check it reached you. Whenever you have a spare moment, we would love to know how we can celebrate your business.",
    closing:
      "There is no rush at all. Whenever you are ready, just follow your private link below. It is unique to your business, so please keep it safe.",
  },
  2: {
    subject: (name) => `One last little note, ${name}`,
    subhead: "Whenever the time is right, we are here.",
    intro:
      "This is just a gentle last note about choosing how you would like us to thank you. There is truly no pressure, and your private link will always be here for whenever the moment feels right for you.",
    closing:
      "If you would like to, simply follow your private link below. It is unique to your business, so please keep it safe.",
  },
};

// Assemble the full, self-contained reminder email for the given stage. `businessName` is the
// greeting name the caller resolved (business_name, falling back to the donor's full_name — always a
// non-empty name, as the /business/thank-you page does). The tokenised link is built here from the
// base + token so the whole email, link included, is unit-testable from one pure call.
export function buildBusinessSupporterReminderEmail(input: {
  businessName: string;
  baseUrl: string;
  token: string;
  stage: ReminderStage;
}): BusinessSupporterReminder {
  const copy = STAGE_COPY[input.stage];
  const name = input.businessName;
  const link = businessThankYouLink(input.baseUrl, input.token);
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(link);
  const subject = copy.subject(name);

  const bodyP = (html: string) =>
    `<p style="color:${SLATE};font-family:${BODY};font-size:14px;line-height:1.6;margin:0 0 11px">${html}</p>`;

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- color-scheme: light keeps the maroon/cream palette in dark-mode mail clients (no auto-invert). -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>:root { color-scheme: light; supported-color-schemes: light; }</style>
</head>
<body style="margin:0;background:${MAROON};padding:24px 0;font-family:${BODY}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:${CREAM}">
    <tr><td style="padding:30px 40px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;font-family:${BODY};font-weight:700;color:${MAROON};font-size:14px;line-height:1.5">Night Before Christmas Campaign</td>
        <td style="vertical-align:middle;text-align:right">
          <img src="${LOGO_URL}" alt="Night Before Christmas Campaign" width="150" style="display:inline-block;height:auto;max-width:150px" />
          <div style="font-family:${BODY};font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:${MAROON};font-size:13px;margin-top:2px">Here all year</div>
        </td>
      </tr></table>
      <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:22px 0 6px;letter-spacing:-.01em">Hello again, ${safeName}.</h1>
      <p style="color:${MAROON};font-family:${HEAD};font-weight:700;font-size:18px;margin:0 0 14px">${copy.subhead}</p>
      ${bodyP(GRATITUDE)}
      ${bodyP(copy.intro)}
      ${bodyP(IMPACT)}
      ${bodyP(copy.closing)}
      <div style="text-align:center;margin:22px 0 6px">
        <a href="${safeLink}" style="display:inline-block;background:${CRIMSON};color:${CREAM};text-decoration:none;font-family:${BODY};font-weight:700;font-size:16px;padding:13px 30px;border-radius:999px">${CTA_LABEL}</a>
      </div>
      <div style="margin-top:18px">
        <p style="color:${SLATE};font-family:${BODY};font-size:14px;margin:0">With warmest thanks,</p>
        <p style="color:${MAROON};font-family:${HEAD};font-weight:700;font-size:16px;margin:2px 0 0">The Night Before Christmas Campaign team</p>
      </div>
    </td></tr>
    <tr><td style="background:${MAROON};color:${CREAM};padding:20px 40px;font-family:${BODY};font-size:14px;text-align:center">
      <div style="font-weight:700"><a href="tel:+441292811015" style="color:${CREAM};text-decoration:none">01292 811 015</a> &nbsp;·&nbsp; <a href="mailto:giving@nbcc.scot" style="color:${CREAM};text-decoration:underline">giving@nbcc.scot</a> &nbsp;·&nbsp; <a href="https://nbcc.scot" style="color:${CREAM};text-decoration:underline">nbcc.scot</a></div>
      <div style="color:${CREAM_82};font-size:11px;margin-top:8px">Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.</div>
    </td></tr>
  </table>
</body>
</html>`;

  // The plain-text alternative, sharing the same dash-free copy so the two parts never drift.
  const text = [
    `Hello again, ${name}.`,
    "",
    copy.subhead,
    "",
    GRATITUDE,
    "",
    copy.intro,
    "",
    IMPACT,
    "",
    `${CTA_LABEL}:`,
    link,
    "This link is unique to your business, so please keep it safe.",
    "",
    "With warmest thanks,",
    "The Night Before Christmas Campaign team",
    "",
    "01292 811 015 · giving@nbcc.scot · nbcc.scot",
    "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.",
  ].join("\n");

  return { subject, html, text };
}
