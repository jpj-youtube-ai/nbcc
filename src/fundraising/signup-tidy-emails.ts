import { bodyP, button, emailShell, eyebrow, heading, note, questionsBox, questionsText, signOff, signOffText } from "../email/brand";
import { FOOTER_TEXT, POSTAL_ADDRESS } from "../legal/registration";
import { FUNDRAISING_EMAIL, safeFirstName, type BuiltEmail } from "./emails";
import { EMPLOYER_MATCH_LABELS, TSHIRT_LINK_DAYS, tshirtLabel, type EmployerMatch } from "./signup-tidy";

// The sign up tidy's emails (Jaimie and the appropriateness audit, 2026-10-03). Draft wording, for
// Jaimie to approve. From and replying to the events inbox (src/fundraising/send.ts).
//
//   - buildMemoryReceiptEmail: a short receipt for a page in memory of someone. Fixed words with no
//     name in it (anyone can type any address into the public form), and nothing upbeat.
//   - buildTshirtAskEmail: staff ask an organiser for their T shirt size (Admin > Fundraising, never
//     automatic), with the private link to choose it.
//   - tidyStaffFacts: the new answers, for the summary to the events inbox.

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const shell = (body: string) => emailShell(body, { contactEmail: FUNDRAISING_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

function toOrganiser(subject: string, bodyHtml: string, textLines: string[], line: string): BuiltEmail {
  const html = shell(bodyHtml + signOff(line) + questionsBox(FUNDRAISING_EMAIL));
  const text = [...textLines, "", signOffText(line), "", questionsText(FUNDRAISING_EMAIL), "", FOOTER_TEXT].join("\n");
  return { subject, html, text };
}

// --- in memory: the receipt -----------------------------------------------------------------------

export const MEMORY_RECEIPT_LINE = "We have your details for the page. Someone from NBCC will ring you in the next few days.";
const MEMORY_RECEIPT_SMALL = "If this wasn't you, you can ignore this email.";

export function buildMemoryReceiptEmail(): BuiltEmail {
  const body = eyebrow("In memory") + heading("Thank you") + bodyP(MEMORY_RECEIPT_LINE) + note(MEMORY_RECEIPT_SMALL);
  return toOrganiser("We have your details for the page", body, [MEMORY_RECEIPT_LINE, "", MEMORY_RECEIPT_SMALL], "With warmest thoughts,");
}

// --- asking for a T shirt size --------------------------------------------------------------------

export function buildTshirtAskEmail(typedName: string | null | undefined, url: string): BuiltEmail {
  const first = safeFirstName(typedName);
  const hi = first ? `Hi ${first},` : "Hi there,";
  const intro = "Thank you for signing up to fundraise for NBCC. As it's a sporting event, we'd love to send you an NBCC T shirt with your welcome pack.";
  const ask = "Please choose your size with the button below. It only takes a moment.";
  const small = `If it's for a child, choose their size. The link works for ${TSHIRT_LINK_DAYS} days.`;
  const body =
    eyebrow("Fundraising for NBCC") +
    heading("What size T shirt would you like?") +
    bodyP(escapeHtml(hi)) +
    bodyP(escapeHtml(intro)) +
    bodyP(escapeHtml(ask)) +
    button(url, "Choose my size") +
    note(escapeHtml(small));
  return toOrganiser(
    "Your NBCC T shirt: what size would you like?",
    body,
    [hi, "", intro, "", ask, "", `Choose my size: ${url}`, "", small],
    "Thanks so much,",
  );
}

// --- the new answers, for the events inbox ------------------------------------------------------------

export interface TidyFacts {
  inMemory?: boolean | null;
  isSporting?: boolean | null;
  tshirtSize?: string | null;
  childFirstName?: string | null;
  orgName?: string | null;
  employerMatch?: EmployerMatch | null;
  memorySetupBy?: string | null;
  memoryDirectorBusiness?: string | null;
  memoryFamilyContactName?: string | null;
  memoryFamilyContactEmail?: string | null;
  callTime?: string | null;
}

/** The new answers, each only when it was asked. */
export function tidyStaffFacts(f: TidyFacts): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  if (f.childFirstName) {
    facts.push([
      "Fundraising for their child",
      `${f.childFirstName}. They ticked to say they are a parent or guardian, happy for the first name and any photo to be shown on the page and our social media`,
    ]);
  }
  if (f.orgName) {
    facts.push(["Business, school or group", f.orgName]);
    if (f.employerMatch) facts.push(["Employer will match", EMPLOYER_MATCH_LABELS[f.employerMatch]]);
  }
  if (f.isSporting === true || f.isSporting === false) {
    facts.push(["Sporting event", f.isSporting ? "Yes" : "No"]);
    if (f.isSporting) facts.push(["T shirt size", f.tshirtSize ? tshirtLabel(f.tshirtSize) : "Not given yet. Ask them from Admin > Fundraising"]);
  }
  if (f.memoryDirectorBusiness) facts.push(["Funeral director", f.memoryDirectorBusiness]);
  const contact = [f.memoryFamilyContactName, f.memoryFamilyContactEmail].filter(Boolean).join(", ");
  if (contact) facts.push(["Send the names of people who gave to", contact]);
  if (f.callTime) facts.push(["A good time to call", f.callTime]);
  return facts;
}
