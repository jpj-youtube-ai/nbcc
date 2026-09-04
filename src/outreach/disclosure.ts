import { OUTCOME_LABELS } from "./outcomes";
import { DETAILS_SOURCES } from "./invitation-email";

// TASK-412: everything we hold about one business, written out so a person can read it.
//
// Pure - no pool, no config - so the wording is unit-tested without a database (golden rule 5).
//
// This is a subject access response. A sole trader is an individual under UK GDPR and can ask what
// we hold; even where they cannot, answering plainly is cheaper than arguing about whether they
// are entitled to. The legitimate-interests assessment promises "one click in the admin produces
// everything held about a business, including the volunteers' private notes", so the notes are in
// here, in full, and the screen where they are typed says so.
//
// Plain text on purpose. It gets pasted into a reply, and a JSON file is not an answer to a person
// asking a reasonable question.

export interface DisclosureBusiness {
  businessName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  businessType: string;
  detailsSource: string;
  consentBasis: string | null;
  warmIntro: string | null;
  note: string | null;
  owner: string | null;
  outcome: string | null;
  askAgainOn: string | null;
  sentAt: string | null;
  sentBy: string | null;
  createdAt: string;
}

export interface DisclosureNote {
  author: string;
  body: string;
  createdAt: string;
}

const date = (v: string | null): string =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";

/** "Label: value", dropped entirely when there is no value. Empty lines say nothing useful. */
function line(label: string, value: string | null | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

/**
 * Everything held about one business, as a letter somebody can send.
 *
 * Written in the second person because it is addressed to them, not about them, and every field is
 * named the way a person would say it rather than the way the column is spelled.
 */
export function buildDisclosure(
  b: DisclosureBusiness,
  notes: DisclosureNote[],
  generatedOn: Date,
): string {
  const source =
    (DETAILS_SOURCES as Record<string, string>)[b.detailsSource] ??
    DETAILS_SOURCES.website_or_listing;

  const held = [
    line("Business name", b.businessName),
    line("Contact name", b.contactName),
    line("Email address", b.contactEmail),
    line("Phone number", b.contactPhone),
    line(
      "Kind of business",
      b.businessType === "sole_trader" ? "Sole trader or partnership" : "Limited company or LLP",
    ),
    line("Who is looking after this", b.owner),
  ].filter(Boolean);

  const how = [
    `Where your details came from: ${source.replace(/^We found your details/, "we found them").replace(/^You gave us these details/, "you gave them to us")}.`,
    b.consentBasis ? `How you agreed to hear from us, as our volunteer recorded it: "${b.consentBasis}"` : null,
    line("Added to our list on", date(b.createdAt)),
    b.sentAt
      ? `We emailed you on ${date(b.sentAt)}${b.sentBy ? ` (sent by ${b.sentBy})` : ""}.`
      : "We have not emailed you.",
    b.outcome ? `What we recorded happened: ${OUTCOME_LABELS[b.outcome as keyof typeof OUTCOME_LABELS] ?? b.outcome}.` : null,
    b.askAgainOn ? `We noted to get back in touch around ${date(b.askAgainOn)}.` : null,
  ].filter(Boolean);

  // The internal jottings, in full. Holding these back would make the rest of the answer a
  // half-truth, and the screen where they are written tells volunteers they may be read.
  const internal = [
    b.warmIntro ? `Who we thought might know you: "${b.warmIntro}"` : null,
    b.note ? `Why we thought you might be interested: "${b.note}"` : null,
  ].filter(Boolean);

  const written = notes.length
    ? notes.map((n) => `  ${date(n.createdAt)} — ${n.author}\n  "${n.body.replace(/\n/g, "\n  ")}"`)
    : ["  (none)"];

  return [
    `WHAT THE NIGHT BEFORE CHRISTMAS CAMPAIGN HOLDS ABOUT ${b.businessName.toUpperCase()}`,
    `Prepared ${date(generatedOn.toISOString())}`,
    "",
    "Night Before Christmas Campaign is a Scottish Charitable Incorporated Organisation,",
    "charity number SC047995, regulated by the Scottish Charity Regulator, OSCR.",
    "The Elves Workshop, Annbank Village Hall, Weston Avenue, Annbank, KA6 5EE.",
    "",
    "YOUR DETAILS",
    ...held.map((l) => `  ${l}`),
    "",
    "HOW WE CAME TO CONTACT YOU",
    ...how.map((l) => `  ${l}`),
    "",
    "WHAT OUR VOLUNTEERS WROTE",
    ...internal.map((l) => `  ${l}`),
    ...(internal.length ? [""] : []),
    "  Notes:",
    ...written,
    "",
    "WHAT WE DO NOT DO",
    "  We have not shared your details with anyone, and we never sell them.",
    "  We do not profile you, and nothing about you is decided automatically.",
    "",
    "IF YOU WANT THIS CHANGED",
    "  Reply and say so. We will correct anything wrong, and if you would rather we did not",
    "  contact you again we will keep only your business name and a note not to write to you,",
    "  so that nobody here contacts you by mistake later.",
    "",
    "  Our privacy notice is at nbcc.scot/privacy.",
  ].join("\n");
}
