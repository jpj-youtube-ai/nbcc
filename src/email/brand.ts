// The NBCC email frame: the palette, the type, the letterhead and the footer that make every
// email the charity sends read as one organisation.
//
// This module exists because there were two of these. src/email/templates.ts carried the
// approved shell (modelled on the admin thank-you letter, src/thank-you/letter.ts) and the
// Festive Ball emails carried a second, older one that had drifted: system-ui type, a bare
// cream box, no letterhead, no footer bar. A supporter who donates and then buys a ball ticket
// received two emails that did not look related.
//
// Everything here is PURE (no config, no network, no clock) so it unit-tests directly, and it is
// the ONE place the hex values live. src/email/templates.ts renders byte-identically through it,
// which is what its own tests assert.

// Brand palette + font stacks: hex/stack mirrors of the site tokens, inlined because email has
// no stylesheet.
export const MAROON = "#800000";
export const CRIMSON = "#C02238";
export const CREAM = "#F8F5EE";
export const SLATE = "#333333";
export const SLATE_SOFT = "#6F6A66";
export const TAN_SOFT = "#F3E4DD";
export const CREAM_82 = "rgba(248,245,238,.82)";
export const CREAM_64 = "rgba(248,245,238,.64)";
export const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
export const BODY_FONT = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

// Absolute, and it has to be: an email has no page for a relative path to resolve against, so a
// src of "/assets/..." is a broken-image icon in every mail client there is.
export const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

export const PHONE_DISPLAY = "01292 811 015";
export const PHONE_HREF = "tel:+441292811015";
export const GIVING_EMAIL = "giving@nbcc.scot";

// The charity-registration sentence, mirrored verbatim from the thank-you letter email.
export const CHARITY_REGISTRATION =
  "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** A sponsor credit band, for an event somebody else is paying for. */
export interface SponsorCredit {
  /** The small caps line above the logo, e.g. "Event organised and sponsored by". */
  label: string;
  /** Alt text, and the name a text-part reader sees. */
  name: string;
  /** Absolute URL to a logo that reads on a DARK ground; the band is maroon. */
  logoUrl: string;
  href: string;
  /** Rendered width in px. Mail clients need a real number, not a percentage. */
  width: number;
  /** The credit wording a sponsorship agreement requires, verbatim. */
  statement: string;
}

export interface ShellOptions {
  /** The contact address in the footer bar. Defaults to the giving inbox. */
  contactEmail?: string;
  /** Add the charity registration sentence under the contact line. */
  registration?: boolean;
  /**
   * The mandated registration lines, word for word (REGISTRATION_LINES in ../legal/registration.ts),
   * under the contact line in place of the shorter sentence above. For a donation receipt, whose
   * statement must be the mandated one. Each line is escaped; they sit one above the other.
   */
  registrationLines?: readonly string[];
  /**
   * Add the registered postal address under the registration line. Microsoft and the other big
   * filters look for a real address; its absence is a small but real spam signal.
   */
  postalAddress?: string | null;
  /** A sponsor band between the body panel and the footer. */
  sponsor?: SponsorCredit | null;
}

// The sponsor band. Maroon like the footer below it, separated from it by a hairline in cream at
// low alpha, so the two read as two bands rather than one tall block of colour. Mirrors the foot
// of the ball pages, down to the cream wordmark on the dark ground.
function sponsorBand(s: SponsorCredit): string {
  return `
    <tr><td style="background:${MAROON};padding:22px 40px 18px;text-align:center;border-bottom:1px solid ${CREAM_82.replace(".82", ".18")}">
      <div style="font-family:${BODY_FONT};font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:${CREAM_82};font-size:11px;margin:0 0 12px">${esc(s.label)}</div>
      <a href="${esc(s.href)}" style="text-decoration:none"><img src="${esc(s.logoUrl)}" alt="${esc(s.name)}" width="${s.width}" style="display:inline-block;height:auto;max-width:${s.width}px" /></a>
      <div style="font-family:${BODY_FONT};color:${CREAM_64};font-size:11px;line-height:1.55;margin-top:14px">${esc(s.statement)}</div>
    </td></tr>`;
}

