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

// The palette, the type, the letterhead and the fragment helpers now live in ./brand.ts, which
// is the ONE place they are declared. The Festive Ball emails carried a second, older copy of
// this shell that had quietly drifted (system-ui type, no letterhead, no footer bar), so a
// supporter who donated and then bought a ball ticket got two emails that did not look related.
// Rendering both families through one module is what stops that happening again. This file's
// output is unchanged by the move, which is what its own tests assert.
import { emailShell, heading, bodyP, note, button, codeBox, CHARITY_REGISTRATION } from "./brand";

const TEXT_CONTACTS = "01292 811 015 · giving@nbcc.scot · nbcc.scot";

// `includeRegistration` adds the legal sentence under the contact line in the maroon footer
// (true for template-built kinds, false for app-built ones, which carry it in their own body).
const shell = (bodyHtml: string, includeRegistration: boolean): string =>
  emailShell(bodyHtml, { registration: includeRegistration });

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
