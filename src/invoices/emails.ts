import {
  ABOUT_NBCC_SHORT,
  GIVING_EMAIL,
  TAN_SOFT,
  MAROON,
  SLATE,
  SLATE_SOFT,
  BODY_FONT,
  bodyP,
  button,
  card,
  emailShell,
  eyebrow,
  heading,
  pounds,
  questionsBox,
  questionsText,
  quoteBox,
  signOff,
  signOffText,
} from "../email/brand";
import { emailDate, raiseOrdinals } from "../email/dates";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { DONATION_IMPACT_LINE } from "../donors/confirmation";

// The emails for invoices for donations (src/invoices/model.ts). Pure, in the same branded shell as
// the other giving emails, with the giving inbox as the contact; sent by src/clients/email.ts from and
// replying to the giving inbox.
//
//   buildInvoiceEmail          the invoice itself, with a button to the private invoice page
//   buildGroupReceiptEmail     the thank you when a group's invoice is paid. A person gets the usual
//                              donation receipt and a business the usual Corporation Tax receipt, each
//                              with the "This pays invoice" line (src/donors/confirmation.ts, receipt.ts);
//                              a school, church or club gets this plain one, with no tax wording.
//   buildInvoicesPaidTwiceNote the words of the note to the giving inbox when an invoice is paid twice
//   buildInvoiceStaffEmail     that note in the shell
//
// Everything staff typed is escaped. Plain friendly English, no dashes.

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const shell = (body: string): string =>
  emailShell(raiseOrdinals(body), { contactEmail: GIVING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

/** The private page's address. */
export function invoiceLink(token: string, base: string): string {
  return `${base.replace(/\/+$/, "")}/invoice/${token}`;
}

/** £250, £320.50. */
const amount = (pence: number): string => pounds(pence);

/** One labelled line of a card. */
const row = (label: string, valueHtml: string): string =>
  `<tr><td style="padding:10px 16px;border-bottom:1px solid ${TAN_SOFT};font-family:${BODY_FONT};font-size:12px;color:${SLATE_SOFT};width:40%">${label}</td>` +
  `<td style="padding:10px 16px;border-bottom:1px solid ${TAN_SOFT};font-family:${BODY_FONT};font-size:14px;font-weight:700;color:${MAROON}">${valueHtml}</td></tr>`;

export interface InvoiceEmailData {
  number: string;
  contactName: string;
  orgName: string | null;
  amountPence: number;
  description: string;
  note: string | null;
  dueOn: string;
  link: string;
  /** Whether the page offers our bank details as well as card. */
  bankTransfer?: boolean;
}

export function buildInvoiceEmail(d: InvoiceEmailData): BuiltEmail {
  const due = emailDate(d.dueOn, { year: true });
  const subject = `Your invoice from NBCC: ${d.number}`;
  const how = d.bankTransfer
    ? "You can pay by card on the invoice page, or by bank transfer using the details on it. You can also print it or save it as a PDF for your records."
    : "You can pay by card on the invoice page. You can also print it or save it as a PDF for your records.";
  const thanks = d.orgName
    ? `Thank you for supporting NBCC. Here is the invoice for ${esc(d.orgName)}'s donation.`
    : "Thank you for supporting NBCC. Here is your invoice.";

  const html = shell(
    eyebrow("Your invoice") +
      heading(`Invoice ${esc(d.number)}`) +
      bodyP(`Hello ${esc(d.contactName)},`) +
      bodyP(thanks) +
      card(
        row("Invoice number", esc(d.number)) +
          row("For", esc(d.description)) +
          row("Amount", amount(d.amountPence)) +
          row("Please pay by", esc(due)),
      ) +
      (d.note ? quoteBox(d.note) : "") +
      button(d.link, "View and pay your invoice") +
      bodyP(how) +
      bodyP(esc(ABOUT_NBCC_SHORT)) +
      questionsBox(GIVING_EMAIL) +
      signOff("Thank you so much,"),
  );

  const text = [
    `Hello ${d.contactName},`,
    "",
    d.orgName ? `Thank you for supporting NBCC. Here is the invoice for ${d.orgName}'s donation.` : "Thank you for supporting NBCC. Here is your invoice.",
    "",
    `Invoice number: ${d.number}`,
    `For: ${d.description}`,
    `Amount: ${amount(d.amountPence)}`,
    `Please pay by: ${due}`,
    ...(d.note ? ["", d.note] : []),
    "",
    `View and pay your invoice: ${d.link}`,
    "",
    how,
    "",
    ABOUT_NBCC_SHORT,
    "",
    questionsText(GIVING_EMAIL),
    "",
    signOffText("Thank you so much,"),
    "",
    FOOTER_TEXT,
  ].join("\n");

  return { subject, html, text };
}

export interface GroupReceiptData {
  number: string;
  orgName: string;
  contactName: string;
  amountPence: number;
  paidOn: string;
  link: string;
  /** The donation's own receipt reference, NBCC-000321. */
  reference: string;
}

export function buildGroupReceiptEmail(d: GroupReceiptData): BuiltEmail {
  const subject = `Thank you: invoice ${d.number} is paid`;
  const paysLine = `This pays invoice ${d.number}. Thank you.`;
  const paid = emailDate(d.paidOn, { year: true });
  const html = shell(
    `<p style="margin:0 0 14px;font-family:${BODY_FONT};font-size:14px;font-weight:700;color:${MAROON}">${esc(paysLine)}</p>` +
      heading("Thank you") +
      bodyP(`Hello ${esc(d.contactName)},`) +
      bodyP(`We have received ${esc(d.orgName)}'s donation. ${esc(DONATION_IMPACT_LINE)}`) +
      card(
        row("Received from", esc(d.orgName)) +
          row("Amount", amount(d.amountPence)) +
          row("Date", esc(paid)) +
          row("Receipt reference", esc(d.reference)),
      ) +
      button(d.link, "View your invoice") +
      bodyP("Please keep this email as your receipt.") +
      bodyP(esc(ABOUT_NBCC_SHORT)) +
      questionsBox(GIVING_EMAIL) +
      signOff("With heartfelt thanks,"),
  );
  const text = [
    paysLine,
    "",
    `Hello ${d.contactName},`,
    "",
    `We have received ${d.orgName}'s donation. ${DONATION_IMPACT_LINE}`,
    "",
    `Received from: ${d.orgName}`,
    `Amount: ${amount(d.amountPence)}`,
    `Date: ${paid}`,
    `Receipt reference: ${d.reference}`,
    "",
    `View your invoice: ${d.link}`,
    "",
    "Please keep this email as your receipt.",
    "",
    ABOUT_NBCC_SHORT,
    "",
    questionsText(GIVING_EMAIL),
    "",
    signOffText("With heartfelt thanks,"),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject, html, text };
}

/** The words of the note to the giving inbox when one or more invoices have been paid twice. */
export function buildInvoicesPaidTwiceNote(rows: { number: string; orgOrName: string; amountPence: number }[]): {
  subject: string;
  lines: string[];
} {
  const n = rows.length;
  return {
    subject: `${n} ${n === 1 ? "invoice" : "invoices"} paid twice: check and refund`,
    lines: [
      `${n === 1 ? "This invoice was" : "These invoices were"} paid twice. Each payment was recorded as its own donation, so nothing is lost. Please check, and refund one payment if it was a mistake.`,
      ...rows.map((r) => `${r.number}, ${r.orgOrName}, ${amount(r.amountPence)}`),
      "You can see them in Admin, Giving, Invoices.",
    ],
  };
}

/** A note to the giving inbox, in the shell. */
export function buildInvoiceStaffEmail(o: { subject: string; lines: string[]; adminUrl: string }): BuiltEmail {
  const html = shell(
    eyebrow("Invoices") +
      heading(esc(o.subject)) +
      o.lines.map((l) => bodyP(esc(l))).join("") +
      button(o.adminUrl, "Open Admin, Invoices") +
      `<p style="margin:22px 0 0;font-family:${BODY_FONT};font-size:14px;color:${SLATE}">The website</p>`,
  );
  const text = [o.subject, "", ...o.lines, "", `Open Admin, Invoices: ${o.adminUrl}`, "", "The website", "", FOOTER_TEXT].join("\n");
  return { subject: o.subject, html, text };
}
