// TASK-221: the pure, branded "here is what you chose" CONFIRMATION email a business supporter gets
// after they submit their recognition choices on the thank-you page (whether from the new inline form
// on /donate/thank-you or the emailed token link on /business/thank-you — both capture through
// postFulfilment). DB-free and config-free (CLAUDE.md golden rule 5): given the business name, the
// band's perks, the captured choices, the fulfilment token and the public site base, it returns
// { subject, html, text }. The send + its best-effort trigger live in src/routes/business.ts.
//
// It mirrors the approved NBCC email family (src/thank-you/letter.ts buildThankYouEmailHtml and
// src/business/invite-email.ts): the same maroon letterhead, cream body, maroon contact/legal footer,
// color-scheme:light meta so dark-mode clients don't invert it, the Playfair + Poppins stacks with
// serif/sans fallbacks, and the logo by absolute URL. letter.ts keeps its shell module-private, so —
// as invite-email.ts already does — we MIRROR the same document structure here rather than refactor the
// approved letter. Brand colours are inlined as hex (the token values in assets/css/styles.css) because
// email clients don't load the site stylesheet.
//
// COPY RULES (task constraints): warm, appreciative and genuine; it LISTS the supporter's chosen
// recognition options in plain language; it carries the download links they are entitled to (the
// certificate and badge, gated exactly as the on-page confirmation is); non-definitive impact language
// ("could help", never "£X provides Y" — Code of Fundraising Practice); and NO dashes of any kind (em,
// en or hyphen) anywhere in the human copy. The CSS and URLs may contain hyphens (they are not copy).

import type { BandPerks } from "../donors/fulfilment";

// Brand palette (hex mirrors of the CSS tokens; inlined because email has no stylesheet).
const MAROON = "#800000";
const CRIMSON = "#C02238";
const CREAM = "#F8F5EE";
const SLATE = "#333333";
const TAN_SOFT = "#F3E4DD";
const CREAM_82 = "rgba(248,245,238,.82)";

// Font stacks mirror the site tokens (--font-head / --font-body); web fonts don't load in email.
const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
const BODY = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
// The real logo needs an ABSOLUTE URL in email (relative paths don't resolve in a mail client).
const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

// Minimal HTML escaping for caller-supplied values (business name, credit name, social handles).
// Ampersand first so we don't double-escape the entities we introduce (mirrors invite-email.ts).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Trim trailing slashes on a base URL so a built path never doubles up (mirrors businessThankYouLink).
function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

// The captured choices this email reflects. A structural subset of the stored FulfilmentPreferences
// (src/db/fulfilment.ts), so the resolved preferences object satisfies it directly — kept local so the
// builder imports no DB module and stays pure.
export interface CaptureConfirmationChoices {
  listOnSupporters: boolean;
  creditName: string | null;
  website: string | null;
  socials: string | null;
  wantSocial: boolean;
  wantBadge: boolean;
  wantCertificate: boolean;
  certificateDelivery: "download" | "post" | null;
}

export interface CaptureConfirmationInput {
  businessName: string; // the greeting name (business_name, falling back to full_name)
  perks: BandPerks; // which recognition sections the band earns (what to reflect back)
  preferences: CaptureConfirmationChoices; // the resolved, stored choices
  token: string; // the fulfilment token (for the per-business certificate link)
  baseUrl: string; // the public site base (config.PORTAL_BASE_URL) for the absolute download links
}

export interface CaptureConfirmation {
  subject: string;
  html: string;
  text: string;
}

// The plain-language sentences describing the supporter's choices — shared verbatim between the HTML
// list and the text part so the two never drift. Mirrors renderConfirmation in
// assets/js/business-thankyou.js (the on-page confirmation), so the email and the page agree.
function choiceLines(perks: BandPerks, prefs: CaptureConfirmationChoices): string[] {
  const lines: string[] = [];
  if (prefs.listOnSupporters) {
    lines.push(
      prefs.creditName
        ? `We will show your business on our Supporters page as ${prefs.creditName}.`
        : "We will show your business on our Supporters page.",
    );
  } else {
    lines.push("We will keep your business details private.");
  }
  if (perks.socialThankYou) {
    if (prefs.wantSocial) {
      lines.push(
        prefs.socials
          ? `We will post a public thank you on Facebook and Instagram and tag ${prefs.socials}.`
          : "We will post a public thank you on Facebook and Instagram.",
      );
    } else {
      lines.push("No social media thank you, just as you asked.");
    }
  }
  if (perks.digitalBadge) {
    lines.push(prefs.wantBadge ? "Your digital supporter badge is ready." : "No digital badge, just as you asked.");
  }
  if (perks.certificate) {
    if (prefs.wantCertificate) {
      lines.push(
        prefs.certificateDelivery === "post"
          ? "We will post your certificate to you, and you can download it here too."
          : "Your certificate is ready to download.",
      );
    } else {
      lines.push("No certificate, just as you asked.");
    }
  }
  if (perks.newsletter) {
    lines.push("You will also receive our supporter newsletter, so you can see the difference your donation makes.");
  }
  return lines;
}

