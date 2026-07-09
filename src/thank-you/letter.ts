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
  printUrl?: string; // the public print-your-letter page URL; adds a "View & print" button when set
}

// Brand palette (hex mirrors of the CSS tokens; inlined because email has no stylesheet).
const MAROON = "#800000";
const CRIMSON = "#C02238";
const CREAM = "#F8F5EE";
const SLATE = "#333333";
const SLATE_SOFT = "#6F6A66";
const TAN_SOFT = "#F3E4DD";
const HOLLY_DARK = "#123C12";
const CREAM_82 = "rgba(248,245,238,.82)";

// Font stacks mirror the site tokens (--font-head / --font-body). Web fonts don't load in email,
// so these fall back to the serif/sans the mockup's own stacks name.
const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
const BODY = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
// The script signature stack, matching assets/thankyou-letter-print.html (system cursive fallback).
const SCRIPT = "'Snell Roundhand','Palace Script MT','Edwardian Script ITC','Apple Chancery','Lucida Calligraphy','Lucida Handwriting',cursive";
// The real logo needs an ABSOLUTE URL in email (relative paths don't resolve in a mail client).
const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";
// The fixed NBCC letterhead sender (as in the mockup).
const SENDER_LINES = ["Elves Workshop", "Annbank Village Hall", "Weston Avenue", "Annbank", "KA6 5EE"];

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

// A "View & print your letter" button (centred), added when the caller supplies the print-page URL.
function printButton(url: string | undefined): string {
  if (!url) return "";
  const href = escapeHtml(url);
  return `<div style="text-align:center;margin-top:18px"><a href="${href}" style="display:inline-block;background:${CRIMSON};color:${CREAM};text-decoration:none;font-family:${BODY};font-weight:700;font-size:15px;padding:11px 24px;border-radius:999px">View &amp; print your letter</a></div>`;
}

// The plain-text alternative of the letter. Sending a text/plain part alongside the HTML materially
// improves deliverability (HTML-only mail scores as more spam-like). Mirrors the letter's wording.
export function buildThankYouEmailText(v: ThankYouLetterView): string {
  const lines: string[] = [];
  lines.push(v.letterDate, "", `Thank you, ${v.thankYouName}.`, "", `Dear ${v.addressedTo},`, "");
  lines.push(
    "On behalf of everyone at the Night Before Christmas Campaign, thank you. Your generosity means children, young people and vulnerable adults across South West Scotland will know they have not been forgotten this Christmas.",
    "",
  );
  if (v.giftType === "in_kind") {
    lines.push(`With heartfelt thanks for your donation of ${v.giftInKind ?? "your kind donation"}.`);
  } else {
    const amount = formatGiftAmount(v.giftAmountPence ?? 0);
    lines.push(`With heartfelt thanks for your gift of ${amount}.`);
    if (v.giftAided) {
      const worth = formatGiftAmount((v.giftAmountPence ?? 0) + giftAidUpliftPence(v.giftAmountPence ?? 0));
      lines.push(`Because you Gift Aided it, HMRC adds 25%, making your gift worth ${worth} to our work, at no extra cost to you.`);
    }
  }
  lines.push("");
  if (v.personalMessage) lines.push(v.personalMessage, "");
  lines.push(
    "Gifts like yours become Red Bags Full of Joy: thoughtful presents that bring dignity, comfort and a moment of joy. In 2025 our volunteers delivered 7,657 of them across South West Scotland, and the need grows every year.",
    "",
    "We are volunteer-run and here all year round, not just at Christmas. If you would like to fundraise, volunteer, or ask a question, reply to this letter or call the number below.",
    "",
    "With warmest thanks,",
    v.signedByName,
  );
  if (v.signedByRole) lines.push(v.signedByRole);
  if (v.printUrl) lines.push("", `View & print your letter: ${v.printUrl}`);
  lines.push(
    "",
    "How you can donate: nbcc.scot/donate",
    "",
    "01292 811 015 · giving@nbcc.scot · nbcc.scot",
    "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.",
  );
  return lines.join("\n");
}

// The gift line + (for a Gift-Aided money gift) the 25% HMRC uplift note.
function giftCallout(v: ThankYouLetterView): string {
  const wrap = (inner: string) =>
    `<p style="background:${TAN_SOFT};border-left:4px solid ${CRIMSON};border-radius:0 8px 8px 0;padding:12px 18px;margin:6px 0 16px;font-family:${BODY};font-size:15px;color:${SLATE}">${inner}</p>`;
  if (v.giftType === "in_kind") {
    const items = escapeHtml(v.giftInKind ?? "your kind donation");
    return wrap(`With heartfelt thanks for your donation of <b style="color:${MAROON}">${items}</b>.`);
  }
  const amount = formatGiftAmount(v.giftAmountPence ?? 0);
  let note = "";
  if (v.giftAided) {
    const worth = formatGiftAmount((v.giftAmountPence ?? 0) + giftAidUpliftPence(v.giftAmountPence ?? 0));
    note = `<span style="display:block;margin-top:6px;font-size:13px;color:${HOLLY_DARK}">Because you Gift Aided it, HMRC adds 25%, making your gift worth <b style="color:${HOLLY_DARK}">${worth}</b> to our work, at no extra cost to you.</span>`;
  }
  return wrap(`With heartfelt thanks for your gift of <b style="color:${MAROON}">${amount}</b>.${note}`);
}

