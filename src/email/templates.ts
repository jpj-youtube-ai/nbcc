// The NBCC transactional email templates (Resend→SES migration). Ported VERBATIM — palette,
// copy, and subjects — from the retired Cloudflare Worker relay (services/email-relay), which
// built these on the way to the provider. The app now builds them itself and sends via
// src/clients/ses.ts. TASK-209's design contract still holds: every transactional email shares
// ONE branded shell (modelled on the admin thank-you letter, src/thank-you/letter.ts: maroon
// page, cream panel, NBCC letterhead, maroon contact/legal footer bar) and each kind carries its
// OWN correct subject.
//
// Everything here is PURE (no config, no network, no clock) so it unit-tests directly —
// test/unit/email-templates.test.ts.

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const gbp = (pence: unknown, currency: unknown): string => {
  const n = (Number(pence) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: String(currency || "GBP") }).format(n);
  } catch {
    return `£${n.toFixed(2)}`;
  }
};

// Brand palette + font stacks: hex/stack mirrors of the site tokens, inlined because email has
// no stylesheet. Kept identical to src/thank-you/letter.ts so the whole NBCC email family reads
// as one design.
const MAROON = "#800000";
const CRIMSON = "#C02238";
const CREAM = "#F8F5EE";
const SLATE = "#333333";
const SLATE_SOFT = "#6F6A66";
const TAN_SOFT = "#F3E4DD";
const CREAM_82 = "rgba(248,245,238,.82)";
const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
const BODY_FONT = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

// The charity-registration sentence, mirrored verbatim from the thank-you letter email. Shown in
// the maroon footer ONLY for template-built kinds; the app-built kinds (donation / receipt /
// refund) already carry it in their own body, so their footer omits it (contacts only).
const CHARITY_REGISTRATION =
  "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.";
const TEXT_CONTACTS = "01292 811 015 · giving@nbcc.scot · nbcc.scot";

// The APPROVED branded shell. A full, self-contained HTML document (mail clients need the
// color-scheme meta so dark mode does not invert the maroon/cream palette). `bodyHtml` drops
// into the cream panel; `includeRegistration` adds the legal sentence under the contact line in
// the maroon footer (true for template-built kinds, false for app-built ones).
const shell = (bodyHtml: string, includeRegistration: boolean): string => `<!doctype html>
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
    <tr><td style="padding:24px 40px 28px;color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6">${bodyHtml}</td></tr>
    <tr><td style="background:${MAROON};color:${CREAM};padding:20px 40px;font-family:${BODY_FONT};font-size:14px;text-align:center">
      <div style="font-weight:700"><a href="tel:+441292811015" style="color:${CREAM};text-decoration:none">01292 811 015</a> &nbsp;·&nbsp; <a href="mailto:giving@nbcc.scot" style="color:${CREAM};text-decoration:underline">giving@nbcc.scot</a> &nbsp;·&nbsp; <a href="https://nbcc.scot" style="color:${CREAM};text-decoration:underline">nbcc.scot</a></div>${includeRegistration ? `
      <div style="color:${CREAM_82};font-size:11px;margin-top:8px">${CHARITY_REGISTRATION}</div>` : ""}
    </td></tr>
  </table>
</body>
</html>`;

// Body-fragment helpers (crimson serif heading, slate body copy, a crimson pill CTA button, a
// maroon code callout). Colours match the thank-you letter email.
const heading = (t: string) =>
  `<h1 style="color:${CRIMSON};font-family:${HEAD};font-size:24px;font-weight:800;margin:0 0 12px;letter-spacing:-.01em">${t}</h1>`;
const bodyP = (html: string) =>
  `<p style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px">${html}</p>`;
const note = (html: string) =>
  `<p style="color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;line-height:1.55;margin:14px 0 0">${html}</p>`;
const button = (href: unknown, label: string) =>
  `<div style="text-align:center;margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:${CRIMSON};color:${CREAM};text-decoration:none;font-family:${BODY_FONT};font-weight:700;font-size:15px;padding:12px 26px;border-radius:999px">${esc(label)}</a></div>`;
const codeBox = (code: unknown) =>
  `<div style="text-align:center;margin:22px 0"><div style="display:inline-block;background:${TAN_SOFT};border-radius:10px;padding:14px 28px;font-family:${HEAD};font-size:32px;font-weight:800;letter-spacing:8px;color:${MAROON}">${esc(code)}</div></div>`;

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

// A TEMPLATE-built email: wrap the body fragment in the shell (footer WITH registration) and
// append the contacts + registration to the text part.
const templateBuilt = (subject: string, bodyHtml: string, bodyText: string): BuiltEmail => ({
  subject,
  html: shell(bodyHtml, true),
  text: `${bodyText}\n\n${TEXT_CONTACTS}\n${CHARITY_REGISTRATION}`,
});
// An APP-body email: wrap the app html in the shell (footer contacts only, no registration —
// the app body already carries it) and append only the contacts to the app text (which already
// ends with the registration line).
const appBody = (subject: string, html: unknown, text: unknown): BuiltEmail => ({
  subject,
  html: shell(String(html ?? ""), false),
  text: `${text ?? ""}\n${TEXT_CONTACTS}`,
});

