// TASK-213: pure, branded business-supporter thank-you INVITE email builder. This is the email that
// carries the PRIVATE link to the token-gated /business/thank-you page (TASK-212) — without it the
// page is unreachable. DB-free and config-free (CLAUDE.md golden rule 5): given the business name, the
// public site base and the fulfilment record's token, it returns { subject, html, text }.
//
// It mirrors the approved NBCC email family in src/thank-you/letter.ts (buildThankYouEmailHtml): the
// same maroon letterhead, cream body, maroon contact/legal footer, color-scheme:light meta so
// dark-mode clients don't invert it, the Playfair + Poppins stacks with serif/sans fallbacks, and the
// logo by absolute URL. letter.ts keeps its shell + palette module-private (it builds a whole letter,
// not a reusable shell), so per the task we MIRROR the same document structure here rather than
// refactor the approved letter — the invite is visually identical but with its own invite copy + CTA.
// Brand colours are inlined as hex (the --maroon/--crimson/… token values in assets/css/styles.css)
// because email clients don't load the site stylesheet.
//
// COPY RULES (task constraints): warm, appreciative, genuine and confident; ONE clear crimson call to
// action to the private thank-you page; non-definitive impact language ("could help", never
// "£X provides Y" — Code of Fundraising Practice); and NO dashes of any kind (em, en or hyphen)
// anywhere in the human copy. The CSS and the URL may contain hyphens (they are not copy).

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
// double-escape the entities we introduce (mirrors letter.ts escapeHtml).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Build the tokenised private thank-you page URL on the PUBLIC site base. Mirrors portalMagicLink
// (src/portal/tokens.ts): trims trailing slashes on the base and URL-encodes the token. Because the
// base is passed in (the caller reads config.PORTAL_BASE_URL), the link is env-correct — a staging
// base yields a staging link, a production base a production link. Pure — no pool/config/clock.
export function businessThankYouLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/business/thank-you?token=${encodeURIComponent(token)}`;
}

export interface BusinessSupporterInvite {
  subject: string;
  html: string;
  text: string;
}

// Assemble the full, self-contained invite email. `businessName` is the greeting name the caller
// resolved (the business_name, falling back to the donor's full_name — always a non-empty name, as
// the /business/thank-you page does). The tokenised link is built here from the base + token so the
// whole email, link included, is unit-testable from one pure call.
export function buildBusinessSupporterInviteEmail(input: {
  businessName: string;
  baseUrl: string;
  token: string;
}): BusinessSupporterInvite {
  const name = input.businessName;
  const link = businessThankYouLink(input.baseUrl, input.token);
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(link);
  const subject = `Thank you for standing with us, ${name}`;

  const bodyP = (html: string) =>
    `<p style="color:${SLATE};font-family:${BODY};font-size:14px;line-height:1.6;margin:0 0 11px">${html}</p>`;

  // The four body paragraphs, shared verbatim between the HTML and text parts so the two never drift
  // (and the plain-text copy carries the same dash-free wording).
  const p1 =
    "Thank you for becoming a monthly business supporter of the Night Before Christmas Campaign. Businesses like yours help a small, volunteer run charity do big things for children, young people and vulnerable adults right across South West Scotland.";
  const p2 =
    "We really want to thank you properly, and we would love you to choose how. From a place on our supporters page to a mention in our newsletter, there are some lovely ways to celebrate your business, and it is entirely your call.";
  const p3 =
    "Your monthly donation could help provide Red Bags Full of Joy, thoughtful presents that carry comfort, dignity and a moment of real joy at Christmas.";
  const p4 =
    "Just follow your private link below to choose how we say thank you. It is unique to your business, so please keep it somewhere safe.";

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
      <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:22px 0 6px;letter-spacing:-.01em">Thank you, ${safeName}.</h1>
      <p style="color:${MAROON};font-family:${HEAD};font-weight:700;font-size:18px;margin:0 0 14px">You have just become one of our business supporters, and we are so glad you are here.</p>
      ${bodyP(p1)}
      ${bodyP(p2)}
      ${bodyP(p3)}
      ${bodyP(p4)}
      <div style="text-align:center;margin:22px 0 6px">
        <a href="${safeLink}" style="display:inline-block;background:${CRIMSON};color:${CREAM};text-decoration:none;font-family:${BODY};font-weight:700;font-size:16px;padding:13px 30px;border-radius:999px">Choose how we thank you</a>
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

  const text = [
    `Thank you, ${name}.`,
    "",
    "You have just become one of our business supporters, and we are so glad you are here.",
    "",
    p1,
    "",
    p2,
    "",
    p3,
    "",
    "Choose how we say thank you here:",
    link,
    "This link is unique to your business, so please keep it somewhere safe.",
    "",
    "With warmest thanks,",
    "The Night Before Christmas Campaign team",
    "",
    "01292 811 015 · giving@nbcc.scot · nbcc.scot",
    "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.",
  ].join("\n");

  return { subject, html, text };
}
