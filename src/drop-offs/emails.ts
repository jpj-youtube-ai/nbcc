import { GIVING_EMAIL, bodyP, emailShell, eyebrow, heading, questionsBox, questionsText, signOff, signOffText } from "../email/brand";
import { raiseOrdinals } from "../email/dates";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { safeFirstName } from "../fundraising/emails";

// Workshop drop-offs (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md): the thank you
// that goes the moment somebody leaves their details on the tablet page at /workshop. Pure, in the
// branded shell, with the giving inbox as the contact; sent by src/clients/email.ts from and replying
// to the giving inbox. The proper thank-you letter comes later, from Admin > Giving > Workshop
// drop-offs.
//
// The name is used only as a safe first name (one word of letters), so the email can never carry a
// link someone typed; what they brought is escaped. Plain friendly English, no dashes.

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const SUBJECT = "Thank you for dropping in";
const EYEBROW = "The Elves Workshop";
const DIFFERENCE =
  "Everything that comes through the workshop door goes to children, young people and vulnerable adults across South West Scotland who need it most. Your kindness makes a real difference, and the elves are very grateful.";
const MAILING_LIST =
  "You're now on our mailing list, so we'll let you know how it all goes. It's a few emails a year, and you can unsubscribe at any time.";
const CLOSE = "Thanks so much,";

export function buildWorkshopThanksEmail(o: { name: string; brought: string; joinedNewsletter: boolean }): BuiltEmail {
  const first = safeFirstName(o.name);
  const hello = first ? `Hello ${first},` : "Hello,";
  const brought = o.brought.trim();
  const thanks = (what: string) => `Thank you so much for bringing in ${what} today.`;
  const html = emailShell(
    raiseOrdinals(
      eyebrow(EYEBROW) +
        heading(SUBJECT) +
        bodyP(esc(hello)) +
        bodyP(thanks(`<b>${esc(brought)}</b>`)) +
        bodyP(DIFFERENCE) +
        (o.joinedNewsletter ? bodyP(MAILING_LIST) : "") +
        signOff(CLOSE) +
        questionsBox(GIVING_EMAIL),
    ),
    { contactEmail: GIVING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS },
  );
  const text = [
    EYEBROW,
    SUBJECT,
    "",
    hello,
    "",
    thanks(brought),
    "",
    DIFFERENCE,
    ...(o.joinedNewsletter ? ["", MAILING_LIST] : []),
    "",
    signOffText(CLOSE),
    "",
    questionsText(GIVING_EMAIL),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: SUBJECT, html, text };
}
