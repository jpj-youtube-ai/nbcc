import { bodyP, button, emailShell, eyebrow, heading, questionsBox, questionsText, signOff, signOffText } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { FUNDRAISING_EMAIL, type BuiltEmail } from "./emails";
import { shortName } from "./model";

// In memory pages (Jaimie, 2026-10-03): email 19, "When you approve an in memory page (gentler, no
// fun sign off)", in the words Jaimie approved on 2026-10-02 (memory:
// nbcc-fundraising-emails-approved-2026-10-02). It is the only automatic email the organiser of an
// in memory page gets (src/fundraising/send.ts); everything else comes from staff, personally.
//
// Pure, in the same shell as the other fundraising emails: the events inbox as the contact, the
// sign off, then the questions box. The name they gave is escaped; it goes out only once staff have
// approved the page.

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const shell = (body: string) =>
  emailShell(body, { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

const SIGN_OFF = "With warmest thoughts,";

/** Email 19: the page is live, gently. `memoryName` is who it remembers, as they gave it. */
export function buildInMemoryApprovedEmail(f: { name: string; memoryName: string }, o: { pageUrl: string }): BuiltEmail {
  const who = f.memoryName.trim();
  const hi = `Hi ${shortName(f.name).split(" ")[0]},`;
  const thanks = (n: string) =>
    `Thank you for choosing to remember ${n} by raising money for NBCC. We’re honoured to be part of it, and we’re so sorry for your loss.`;
  const live = (n: string) => `Your page is now live. It’s a quiet place where family and friends can give and leave a message in ${n}’s memory.`;
  const anything = "If there’s anything you’d like changed, or anything we can do, please just let us know. There’s no rush at all.";
  const safe = escapeHtml(who);
  const body =
    eyebrow("Fundraising for NBCC") +
    heading(`In memory of ${safe}`) +
    bodyP(escapeHtml(hi)) +
    bodyP(thanks(safe)) +
    bodyP(live(safe)) +
    button(o.pageUrl, "See the page") +
    bodyP(anything);
  const html = shell(body + signOff(SIGN_OFF) + questionsBox(FUNDRAISING_EMAIL));
  const text = [
    hi,
    "",
    thanks(who),
    "",
    live(who),
    "",
    `See the page: ${o.pageUrl}`,
    "",
    anything,
    "",
    signOffText(SIGN_OFF),
    "",
    questionsText(FUNDRAISING_EMAIL),
    "",
    FOOTER_TEXT,
  ].join("\n");
  return { subject: `Your page in memory of ${who}`, html, text };
}