/**
 * The APPROVED branded shell. A full, self-contained HTML document (mail clients need the
 * color-scheme meta so dark mode does not invert the maroon/cream palette). `bodyHtml` drops
 * into the cream panel.
 */
export function emailShell(bodyHtml: string, options: ShellOptions = {}): string {
  const contact = options.contactEmail ?? GIVING_EMAIL;
  const sponsor = options.sponsor ? sponsorBand(options.sponsor) : "";
  const registration = options.registrationLines?.length
    ? `
      <div style="color:${CREAM_82};font-size:11px;margin-top:8px">${options.registrationLines.map(esc).join("<br />")}</div>`
    : options.registration
      ? `
      <div style="color:${CREAM_82};font-size:11px;margin-top:8px">${CHARITY_REGISTRATION}</div>`
      : "";
  const address = options.postalAddress
    ? `
      <div style="color:${CREAM_82};font-size:11px;margin-top:4px">${esc(options.postalAddress)}</div>`
    : "";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- color-scheme: light keeps the maroon/cream palette in dark-mode mail clients (no auto-invert). -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>:root { color-scheme: light; supported-color-schemes: light; }</style>
</head>
<body style="margin:0;background:${MAROON};padding:24px 0;font-family:${BODY_FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:${CREAM}">
    <tr><td style="padding:30px 40px 16px;text-align:center;border-bottom:1px solid ${TAN_SOFT}">
      <img src="${LOGO_URL}" alt="Night Before Christmas Campaign" width="150" style="display:inline-block;height:auto;max-width:150px" />
      <div style="font-family:${BODY_FONT};font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:${MAROON};font-size:13px;margin-top:2px">Here all year</div>
    </td></tr>
    <tr><td style="padding:24px 40px 28px;color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6">${bodyHtml}</td></tr>${sponsor}
    <tr><td style="background:${MAROON};color:${CREAM};padding:20px 40px;font-family:${BODY_FONT};font-size:14px;text-align:center">
      <div style="font-weight:700"><a href="${PHONE_HREF}" style="color:${CREAM};text-decoration:none">${PHONE_DISPLAY}</a> &nbsp;·&nbsp; <a href="mailto:${esc(contact)}" style="color:${CREAM};text-decoration:underline">${esc(contact)}</a> &nbsp;·&nbsp; <a href="https://nbcc.scot" style="color:${CREAM};text-decoration:underline">nbcc.scot</a></div>${registration}${address}
    </td></tr>
  </table>
</body>
</html>`;
}

// --- body fragments -------------------------------------------------------------------------
// Crimson serif heading, slate body copy, a crimson pill CTA button, a maroon code callout.

export const heading = (t: string): string =>
  `<h1 style="color:${CRIMSON};font-family:${HEAD};font-size:24px;font-weight:800;margin:0 0 12px;letter-spacing:-.01em">${t}</h1>`;

/** A section heading inside a longer email, a step down from the h1. */
export const subheading = (t: string): string =>
  `<h2 style="color:${MAROON};font-family:${HEAD};font-size:18px;font-weight:700;margin:24px 0 10px">${t}</h2>`;

/** The small caps line above an h1, e.g. "A night to remember". */
export const eyebrow = (t: string): string =>
  `<p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${SLATE_SOFT};font-weight:700">${t}</p>`;

export const bodyP = (html: string): string =>
  `<p style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px">${html}</p>`;

export const note = (html: string): string =>
  `<p style="color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;line-height:1.55;margin:14px 0 0">${html}</p>`;

export const button = (href: unknown, label: string): string =>
  `<div style="text-align:center;margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:${CRIMSON};color:${CREAM};text-decoration:none;font-family:${BODY_FONT};font-weight:700;font-size:15px;padding:12px 26px;border-radius:999px">${esc(label)}</a></div>`;

export const codeBox = (code: unknown): string =>
  `<div style="text-align:center;margin:22px 0"><div style="display:inline-block;background:${TAN_SOFT};border-radius:10px;padding:14px 28px;font-family:${HEAD};font-size:32px;font-weight:800;letter-spacing:8px;color:${MAROON}">${esc(code)}</div></div>`;

/** A cream card for the facts a reader comes back to find: a reference, a date, a total. */
export const card = (innerRows: string): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#FFFDFA;border:1px solid ${TAN_SOFT};border-radius:10px;margin:0 0 20px">${innerRows}</table>`;

/** A numbered (ordered) or bulleted list of body copy, e.g. "What happens next". Items are HTML. */
export const bodyList = (itemsHtml: string[], ordered = false): string => {
  const tag = ordered ? "ol" : "ul";
  const items = itemsHtml.map((item) => `<li style="margin:0 0 4px">${item}</li>`).join("");
  return `<${tag} style="margin:0 0 14px;padding-left:22px;color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.7">${items}</${tag}>`;
};

// --- the signed close and the questions box (TASK-497) --------------------------------------
// Added for the fundraising emails Jaimie signed off on 2026-10-02: a friendly line above
// "NBCC Team", then a box offering a call and an email side by side, equally prominent. Both are
// additive; emailShell is unchanged, so no other email moves.

/** The friendly closing line, then "NBCC Team" large in the serif maroon. */
export const signOff = (line: string): string =>
  `<p style="margin:22px 0 0;font-family:${BODY_FONT};font-size:14px;color:${SLATE};line-height:1.6">${esc(line)}<br>` +
  `<span style="font-family:${HEAD};font-size:20px;font-weight:800;color:${MAROON}">NBCC Team</span></p>`;

/** The sign off in a plain text part. */
export const signOffText = (line: string): string => `${line}\nNBCC Team`;

// --- who NBCC is, in the charity's own words (the readthrough, 2026-10-04) --------------------------
// The exact sentences the charity uses to describe itself, word for word ("volunteer led" with no
// hyphen, "South West Scotland"). ONE of them goes, as its own short paragraph near the end of the
// body, in the emails whose reader may never have dealt with NBCC: the pledge confirmation, the team
// invite and the ticket confirmation. The full one where the email is short enough to take it, the
// short one otherwise, and never beside another sentence that says much the same. The donation
// receipt has the short one too, after its closing line (src/donors/confirmation.ts), and the
// giver's thank you from a fundraiser has the full one (src/fundraising/thanks-email.ts). Not in the in
// memory emails, the Festive Ball's, staff notices, or the company and refund receipts.
export const ABOUT_NBCC_FULL =
  "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland, with school clothing and crisis support whenever it is needed, and every December a full bag for those who would otherwise wake up on Christmas morning with nothing to open.";
export const ABOUT_NBCC_SHORT = "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland.";

export const QUESTIONS_HEADING = "Got any questions?";
export const QUESTIONS_LINE = "We'd love to hear from you. Give us a ring or drop us a line, whichever suits you.";

// One of the two equal tiles. A table cell, because a mail client's idea of a flex box is none at
// all. The value wraps rather than overflows, so a long address still fits a phone.
const questionsTile = (label: string, href: string, value: string): string =>
  `<td width="50%" style="padding:4px;text-align:center;vertical-align:top"><div style="background:${CREAM};border-radius:10px;padding:12px 8px">` +
  `<div style="font-family:${BODY_FONT};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${SLATE_SOFT};font-weight:700">${label}</div>` +
  `<div style="font-family:${BODY_FONT};font-size:18px;font-weight:800;color:${MAROON};margin-top:2px;overflow-wrap:anywhere;word-break:break-word">` +
  `<a href="${esc(href)}" style="color:${MAROON};text-decoration:none">${esc(value)}</a></div></div></td>`;

/** "Got any questions?": a tan panel with a call tile and an email tile side by side. */
export const questionsBox = (contactEmail: string): string =>
  `<div style="background:${TAN_SOFT};border-radius:12px;padding:18px 20px;margin:24px 0 8px;text-align:center">` +
  `<p style="margin:0 0 4px;font-family:${HEAD};font-size:19px;font-weight:800;color:${MAROON}">${QUESTIONS_HEADING}</p>` +
  `<p style="margin:0 0 12px;font-family:${BODY_FONT};font-size:13px;color:${SLATE}">${QUESTIONS_LINE}</p>` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
  questionsTile("Call us", PHONE_HREF, PHONE_DISPLAY) +
  questionsTile("Email us", `mailto:${contactEmail}`, contactEmail) +
  `</tr></table></div>`;

/** The questions box in a plain text part: the same words, the number and the address. */
export const questionsText = (contactEmail: string): string =>
  [QUESTIONS_HEADING, QUESTIONS_LINE, `Call us: ${PHONE_DISPLAY}`, `Email us: ${contactEmail}`].join("\n");

// --- a quoted note and a close signed by a person (TASK-503) ---------------------------------
// For the fundraising invite (email 7): the personal note staff add, in a quiet serif italic box,
// and a close signed by the member of staff who sent it ("Warmest wishes,", then "Fern", then
// "NBCC Team") so the organiser recognises who they spoke to. Both additive; nothing else moves.

/** A quoted note: cream box, maroon serif italic. Escaped, with its line breaks kept. */
export const quoteBox = (text: string): string =>
  `<div style="background:#FFFDFA;border:1px solid ${TAN_SOFT};border-radius:10px;padding:14px 18px;margin:4px 0 16px;font-family:${HEAD};font-style:italic;font-size:15px;color:${MAROON};line-height:1.55">` +
  `${esc(text).replace(/\r?\n/g, "<br>")}</div>`;

/** The close signed by a person: the line, then the name, then "NBCC Team". */
export const signOffAs = (line: string, name: string): string =>
  `<p style="margin:22px 0 0;font-family:${BODY_FONT};font-size:14px;color:${SLATE};line-height:1.6">${esc(line)}<br>${esc(name)}<br>` +
  `<span style="font-family:${HEAD};font-size:20px;font-weight:800;color:${MAROON}">NBCC Team</span></p>`;

/** The same in a plain text part. */
export const signOffAsText = (line: string, name: string): string => `${line}\n${name}\nNBCC Team`;

// --- the meter line (TASK-515) ---------------------------------------------------------------
// For the automatic emails to an organiser (first gift, halfway, target, doing great), as Jaimie
// approved them on 2026-10-02: the total large in the serif maroon, "raised of" the target, and a
// tan bar filled in crimson. Additive; nothing else moves.

/** £10, £10.50, £1,000: whole pounds without pence, and pence only when the amount is not whole. */
export const pounds = (pence: number): string => {
  const whole = pence % 100 === 0;
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
};

/** "£250 raised of £500" over a bar filled to the percentage (held at 100), or the total alone. */
export const meterBar = (raisedPence: number, targetPence: number | null): string => {
  const raised = Math.max(0, Math.floor(raisedPence));
  const total = `<b style="font-family:${HEAD};font-size:20px;color:${MAROON}">${pounds(raised)}</b>`;
  if (!targetPence || targetPence <= 0) {
    return `<div style="margin:6px 0 18px;font-family:${BODY_FONT};font-size:14px;color:${SLATE}">${total} raised so far</div>`;
  }
  const pc = Math.min(100, Math.round((raised * 100) / targetPence));
  return (
    `<div style="margin:6px 0 18px"><div style="font-family:${BODY_FONT};font-size:14px;color:${SLATE};margin:0 0 6px">` +
    `${total} raised of ${pounds(targetPence)}</div>` +
    `<div style="background:${TAN_SOFT};border-radius:999px;height:12px;overflow:hidden"><div style="background:${CRIMSON};width:${pc}%;height:12px"></div></div></div>`
  );
};
