// TASK-163 (REQ-069): pure, branded thank-you letter → HTML email builder.
// DB-free and config-free (CLAUDE.md rule 5): the admin composes a letter in the
// "Thank you" view, and this assembles the same content as a self-contained HTML
// email. Email clients don't load the site stylesheet, so brand colours are inlined
// as hex (the values of the --maroon/--crimson/etc. tokens in assets/css/styles.css).
// The transactional send + audit live in src/db/thank-you.ts and src/routes/admin.ts
// and are exercised via BDD.
import { formatGiftAmount, giftAidUpliftPence } from "./model";

// The presentation view of a thank-you letter. It mirrors ThankYouInput's letter
// fields, plus the two presentation-only values the route supplies: a formatted
// letter date (the send date) and the signer's role (not stored on the row).
export interface ThankYouLetterView {
  thankYouName: string; // "Thank you, <name>."
  addressedTo: string; // "Dear <name>,"
  giftType: "money" | "in_kind";
  giftAmountPence: number | null;
  giftInKind: string | null;
  giftAided: boolean;
  personalMessage: string | null;
  signedByName: string;
  signedByRole: string | null;
  letterDate: string; // e.g. "25 December 2026" — preformatted by the caller
}

// Brand palette (hex mirrors of the CSS tokens; inlined because email has no stylesheet).
const MAROON = "#800000";
const CRIMSON = "#C02238";
const CREAM = "#F8F5EE";
const SLATE = "#333333";
const SLATE_SOFT = "#6F6A66";
const TAN_SOFT = "#F3E4DD";
const HOLLY_DARK = "#123C12";

// Minimal HTML escaping for donor-supplied fields. Ampersand first so we don't
// double-escape the entities we introduce.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The email subject: "Thank you, <name>" (plain text, not HTML).
export function thankYouSubject(input: { thankYouName: string }): string {
  return `Thank you, ${input.thankYouName}`;
}

// The gift line + (for a Gift-Aided money gift) the 25% HMRC uplift note.
function giftCallout(v: ThankYouLetterView): string {
  if (v.giftType === "in_kind") {
    const items = escapeHtml(v.giftInKind ?? "your kind donation");
    return `<p style="background:${TAN_SOFT};border-left:4px solid ${CRIMSON};border-radius:0 8px 8px 0;padding:12px 18px;margin:6px 0 14px;color:${SLATE}">With heartfelt thanks for your donation of <b style="color:${MAROON}">${items}</b>.</p>`;
  }
  const amount = formatGiftAmount(v.giftAmountPence ?? 0);
  let note = "";
  if (v.giftAided) {
    const worth = formatGiftAmount((v.giftAmountPence ?? 0) + giftAidUpliftPence(v.giftAmountPence ?? 0));
    note = `<span style="display:block;margin-top:6px;font-size:14px;color:${HOLLY_DARK}">Because you Gift Aided it, HMRC adds 25%, making your gift worth <b>${worth}</b> to our work, at no extra cost to you.</span>`;
  }
  return `<p style="background:${TAN_SOFT};border-left:4px solid ${CRIMSON};border-radius:0 8px 8px 0;padding:12px 18px;margin:6px 0 14px;color:${SLATE}">With heartfelt thanks for your gift of <b style="color:${MAROON}">${amount}</b>.${note}</p>`;
}

// Assemble the full, self-contained HTML email for one thank-you letter.
export function buildThankYouEmailHtml(v: ThankYouLetterView): string {
  const title = `Thank you, ${escapeHtml(v.thankYouName)}.`;
  const salutation = `Dear ${escapeHtml(v.addressedTo)},`;
  const personal = v.personalMessage
    ? `<p style="font-style:italic;color:${MAROON};margin:0 0 14px;line-height:1.5">${escapeHtml(v.personalMessage)}</p>`
    : "";
  const role = v.signedByRole
    ? `<div style="color:${SLATE_SOFT};font-size:13px">${escapeHtml(v.signedByRole)}</div>`
    : "";

  return `<!doctype html>
<html lang="en-GB">
<body style="margin:0;background:${MAROON};padding:24px 0;font-family:Georgia,'Times New Roman',serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:${CREAM};border-radius:6px">
    <tr><td style="padding:32px 36px 24px">
      <div style="color:${SLATE_SOFT};font-size:14px;margin-bottom:8px">${escapeHtml(v.letterDate)}</div>
      <h1 style="color:${CRIMSON};font-size:26px;font-weight:800;margin:0 0 6px;letter-spacing:-.01em">${title}</h1>
      <p style="color:${MAROON};font-weight:700;font-size:17px;margin:0 0 16px">${salutation}</p>
      <p style="color:${SLATE};font-size:15px;line-height:1.6;margin:0 0 12px">On behalf of everyone at the Night Before Christmas Campaign, thank you. Your generosity means children, young people and vulnerable adults across South West Scotland will know they have not been forgotten this Christmas.</p>
      ${giftCallout(v)}
      ${personal}
      <p style="color:${SLATE};font-size:15px;line-height:1.6;margin:0 0 12px">Gifts like yours become Red Bags Full of Joy: thoughtful presents that bring dignity, comfort and a moment of joy. We are volunteer-run and here all year round, not just at Christmas.</p>
      <div style="margin-top:20px">
        <p style="color:${SLATE};font-size:15px;margin:0 0 6px">With warmest thanks,</p>
        <div style="color:${CRIMSON};font-size:20px;font-weight:700">${escapeHtml(v.signedByName)}</div>
        ${role}
      </div>
    </td></tr>
    <tr><td style="background:${MAROON};color:${CREAM};padding:18px 36px;font-family:Arial,Helvetica,sans-serif;font-size:13px;text-align:center;border-radius:0 0 6px 6px">
      <div style="font-weight:700">01292 811 015 &nbsp;·&nbsp; giving@nbcc.scot &nbsp;·&nbsp; nbcc.scot</div>
      <div style="opacity:.82;font-size:11px;margin-top:8px">Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.</div>
    </td></tr>
  </table>
</body>
</html>`;
}
