import { describe, it, expect } from "vitest";
import {
  buildDisclosure,
  type DisclosureBusiness,
  type DisclosureNote,
} from "../../src/outreach/disclosure";

// TASK-412: what we hold about one business, written out so a person can read it.
//
// This is a subject access response. A sole trader is an individual under UK GDPR and can ask;
// even where a business cannot, answering plainly is cheaper than arguing about entitlement. The
// legitimate-interests assessment promises "everything held, including the volunteers' private
// notes", so the test that matters most is the one proving nothing is quietly held back.

const ON = new Date("2026-09-04T10:00:00Z");

const business: DisclosureBusiness = {
  businessName: "Ayr Joinery Ltd",
  contactName: "Jane Baxter",
  contactEmail: "jane@ayrjoinery.co.uk",
  contactPhone: "01292 000000",
  businessType: "company",
  detailsSource: "website_or_listing",
  consentBasis: null,
  warmIntro: "Sarah's husband plays golf with the owner.",
  note: "Sponsored the gala last year.",
  owner: "Sarah",
  outcome: "not_this_year",
  askAgainOn: "2027-08-01",
  sentAt: "2026-08-12T09:00:00Z",
  sentBy: "sarah@nbcc.scot",
  createdAt: "2026-08-10T09:00:00Z",
};

const notes: DisclosureNote[] = [
  { author: "sarah@nbcc.scot", body: "Rang and spoke to Jim.\nHe was warm about it.", createdAt: "2026-09-02T09:00:00Z" },
];

const out = buildDisclosure(business, notes, ON);

/** The document is hard-wrapped, so a phrase can straddle a line break. Match the words, not the
 *  wrap. */
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("nothing is held back", () => {
  // The point of the whole document. A response that quietly omits the internal jottings is a
  // half-truth, and it is the half somebody asking would most want to see.
  it("includes the volunteers' private notes, in full", () => {
    expect(out).toContain("Rang and spoke to Jim.");
    expect(out).toContain("He was warm about it.");
    expect(out).toContain("sarah@nbcc.scot");
  });

  it("includes the two internal fields the screen calls private", () => {
    expect(out).toContain("Sarah's husband plays golf with the owner.");
    expect(out).toContain("Sponsored the gala last year.");
  });

  it.each([
    ["Ayr Joinery Ltd", "the business name"],
    ["Jane Baxter", "the contact name"],
    ["jane@ayrjoinery.co.uk", "the email"],
    ["01292 000000", "the phone number"],
    ["Sarah", "who is looking after them"],
  ])("includes %s (%s)", (value) => {
    expect(out).toContain(value);
  });

  it("says what happened and when we said we would return", () => {
    expect(out).toContain("Not this year");
    expect(out).toContain("1 August 2027");
    expect(out).toContain("12 August 2026");
  });
});

describe("it reads as an answer to a person", () => {
  // Addressed to them, not about them. "The data subject's contact_email" is not an answer.
  it("is written in the second person", () => {
    expect(out).toMatch(/your details/i);
    expect(out).toMatch(/how we came to contact you/i);
  });

  it("uses no column names", () => {
    for (const jargon of ["contact_email", "business_name", "details_source", "ask_again_on", "null"]) {
      expect(out, jargon).not.toContain(jargon);
    }
  });

  // Required of any charity communication, and the thing that makes it verifiable as ours.
  it("identifies the charity and how to complain", () => {
    expect(out).toContain("SC047995");
    expect(out).toContain("Scottish Charitable Incorporated Organisation");
    expect(out).toContain("nbcc.scot/privacy");
  });

  // The two reassurances a business actually wants, stated rather than implied.
  it("says plainly what we do not do", () => {
    expect(out).toMatch(/never sell/i);
    expect(out).toMatch(/not profile you/i);
  });

  it("tells them how to get it changed or stopped", () => {
    expect(flat(out)).toMatch(/if you would rather we did not contact you again/i);
  });
});

describe("what is missing simply is not mentioned", () => {
  const bare = buildDisclosure(
    {
      ...business,
      contactName: null,
      contactPhone: null,
      warmIntro: null,
      note: null,
      owner: null,
      outcome: null,
      askAgainOn: null,
      sentAt: null,
      sentBy: null,
    },
    [],
    ON,
  );

  // Blank lines reading "Phone number:" tell somebody we hold a phone number and will not say it.
  it("leaves out a field we do not hold rather than printing it empty", () => {
    expect(bare).not.toMatch(/Phone number:\s*$/m);
    expect(bare).not.toMatch(/Contact name:\s*$/m);
  });

  it("says outright that we never emailed them", () => {
    expect(bare).toContain("We have not emailed you.");
  });

  it("says there are no notes rather than showing an empty heading", () => {
    expect(bare).toContain("(none)");
  });
});

describe("how we got their details", () => {
  it.each([
    ["given_to_us", /you gave them to us/i],
    ["referred", /passed your details/i],
    ["social", /social media/i],
  ])("says it plainly for %s", (source, expected) => {
    expect(buildDisclosure({ ...business, detailsSource: source }, [], ON)).toMatch(expected);
  });

  // The volunteer's own words about how a sole trader agreed, quoted rather than paraphrased -
  // it is the sentence somebody may one day have to stand behind.
  it("quotes the recorded agreement for a sole trader", () => {
    const st = buildDisclosure(
      { ...business, businessType: "sole_trader", consentBasis: "Gave me her card at the Chamber breakfast." },
      [],
      ON,
    );
    expect(st).toContain("Gave me her card at the Chamber breakfast.");
    expect(st).toContain("Sole trader or partnership");
  });
});