export type EmailKind =
  | "donation"
  | "receipt"
  | "refund"
  | "loginCode"
  | "adminInvite"
  | "adminReset"
  | "portal"
  | "declaration"
  | "lapsedDonor"
  | "lapsedAdmin";

// Build the branded email for one transactional kind. `p` carries the same fields the payload
// interfaces in src/clients/email.ts declare for that kind — the mapping (and every subject and
// line of copy) is the relay's buildEmail, minus its deploy-skew heuristics: the app and the
// templates now ship together, so a payload without a kind cannot exist.
export function buildKindEmail(kind: EmailKind, p: Record<string, unknown>): BuiltEmail {
  switch (kind) {
    // App-built bodies (html + text already rendered by the app, ending with the charity line).
    case "donation":
      return appBody("Thank you for your donation to NBCC", p.html, p.text);
    case "receipt":
      return appBody("Your NBCC donation receipt", p.html, p.text);
    case "refund":
      return appBody("Your NBCC refund confirmation", p.html, p.text);

    // Template-built bodies: a short branded body (greeting + the code or a link button + a
    // note), footer carrying the contacts THEN the charity registration.
    case "loginCode":
      return templateBuilt(
        "Your NBCC admin sign-in code",
        `${heading("Your sign-in code")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("Use this code to finish signing in to your NBCC admin account:")}${codeBox(p.code)}${note("This code expires in 10 minutes. If you did not request it, you can ignore this email.")}`,
        `Hello ${p.fullName},\n\nYour NBCC admin sign-in code is ${p.code}. This code expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.`,
      );
    case "adminInvite":
      return templateBuilt(
        "Your NBCC admin account invitation",
        `${heading("You have been invited")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("You have been invited to join the NBCC admin team. Use the button below to set up your account. This link is single use and expires soon.")}${button(p.link, "Accept your invitation")}${note("If you were not expecting this, you can ignore this email.")}`,
        `Hello ${p.fullName},\n\nYou have been invited to join the NBCC admin team. Set up your account using this single-use link (it expires soon):\n${p.link}\n\nIf you were not expecting this, you can ignore this email.`,
      );
    case "adminReset":
      return templateBuilt(
        "Reset your NBCC admin password",
        `${heading("Reset your password")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("We received a request to reset your NBCC admin password. Use the button below to choose a new one. This link is single use and expires soon.")}${button(p.link, "Reset my password")}${note("If you did not request this, you can ignore this email and your password stays unchanged.")}`,
        `Hello ${p.fullName},\n\nWe received a request to reset your NBCC admin password. Choose a new one using this single-use link (it expires soon):\n${p.link}\n\nIf you did not request this, ignore this email and your password stays unchanged.`,
      );
    case "portal":
      return templateBuilt(
        "Your NBCC donor portal link",
        `${heading("Your donor portal link")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("Use the button below to open your NBCC donor portal. This is a one-time link that expires soon.")}${button(p.link, "Open my portal")}${note("If you did not request this, you can ignore this email.")}`,
        `Hello ${p.fullName},\n\nOpen your NBCC donor portal using this one-time link (it expires soon):\n${p.link}\n\nIf you did not request this, you can ignore this email.`,
      );
    case "declaration":
      return templateBuilt(
        "Add Gift Aid to your NBCC donation",
        `${heading("Add Gift Aid to your donation")}${bodyP(`Thank you for your donation of <strong>${esc(gbp(p.amountPence, p.currency))}</strong>.`)}${bodyP("You can add Gift Aid, worth an extra 25% to us at no cost to you, using the secure link below.")}${button(p.declarationLink, "Add Gift Aid to my donation")}${note(`Or use this short link: ${esc(p.shortLink)}`)}`,
        `Thank you for your donation of ${gbp(p.amountPence, p.currency)}.\n\nAdd Gift Aid (worth 25% more to us at no cost to you): ${p.declarationLink}\nShort link: ${p.shortLink}`,
      );
    case "lapsedDonor":
      return templateBuilt(
        "Your NBCC monthly donation has stopped",
        `${heading("Your monthly donation has stopped")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("We were unable to collect your recent monthly donation, so it has stopped. If you would like to continue supporting us, you can set it up again on our website.")}${button("https://nbcc.scot/donate", "Restart my monthly donation")}`,
        `Hello ${p.fullName},\n\nWe were unable to collect your recent monthly donation, so it has stopped. To continue supporting us, restart it here: https://nbcc.scot/donate`,
      );
    case "lapsedAdmin":
      return templateBuilt(
        "A monthly NBCC subscription has lapsed",
        `${heading("A monthly subscription has lapsed")}${bodyP("A monthly donation has lapsed (Stripe retries exhausted).")}${bodyP(`Donor: <strong>${esc(p.donorName)}</strong><br>Subscription: <code>${esc(p.subscriptionId)}</code>`)}`,
        `A monthly donation has lapsed (Stripe retries exhausted).\nDonor: ${p.donorName}\nSubscription: ${p.subscriptionId}`,
      );
  }
}

// No contact-enquiry template on purpose: the old relay's /contact branch forwarded enquiries by
// email, but that path was retired by the 2026-07-10 contact-inbox spec — POST /api/contact
// STORES enquiries in the contact database and the admin tab reads them there. The dead
// forwarding client (src/clients/contact.ts) went with the Resend→SES migration.