// The absolute download links the supporter is entitled to, gated EXACTLY as the on-page confirmation:
// the badge when the band earns it and they asked for it; the certificate likewise, on the per-business
// token link. Empty when they are entitled to none. Each carries a label + the absolute URL.
function downloadLinks(
  perks: BandPerks,
  prefs: CaptureConfirmationChoices,
  token: string,
  baseUrl: string,
): { label: string; url: string }[] {
  const base = trimBase(baseUrl);
  const links: { label: string; url: string }[] = [];
  if (perks.digitalBadge && prefs.wantBadge) {
    links.push({ label: "Download your badge", url: `${base}/assets/img/nbcc-supporter-badge.svg` });
  }
  if (perks.certificate && prefs.wantCertificate) {
    links.push({ label: "Download your certificate", url: `${base}/business/certificate/${encodeURIComponent(token)}` });
  }
  return links;
}

// Assemble the full, self-contained confirmation email. Pure over its inputs; the tokenised links are
// built here so the whole email is unit-testable from one call.
export function buildCaptureConfirmationEmail(input: CaptureConfirmationInput): CaptureConfirmation {
  const name = input.businessName;
  const safeName = escapeHtml(name);
  const subject = `You are all set, ${name}`;

  const choices = choiceLines(input.perks, input.preferences);
  const links = downloadLinks(input.perks, input.preferences, input.token, input.baseUrl);

  const bodyP = (html: string) =>
    `<p style="color:${SLATE};font-family:${BODY};font-size:14px;line-height:1.6;margin:0 0 11px">${html}</p>`;

  // Shared, dash-free copy carried verbatim into both parts.
  const p1 =
    "Thank you for telling us how you would like to be thanked. Your support means so much to a small, volunteer run charity, and to the children, young people and vulnerable adults we are here for across South West Scotland.";
  const p2 = "Here is what you chose:";
  const impact =
    "Your monthly support could help provide Red Bags Full of Joy, thoughtful presents that carry comfort, dignity and a moment of real joy at Christmas.";

  // Each choice as an escaped list item (the sentences may carry the escaped credit name / handles).
  const listItems = choices.map((c) => `<li style="margin:0 0 6px">${escapeHtml(c)}</li>`).join("");

  const linkButtons = links.length
    ? `<div style="text-align:center;margin:20px 0 6px">${links
        .map(
          (l) =>
            `<a href="${escapeHtml(l.url)}" style="display:inline-block;background:${CRIMSON};color:${CREAM};text-decoration:none;font-family:${BODY};font-weight:700;font-size:15px;padding:12px 26px;border-radius:999px;margin:6px 6px">${escapeHtml(l.label)}</a>`,
        )
        .join("")}</div>` +
      bodyP("We have also emailed these links here, so you can always come back to them later.")
    : "";

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
      <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:22px 0 6px;letter-spacing:-.01em">You are all set. Thank you, ${safeName}.</h1>
      <p style="color:${MAROON};font-family:${HEAD};font-weight:700;font-size:18px;margin:0 0 14px">We are on it now, and we could not be more grateful.</p>
      ${bodyP(p1)}
      ${bodyP(`<strong>${escapeHtml(p2)}</strong>`)}
      <ul style="color:${SLATE};font-family:${BODY};font-size:14px;line-height:1.6;margin:0 0 14px;padding-left:20px">${listItems}</ul>
      <p style="background:${TAN_SOFT};border-left:4px solid ${CRIMSON};border-radius:0 8px 8px 0;padding:12px 18px;margin:6px 0 16px;font-family:${BODY};font-size:14px;color:${SLATE}">${escapeHtml(impact)}</p>
      ${linkButtons}
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

  const textLinks = links.length
    ? ["", "Your download links:", ...links.map((l) => `${l.label}: ${l.url}`)]
    : [];

  const text = [
    `You are all set. Thank you, ${name}.`,
    "",
    p1,
    "",
    p2,
    // Each choice is a full sentence; listed one per line with NO bullet so the plain-text copy stays
    // free of dashes (task copy constraint).
    ...choices,
    "",
    impact,
    ...textLinks,
    "",
    "With warmest thanks,",
    "The Night Before Christmas Campaign team",
    "",
    "01292 811 015 · giving@nbcc.scot · nbcc.scot",
    "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.",
  ].join("\n");

  return { subject, html, text };
}