// Assemble the full, self-contained HTML email for one thank-you letter. Mirrors the design of
// assets/thankyou-letter-print.html: logo lockup, letterhead, script-signature sign-off, pull-quote,
// donate CTA and the maroon contact/legal bar. Email constraints vs. the on-screen letter: fonts fall
// back to serif/sans (no web fonts in mail), the logo loads by absolute URL, and the footer contacts
// are text (the mockup's circular SVG icons are stripped by many mail clients, so they're omitted).
export function buildThankYouEmailHtml(v: ThankYouLetterView): string {
  const title = `Thank you, ${escapeHtml(v.thankYouName)}.`;
  const salutation = `Dear ${escapeHtml(v.addressedTo)},`;
  const sender = SENDER_LINES.map(escapeHtml).join("<br>");
  const bodyP = (html: string) =>
    `<p style="color:${SLATE};font-family:${BODY};font-size:14px;line-height:1.6;margin:0 0 11px">${html}</p>`;
  const personal = v.personalMessage
    ? `<p style="font-family:${HEAD};font-style:italic;color:${MAROON};font-size:15px;line-height:1.45;margin:0 0 12px">${escapeHtml(v.personalMessage)}</p>`
    : "";
  const role = v.signedByRole
    ? `<div style="color:${SLATE_SOFT};font-family:${BODY};font-size:12px">${escapeHtml(v.signedByRole)}</div>`
    : "";

  return `<!doctype html>
<html lang="en-GB">
<body style="margin:0;background:${MAROON};padding:24px 0;font-family:${BODY}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:${CREAM}">
    <tr><td style="padding:30px 40px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;font-family:${BODY};font-weight:700;color:${MAROON};font-size:14px;line-height:1.5">${sender}</td>
        <td style="vertical-align:middle;text-align:right">
          <img src="${LOGO_URL}" alt="Night Before Christmas Campaign" width="150" style="display:inline-block;height:auto;max-width:150px" />
          <div style="font-family:${BODY};font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:${MAROON};font-size:13px;margin-top:2px">Here all year</div>
        </td>
      </tr></table>
      <div style="color:${SLATE};font-family:${BODY};font-weight:700;font-size:13px;margin:22px 0 14px">${escapeHtml(v.letterDate)}</div>
      <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:0 0 6px;letter-spacing:-.01em">${title}</h1>
      <p style="color:${MAROON};font-family:${HEAD};font-weight:700;font-size:18px;margin:0 0 14px">${salutation}</p>
      ${bodyP("On behalf of everyone at the Night Before Christmas Campaign, thank you. Your generosity means children, young people and vulnerable adults across South West Scotland will know they have not been forgotten this Christmas.")}
      ${giftCallout(v)}
      ${personal}
      ${bodyP("Gifts like yours become Red Bags Full of Joy: thoughtful presents that bring dignity, comfort and a moment of joy. In 2025 our volunteers delivered 7,657 of them across South West Scotland, and the need grows every year.")}
      ${bodyP("We are volunteer-run and here all year round, not just at Christmas. If you would like to fundraise, volunteer, or ask a question, reply to this letter or call the number below.")}
      <div style="margin-top:18px">
        <p style="color:${SLATE};font-family:${BODY};font-size:14px;margin:0">With warmest thanks,</p>
        <div style="font-family:${SCRIPT};color:${CRIMSON};font-size:30px;line-height:1.15;margin-top:2px">${escapeHtml(v.signedByName)}</div>
        ${role}
      </div>
      <p style="font-family:${HEAD};font-style:italic;color:${CRIMSON};text-align:center;font-size:17px;line-height:1.3;margin:22px auto 14px">&ldquo;How do we change the world?<br>One random act of kindness at a time.&rdquo;</p>
      <div style="text-align:center;margin-bottom:6px">
        <span style="font-family:${BODY};text-transform:uppercase;letter-spacing:.18em;font-size:11px;font-weight:600;color:${CRIMSON};display:block;margin-bottom:4px">How you can donate</span>
        <span style="font-family:${BODY};font-weight:700;color:${MAROON};font-size:17px">Go to <b style="color:${CRIMSON}">nbcc.scot/donate</b></span>
      </div>
      ${printButton(v.printUrl)}
    </td></tr>
    <tr><td style="background:${MAROON};color:${CREAM};padding:20px 40px;font-family:${BODY};font-size:14px;text-align:center">
      <div style="font-weight:700">01292 811 015 &nbsp;·&nbsp; giving@nbcc.scot &nbsp;·&nbsp; nbcc.scot</div>
      <div style="color:${CREAM_82};font-size:11px;margin-top:8px">Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.</div>
    </td></tr>
  </table>
</body>
</html>`;
}
