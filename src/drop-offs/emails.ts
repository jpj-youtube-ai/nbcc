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
const EYEBROW = "The Elves' Workshop";
const DIFFERENCE =
  "Everything that comes through the workshop door goes to children, young people and vulnerable adults across South West Scotland who need it most. Your kindness makes a real difference, and the elves are very grateful.";
const MAILING_LIST =
  "You're now on our mailing list, so we'll let you know how it all goes. It's a few emails a year, and you can unsubscribe at any time.";
const CLOSE = "Thanks so much,";

// Anything that looks like a web address or a domain (a mail program turns those into links). The
// form is public, so what they brought is repeated only when it has none: otherwise the email thanks
// them for what they brought in without quoting it, and can never carry somebody else's link.
const LINKISH = /https?:|www\.|[a-z0-9-]+\.[a-z]{2,}\b|@/i;
const MAX_QUOTED = 200;

export function buildWorkshopThanksEmail(o: { name: string; brought: string; joinedNewsletter: boolean }): BuiltEmail {
  const first = safeFirstName(o.name);
  const hello = first ? `Hello ${first},` : "Hello,";
  const typed = o.brought.trim();
  const quote = typed.length > 0 && typed.length <= MAX_QUOTED && !LINKISH.test(typed);
  const brought = quote ? typed : "";
  const thanks = (what: string) =>
    what ? `Thank you so much for bringing in ${what} today.` : "Thank you so much for what you brought in today.";
  const html = emailShell(
    raiseOrdinals(
      eyebrow(EYEBROW) +
        heading(SUBJECT) +
        bodyP(esc(hello)) +
        bodyP(thanks(brought ? `<b>${esc(brought)}</b>` : "")) +
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
