import { bodyP, button, emailShell, eyebrow, heading, questionsBox, questionsText, signOff, signOffText } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { FUNDRAISING_EMAIL, organiserGreeting, type BuiltEmail } from "./emails";

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

// Jaimie's decision (A2, 2026-10-03): a funeral director gets a professional version, with no
// "sorry for your loss": thanked for setting the page up for the family, and the practical lines
// (the page, the collection envelopes, how messages are checked). Draft wording, for Jaimie.
const DIRECTOR_ENVELOPES =
  "You can print collection envelopes for the service from your private area, each with a Gift Aid declaration. Please post the sealed envelopes to us unopened, or hand them in, so we can claim Gift Aid on them.";
const DIRECTOR_MESSAGES = "Our team reads every message before it shows on the page.";

/**
 * Email 19: the page is live, gently. `memoryName` is who it remembers, as they gave it. Set up by a
 * funeral director, it is the professional version (see above).
 */
export function buildInMemoryApprovedEmail(
  f: { name: string; firstName?: string | null; memoryName: string; setupBy?: string | null },
  o: { pageUrl: string },
): BuiltEmail {
  const who = f.memoryName.trim();
  // "Hi there," for a business's name or none (organiserGreeting), never "Hi The,".
  const hi = organiserGreeting(f);
  const director = f.setupBy === "funeral_director";
  const thanks = (n: string) =>
    director
      ? `Thank you for setting up this page for the family of ${n}. It is now live on our website, ready to share with everyone who would like to give in their memory.`
      : `Thank you for choosing to remember ${n} by raising money for NBCC. We’re honoured to be part of it, and we’re so sorry for your loss.`;
  const live = (n: string) => `Your page is now live. It’s a quiet place where family and friends can give and leave a message in ${n}’s memory.`;
  const anything = "If there’s anything you’d like changed, or anything we can do, please just let us know. There’s no rush at all.";
  const safe = escapeHtml(who);
  const middle = director ? [DIRECTOR_ENVELOPES, DIRECTOR_MESSAGES] : [];
  const body =
    eyebrow("Fundraising for NBCC") +
    heading(`In memory of ${safe}`) +
    bodyP(escapeHtml(hi)) +
    bodyP(thanks(safe)) +
    (director ? "" : bodyP(live(safe))) +
    button(o.pageUrl, "See the page") +
    middle.map((m) => bodyP(m)).join("") +
    bodyP(anything);
  const html = shell(body + signOff(SIGN_OFF) + questionsBox(FUNDRAISING_EMAIL));
  const text = [
    hi,
    "",
    thanks(who),
    ...(director ? [] : ["", live(who)]),
    "",
    `See the page: ${o.pageUrl}`,
    ...middle.flatMap((m) => ["", m]),
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
