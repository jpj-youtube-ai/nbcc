import { emailShell, eyebrow, heading, bodyP, note, button, signOff, signOffText, questionsBox, questionsText } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { FUNDRAISING_EMAIL, safeFirstName, type BuiltEmail } from "../fundraising/emails";
import { pounds, type PledgeEmailKind } from "./model";

// Sponsor pledges (Jaimie, 2026-10-03): the two emails to a sponsor. Pure, in the same shell as the
// other fundraising emails, with the events inbox as the contact; sent by ./runner.ts from and
// replying to that inbox, so a reply reaches NBCC.
//
//   pledge_pay        the day after the event (or when staff mark a page with no date finished):
//                     "<Organiser> finished <title>! Here's your link to pay your £10 pledge"
//   pledge_reminder   once, a week later, if it is still unpaid. Then nothing.
//
// Both say why the sponsor is getting it, and carry a link to say "I can't pay this after all", which
// cancels the pledge quietly. Both are NEW WORDING: neither is sent until an admin has approved it in
// Admin > Fundraising (PLEDGE_WORDING_KEYS in ./model.ts, kept in touch_wording_approvals like the
// automatic emails to organisers).
//
// The sponsor and the organiser are named only by a safe first name (safeFirstName: one word of
// letters), so neither can carry a link or other words; without one the email says "Hello," and "the
// organiser". The title is the approved page's, escaped. Plain friendly English, no dashes.

export interface PledgeEmailData {
  /** As the sponsor typed it; only a safe first name is ever used. */
  sponsorFirstName: string | null;
  /** The organiser's name; only a safe first name is ever used. */
  organiserName: string;
  title: string;
  amountPence: number;
  giftAid: boolean;
  /** When the pledge was made (ISO). */
  pledgedAt: string;
  payUrl: string;
  cancelUrl: string;
}

export const PLEDGE_EMAIL_LABELS: Record<PledgeEmailKind, string> = {
  pledge_pay: "Here’s your link to pay your pledge",
  pledge_reminder: "A reminder about your pledge",
};

