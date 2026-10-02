import { emailShell, heading, eyebrow, bodyP, note, button } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { KIND_LABELS, shortName, type SignUp } from "./model";

// TASK-493: the community fundraising emails, built here and sent by src/fundraising/send.ts.
// Pure: no pool, no config, no clock, so each is unit tested (test/unit/fundraising-emails.test.ts).
//
//   thanks     to the organiser when they sign up: thank you, we'll be in touch
//   staff      to the events inbox: everything they told us, and what they would like
//   approved   to the organiser: their page link, or for anyone else "you're on our list"
//   manage     to the organiser: the 24 hour link to change their page
//
// They wear NBCC's usual shell with the events inbox as the contact, because a fundraiser's
// questions belong with the events team, not the giving queue. Plain friendly English, no dashes.

export const FUNDRAISING_EMAIL = "events@nbcc.scot";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const firstName = (name: string): string => shortName(name).split(" ")[0];

/** £500, £12.50, £100,000. */
export function pounds(pence: number): string {
  const whole = pence % 100 === 0;
  return `£${(pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const shell = (body: string) =>
  emailShell(body, { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

const TEXT_FOOTER = `Any questions? Reply to this email, or write to ${FUNDRAISING_EMAIL}.

${FOOTER_TEXT}`;

// --- thanks for signing up ------------------------------------------------------------------------

// Fixed words only: anyone can type any address into the public form, so this email carries
// nothing they typed (no name, title or description). Otherwise the form would send any words, from
// NBCC's own domain, to anyone. Everything they told us goes to the events inbox instead.
export function buildSignUpThanksEmail(): BuiltEmail {
  const hi = "Hello,";
  const body =
    eyebrow("Fundraising for NBCC") +
    heading("Thank you for signing up") +
    bodyP(hi) +
    bodyP("Thank you for wanting to raise money for NBCC. It means a great deal to the families we help.") +
    bodyP("Someone from our team will look at what you sent and be in touch soon, usually within a few days. Nothing goes on our website until we have spoken. If this was not you, you can ignore this email.") +
    note(`Any questions in the meantime? Just reply to this email, or write to ${FUNDRAISING_EMAIL}.`);
  const text = [
    hi,
    "",
    "Thank you for wanting to raise money for NBCC. It means a great deal to the families we help.",
    "",
    "Someone from our team will look at what you sent and be in touch soon, usually within a few days.",
    "Nothing goes on our website until we have spoken. If this was not you, you can ignore this email.",
    "",
    TEXT_FOOTER,
  ].join("\n");
  return { subject: "Thank you for fundraising for NBCC", html: shell(body), text };
}

// --- the summary to the events inbox --------------------------------------------------------------

function staffFacts(f: SignUp & { id: number }): Array<[string, string]> {
  const when = [f.eventDate, f.startTime].filter(Boolean).join(" at ");
  const where = [f.venue, f.town].filter(Boolean).join(", ");
  const facts: Array<[string, string]> = [
    ["What", f.path === "raising" ? "Raising money" : "Holding an event"],
    ["Kind", KIND_LABELS[f.kind]],
    ["Name for it", f.title],
    ["About it", f.description],
    ["When", when || "Not given"],
    ["Where", where || "Not given"],
  ];
  if (f.path === "raising") facts.push(["Target", f.targetPence ? pounds(f.targetPence) : "No target"]);
  facts.push(
    ["On the website", f.public ? "Yes, they would like it shown" : "No, not to be shown on the website"],
    ["Organiser", f.name],
    ["Email", f.email],
    ["Phone", f.phone],
    ["Facebook or Instagram", f.socialLink ?? "Not given"],
    ["We can post about it", f.socialOk ? "Yes" : "No"],
    ["Leaflets or posters: " + f.wants.leaflets, ""],
    ["Buckets or tins: " + f.wants.buckets, ""],
    ["A social media shout out", f.wants.shoutOut ? "Yes please" : "No"],
    ["Someone from NBCC to come along", f.wants.attend ? "Yes please" : "No"],
  );
  if (f.postAddress) facts.push(["Address for materials", f.postAddress]);
  facts.push(["Newsletter", f.newsletterOk ? "Yes, they ticked the box" : "No"]);
  return facts;
}

export function buildSignUpStaffEmail(f: SignUp & { id: number }, o: { adminUrl: string }): BuiltEmail {
  const facts = staffFacts(f);
  const rows = facts
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;color:#6F6A66;font-size:13px">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;vertical-align:top;font-size:14px">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const body =
    eyebrow("For the team") +
    heading("A new fundraiser has signed up") +
    bodyP(`${escapeHtml(f.name)} has signed up <b>${escapeHtml(f.title)}</b>. Nothing is public until someone approves it in the admin, under Fundraising.`) +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px">${rows}</table>` +
    button(o.adminUrl, "Open the admin") +
    note(`Replying to this email replies to ${escapeHtml(f.name)}.`);
  const text = [
    "A NEW FUNDRAISER HAS SIGNED UP",
    "",
    `${f.name} has signed up ${f.title}. Nothing is public until someone approves it in the admin,`,
    "under Fundraising.",
    "",
    ...facts.map(([label, value]) => (value ? `${label}: ${value}` : label)),
    "",
    `Open the admin: ${o.adminUrl}`,
    "",
    `Replying to this email replies to ${f.name}.`,
  ].join("\n");
  return { subject: `New fundraiser: ${f.title}`, html: shell(body), text };
}

