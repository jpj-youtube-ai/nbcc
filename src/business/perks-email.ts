// TASK-441: the badge and certificate email, sent the next WEEKDAY MORNING rather than seconds
// after a business submits the thank-you form.
//
// Why it is its own email: the confirmation is a receipt and has to be instant, because somebody who
// fills in a form and hears nothing reasonably assumes it broke. The recognition itself is the part
// that benefits from looking considered. A business giving £100 a month getting their certificate
// back within seconds reads as a machine, because it was one.
//
// ON SOUNDING HUMAN. The brief was to make this feel like a person put it together, and it is
// written that way: it speaks in the first person plural, it refers to what THEY chose, and it does
// not announce itself as automatic. What it does NOT do is sign a named person's name to something
// nobody read, which is the line src/business/auto-thank-you.ts draws and it is the right one. Warm
// is a matter of how you write; a fake signature is just untrue.
//
// Pure and DB-free (golden rule 5). MIRRORS the approved NBCC email family rather than refactoring
// it (the same choice invite-email.ts and capture-confirmation-email.ts made): same maroon
// letterhead, cream body, maroon footer, color-scheme:light so dark-mode clients do not invert it,
// the Playfair + Poppins stacks, and the logo by absolute URL.
//
// COPY RULES, inherited from the family: warm and genuine; non-definitive impact language ("could
// help", never "£X provides Y" per the Code of Fundraising Practice); and NO dashes of any kind
// anywhere in the human copy.

const MAROON = "#800000";
const CRIMSON = "#C02238";
const CREAM = "#F8F5EE";
const SLATE = "#333333";
const TAN_SOFT = "#F3E4DD";
const CREAM_82 = "rgba(248,245,238,.82)";

const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
const BODY = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const trimBase = (base: string) => base.replace(/\/+$/, "");

export interface PerksDeliveryInput {
  businessName: string;
  wantBadge: boolean;
  wantCertificate: boolean;
  /** Posted certificates still carry the download, so they have it before the envelope lands. */
  certificateByPost: boolean;
  token: string;
  baseUrl: string;
}

export interface PerksDeliveryEmail {
  subject: string;
  html: string;
  text: string;
}

/** The links this supporter is owed, gated on what they actually asked for. */
export function perksLinks(input: PerksDeliveryInput): { label: string; url: string }[] {
  const base = trimBase(input.baseUrl);
  const links: { label: string; url: string }[] = [];
  if (input.wantBadge) {
    links.push({ label: "Download your badge", url: `${base}/assets/img/nbcc-supporter-badge.svg` });
  }
  if (input.wantCertificate) {
    links.push({
      label: "Download your certificate",
      url: `${base}/business/certificate/${encodeURIComponent(input.token)}`,
    });
  }
  return links;
}

/** What the email says it is carrying, in plain words, matching what they chose. */
export function perksLede(input: PerksDeliveryInput): string {
  if (input.wantBadge && input.wantCertificate) return "Your badge and your certificate are ready.";
  if (input.wantBadge) return "Your supporter badge is ready.";
  return "Your certificate is ready.";
}

export function buildPerksDeliveryEmail(input: PerksDeliveryInput): PerksDeliveryEmail {
  const safeName = escapeHtml(input.businessName);
  const links = perksLinks(input);
  const lede = perksLede(input);
  const subject = `${input.businessName}, here is your supporter ${
    input.wantBadge && input.wantCertificate
      ? "badge and certificate"
      : input.wantBadge
        ? "badge"
        : "certificate"
  }`;

  const bodyP = (html: string) =>
    `<p style="color:${SLATE};font-family:${BODY};font-size:14px;line-height:1.6;margin:0 0 11px">${html}</p>`;

  const p1 =
    "We have put these together for you, and we wanted to send them on properly rather than fire them straight back at you.";
  const p2 =
    "The badge is yours to use wherever you like, on your website, in your window or on social media. Please do put it somewhere people can see it, because it tells them you are one of the businesses keeping this going.";
  const posted = input.certificateByPost
    ? "Your printed certificate is on its way to you in the post as well. This is the same one, so you have it in the meantime."
    : "";
  const impact =
    "Your support could help provide Red Bags Full of Joy, thoughtful presents that carry comfort, dignity and a moment of real joy at Christmas.";

  const buttons = links.length
    ? `<div style="text-align:center;margin:20px 0 6px">${links
        .map(
          (l) =>
            `<a href="${escapeHtml(l.url)}" style="display:inline-block;background:${CRIMSON};color:${CREAM};text-decoration:none;font-family:${BODY};font-weight:700;font-size:15px;padding:12px 26px;border-radius:999px;margin:6px 6px">${escapeHtml(l.label)}</a>`,
        )
        .join("")}</div>`
    : "";

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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
      <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:22px 0 6px;letter-spacing:-.01em">${escapeHtml(lede)}</h1>
      <p style="color:${MAROON};font-family:${HEAD};font-weight:700;font-size:18px;margin:0 0 14px">Thank you again, ${safeName}.</p>
      ${bodyP(escapeHtml(p1))}
      ${input.wantBadge ? bodyP(escapeHtml(p2)) : ""}
      ${posted ? bodyP(escapeHtml(posted)) : ""}
      ${buttons}
      <p style="background:${TAN_SOFT};border-left:4px solid ${CRIMSON};border-radius:0 8px 8px 0;padding:12px 18px;margin:16px 0;font-family:${BODY};font-size:14px;color:${SLATE}">${escapeHtml(impact)}</p>
      ${bodyP("If anything is not right, or you would like the certificate in a different name, just reply to this email and we will sort it.")}
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
    lede,
    `Thank you again, ${input.businessName}.`,
    "",
    p1,
    ...(input.wantBadge ? ["", p2] : []),
    ...(posted ? ["", posted] : []),
    "",
    ...links.map((l) => `${l.label}: ${l.url}`),
    "",
    impact,
    "",
    "If anything is not right, or you would like the certificate in a different name, just reply to this email and we will sort it.",
    "",
    "With warmest thanks,",
    "The Night Before Christmas Campaign team",
    "",
    "01292 811 015 | giving@nbcc.scot | nbcc.scot",
  ].join("\n");

  return { subject, html, text };
}