export const PLEDGE_EMAIL_WHEN: Record<PledgeEmailKind, string> = {
  pledge_pay: "To each sponsor the day after the fundraiser’s date. With no date, the morning after you mark it finished.",
  pledge_reminder: "Once, a week after the pay link, if the pledge is still unpaid. Nothing after that.",
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const shell = (body: string) => emailShell(body, { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });

/** "Robin’s", "James’". */
const whose = (name: string) => `${name}${/s$/i.test(name) ? "’" : "’s"}`;

interface Words {
  subject: string;
  title: string;
  /** Paragraphs before the button; `{title}` stands for the fundraiser's name. */
  before: string[];
  buttonLabel: string;
  after: string[];
  cancel: string;
  why: string;
  close: string;
}

function words(kind: PledgeEmailKind, d: PledgeEmailData): Words {
  const organiser = safeFirstName(d.organiserName);
  const who = organiser ?? "the organiser";
  const their = organiser ? whose(organiser) : "the organiser’s";
  const amount = pounds(d.amountPence);
  const buttonLabel = `Pay my ${amount} pledge`;
  const giftAid = d.giftAid
    ? ["You asked us to add Gift Aid when you pledged. We’ll claim it once you’ve paid, at no cost to you. If you’re no longer a UK taxpayer, you can take it off before you pay."]
    : [];
  const cash = `Already paid ${who} in cash? You don’t need to pay again. Just let ${who} know, and it will be marked as paid.`;
  const cancel = "Can’t pay this after all? That’s okay.";
  if (kind === "pledge_reminder") {
    return {
      subject: `A reminder: your ${amount} pledge for ${d.title}`,
      title: "Your pledge is still waiting",
      before: [`A week ago we sent you a link to pay the ${amount} you pledged for {title}. It hasn’t been paid yet, so here it is again.`],
      buttonLabel,
      after: ["This is the only reminder we’ll send.", ...giftAid, cash],
      cancel,
      why: `Why you’re getting this: you made a pledge on ${their} fundraising page at nbcc.scot. We won’t email you about it again.`,
      close: "With thanks,",
    };
  }
  return {
    subject: organiser
      ? `${organiser} finished ${d.title}! Here's your link to pay your ${amount} pledge`
      : `${d.title} has finished! Here's your link to pay your ${amount} pledge`,
    title: organiser ? `${organiser} finished!` : "They finished!",
    before: [
      `Great news: ${organiser ?? "The organiser"} has finished {title}. Thank you for cheering ${organiser ?? "them"} on!`,
      `On ${DAY.format(new Date(d.pledgedAt))} you pledged ${amount} on ${their} fundraising page. Here is your link to pay it. It takes about a minute, and you can give more if you would like to.`,
    ],
    buttonLabel,
    after: [
      `Your payment goes straight to the Night Before Christmas Campaign (NBCC) and counts towards ${their} total. We’ll email you a receipt.`,
      ...giftAid,
      cash,
    ],
    cancel,
    why: `Why you’re getting this: you made a pledge on ${their} fundraising page at nbcc.scot. If it isn’t paid we’ll send one reminder in a week, and nothing after that.`,
    close: "With thanks,",
  };
}

export function buildPledgeEmail(kind: PledgeEmailKind, d: PledgeEmailData): BuiltEmail {
  const w = words(kind, d);
  const first = safeFirstName(d.sponsorFirstName);
  const hello = first ? `Hello ${first},` : "Hello,";
  const withTitle = (s: string, title: string) => s.replace("{title}", title);
  const html = shell(
    eyebrow("Fundraising for NBCC") +
      heading(escapeHtml(w.title)) +
      bodyP(escapeHtml(hello)) +
      w.before.map((p) => bodyP(withTitle(escapeHtml(p), `<b>${escapeHtml(d.title)}</b>`))).join("") +
      button(d.payUrl, w.buttonLabel) +
      w.after.map((p) => bodyP(escapeHtml(p))).join("") +
      bodyP(`${escapeHtml(w.cancel)} <a href="${escapeHtml(d.cancelUrl)}" style="color:#C02238">Tell us here</a> and we won’t email you about it again.`) +
      note(escapeHtml(w.why)) +
      signOff(w.close) +
      questionsBox(FUNDRAISING_EMAIL),
  );
  const text = [
    w.title,
    "",
    hello,
    "",
    ...w.before.flatMap((p) => [withTitle(p, d.title), ""]),
    `${w.buttonLabel}: ${d.payUrl}`,
    "",
    ...w.after.flatMap((p) => [p, ""]),
    `${w.cancel} Tell us here and we won’t email you about it again: ${d.cancelUrl}`,
    "",
    w.why,
    "",
    signOffText(w.close),
    "",
    questionsText(FUNDRAISING_EMAIL),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: w.subject, html, text };
}

/** What the admin's preview shows before anything is sent: invented, like the other examples. */
export function samplePledgeEmailData(base: string): PledgeEmailData {
  const b = base.replace(/\/+$/, "");
  return {
    sponsorFirstName: "Alex",
    organiserName: "Sam Example",
    title: "Sam's Santa Dash",
    amountPence: 1000,
    giftAid: true,
    pledgedAt: "2026-11-01T10:00:00.000Z",
    payUrl: `${b}/pledge/pay?t=example`,
    cancelUrl: `${b}/pledge/cancel?t=example`,
  };
}

// --- confirm by email (Jaimie, 2026-10-03) ----------------------------------------------------------
//
// The one email sent when someone pledges. A pledge counts for nothing until its sponsor presses the
// button here: it is not shown on the page, not listed for the organiser, and never emailed a pay
// link. This is what stops anyone pledging in somebody else's name. It is not one of the automatic
// emails: it goes whatever the Automatic emails switch says, and its wording is not approval gated,
// because pledging must work from day one. It still respects the stop lists (./runner.ts).
//
// Anyone can type any address into the form, so it carries fixed words, one safe first name, the
// organiser's safe first name and the approved page's title, and nothing else they typed (no
// surname, no message). One button, and no reminder ever follows it.

export interface PledgeConfirmData {
  sponsorFirstName: string | null;
  organiserName: string;
  title: string;
  amountPence: number;
  confirmUrl: string;
}

export function buildPledgeConfirmEmail(d: PledgeConfirmData): BuiltEmail {
  const first = safeFirstName(d.sponsorFirstName);
  const organiser = safeFirstName(d.organiserName);
  const who = organiser ?? "the organiser";
  const amount = pounds(d.amountPence);
  const hello = first ? `Hello ${first},` : "Hello,";
  const thanks = (title: string) => `Thank you for pledging ${amount} to sponsor ${who} for ${title}. Please press the button to confirm it was you.`;
  const label = `Confirm my ${amount} pledge`;
  const next = `There is nothing to pay today. Once ${organiser ?? "the organiser"} has finished, we’ll email you a link to pay.`;
  const notYou = "If this wasn’t you, you don’t need to do anything. A pledge that isn’t confirmed is deleted after 7 days, and we won’t email you again.";
  const close = "With thanks,";
  const html = shell(
    eyebrow("Fundraising for NBCC") +
      heading("Please confirm your pledge") +
      bodyP(escapeHtml(hello)) +
      bodyP(escapeHtml(thanks("{title}")).replace("{title}", `<b>${escapeHtml(d.title)}</b>`)) +
      button(d.confirmUrl, label) +
      bodyP(escapeHtml(next)) +
      note(escapeHtml(notYou)) +
      signOff(close) +
      questionsBox(FUNDRAISING_EMAIL),
  );
  const text = [
    "Please confirm your pledge",
    "",
    hello,
    "",
    thanks(d.title),
    "",
    `${label}: ${d.confirmUrl}`,
    "",
    next,
    "",
    notYou,
    "",
    signOffText(close),
    "",
    questionsText(FUNDRAISING_EMAIL),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: `Please confirm your ${amount} pledge`, html, text };
}

// --- a note to the events inbox ---------------------------------------------------------------------

/** A plain note to staff: a pledge paid twice to check and refund, or one an organiser hid. */
export function buildPledgeStaffEmail(o: { subject: string; lines: string[]; adminUrl: string }): BuiltEmail {
  const html = shell(
    eyebrow("Sponsor pledges") +
      heading(escapeHtml(o.subject)) +
      o.lines.map((l) => bodyP(escapeHtml(l))).join("") +
      button(o.adminUrl, "Open Admin, Fundraising"),
  );
  const text = [o.subject, "", ...o.lines, "", `Open Admin, Fundraising: ${o.adminUrl}`, "", FOOTER_TEXT].join("\n");
  return { subject: o.subject, html, text };
}