// --- approved -------------------------------------------------------------------------------------

export function buildApprovedEmail(
  f: { name: string; title: string },
  o: { pageUrl: string | null; manageUrl: string | null; pagesOpen?: boolean },
): BuiltEmail {
  const hi = `Hi ${firstName(f.name)},`;
  const title = escapeHtml(f.title);
  // Approved while fundraising is still switched off: a page link would be a 404, so say when.
  if (o.pagesOpen === false) {
    const body =
      eyebrow("Fundraising for NBCC") +
      heading("You're approved") +
      bodyP(escapeHtml(hi)) +
      bodyP(`Good news: <b>${title}</b> is approved. Your page will appear when our fundraising pages open, and we will be in touch about anything you asked us for.`) +
      note(`Thank you. Any questions, just reply to this email or write to ${FUNDRAISING_EMAIL}.`);
    const text = [
      hi,
      "",
      `Good news: ${f.title} is approved. Your page will appear when our fundraising pages open, and`,
      "we will be in touch about anything you asked us for.",
      "",
      "Thank you.",
      "",
      TEXT_FOOTER,
    ].join("\n");
    return { subject: `You're approved: ${f.title}`, html: shell(body), text };
  }
  if (o.pageUrl) {
    const manage = o.manageUrl
      ? `To change your description, target, date or place, go to ${escapeHtml(o.manageUrl)} and we will email you a link. We check every change before it shows.`
      : "";
    const body =
      eyebrow("Fundraising for NBCC") +
      heading("Your page is live") +
      bodyP(escapeHtml(hi)) +
      bodyP(`Good news: <b>${title}</b> is approved and your page is live. Share it with everyone you know. Every gift on it comes straight to NBCC, and shows on your meter.`) +
      button(o.pageUrl, "See your page") +
      bodyP(`Your page also has its own QR code, ready to print on posters and leaflets.`) +
      (manage ? note(manage) : "") +
      note(`Thank you. Any questions, just reply to this email or write to ${FUNDRAISING_EMAIL}.`);
    const text = [
      hi,
      "",
      `Good news: ${f.title} is approved and your page is live. Share it with everyone you know.`,
      "Every gift on it comes straight to NBCC, and shows on your meter.",
      "",
      `Your page: ${o.pageUrl}`,
      "",
      "Your page also has its own QR code, ready to print on posters and leaflets.",
      ...(o.manageUrl
        ? [
            "",
            `To change your description, target, date or place, go to ${o.manageUrl}`,
            "and we will email you a link. We check every change before it shows.",
          ]
        : []),
      "",
      "Thank you.",
      "",
      TEXT_FOOTER,
    ].join("\n");
    return { subject: `Your fundraising page is live: ${f.title}`, html: shell(body), text };
  }
  const body =
    eyebrow("Fundraising for NBCC") +
    heading("You're on our list") +
    bodyP(escapeHtml(hi)) +
    bodyP(`Thank you. We have approved <b>${title}</b> and you're on our list. Someone from our team will be in touch about anything you asked us for.`) +
    note(`Any questions, just reply to this email or write to ${FUNDRAISING_EMAIL}.`);
  const text = [
    hi,
    "",
    `Thank you. We have approved ${f.title} and you're on our list. Someone from our team will be`,
    "in touch about anything you asked us for.",
    "",
    TEXT_FOOTER,
  ].join("\n");
  return { subject: `You're on our list: ${f.title}`, html: shell(body), text };
}

// --- the manage link ------------------------------------------------------------------------------

export function buildManageLinkEmail(f: { name: string; title: string }, link: string): BuiltEmail {
  const hi = `Hi ${firstName(f.name)},`;
  const body =
    eyebrow("Fundraising for NBCC") +
    heading("Change your fundraising page") +
    bodyP(escapeHtml(hi)) +
    bodyP(`Here is your link to change <b>${escapeHtml(f.title)}</b>. It works for 24 hours. We check every change before it shows on your page.`) +
    button(link, "Change my page") +
    note("If you did not ask for this, you can ignore it. Nothing changes unless you use the link.");
  const text = [
    hi,
    "",
    `Here is your link to change ${f.title}. It works for 24 hours. We check every change before it`,
    "shows on your page.",
    "",
    link,
    "",
    "If you did not ask for this, you can ignore it. Nothing changes unless you use the link.",
    "",
    TEXT_FOOTER,
  ].join("\n");
  return { subject: `Your link to change ${f.title}`, html: shell(body), text };
}
