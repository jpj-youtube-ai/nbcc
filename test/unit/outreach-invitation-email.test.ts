import { describe, it, expect } from "vitest";
import {
  detailsSourceSentence,
  DETAILS_SOURCES,
  buildOutreachEmail,
  buildOutreachEmailHtml,
  buildOutreachEmailText,
  outreachSubject,
  type OutreachInvitation,
} from "../../src/outreach/invitation-email";

// TASK-351: the cold outreach email. The copy rules here are inherited from the approved NBCC
// email family and from the Code of Fundraising Practice, and each one below has a reason.

const base: OutreachInvitation = {
  businessName: "Ayr Joinery Ltd",
  contactName: "Jane Baxter",
  personalMessage: null,
  signerName: "Jaimie Wakefield",
  signerRole: "Project Manager, Night Before Christmas Campaign",
  donateUrl: "https://nbcc.scot/donate",
  bookletUrl: "https://nbcc.scot/assets/nbcc-business-booklet-2026.pdf",
  privacyUrl: "https://nbcc.scot/privacy",
};

const build = (over: Partial<OutreachInvitation> = {}) => buildOutreachEmail({ ...base, ...over });

/** The text half is hard-wrapped, so a phrase can straddle a line break. Match the words, not
 *  where the wrap happens to fall. */
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("the greeting", () => {
  // "Hello Jane" against "Hello" is the difference between a letter and a mailshot, and a
  // business owner can tell which they are reading in the first three words.
  it("uses the contact's first name where a volunteer knew one", () => {
    expect(build().html).toContain("Hello Jane,");
  });

  it("falls back to a plain hello rather than guessing", () => {
    const mail = build({ contactName: null });
    expect(mail.html).toContain("Hello,");
    expect(mail.text).toContain("Hello,");
  });

  // Both of these announce a mailshot.
  it("never greets the company itself, and never says Dear Sir or Madam", () => {
    const mail = build({ contactName: null });
    expect(mail.html).not.toMatch(/Hello Ayr Joinery/i);
    expect(mail.html).not.toMatch(/dear sir/i);
  });
});

describe("the volunteer's personal message", () => {
  const withNote = build({
    personalMessage: "We met at the Ayrshire Chamber breakfast in June.\nLovely to talk shop.",
  });

  it("appears in both halves of the email", () => {
    expect(withNote.html).toContain("Ayrshire Chamber breakfast");
    expect(withNote.text).toContain("Ayrshire Chamber breakfast");
  });

  it("keeps the line breaks a person typed", () => {
    expect(withNote.html).toContain("<br />");
  });

  // A volunteer typing an ampersand or an angle bracket must not be able to break the layout.
  it("escapes what the volunteer typed", () => {
    const risky = build({ personalMessage: "<script>alert(1)</script> Smith & Sons" });
    expect(risky.html).not.toContain("<script>");
    expect(risky.html).toContain("&lt;script&gt;");
    expect(risky.html).toContain("Smith &amp; Sons");
  });

  // The email has to read properly without one, because most will not have one.
  it("leaves no empty space behind when there is no message", () => {
    const plain = build({ personalMessage: null });
    expect(plain.html).not.toContain("border-left:3px solid");
    expect(plain.text).not.toMatch(/\n\n\n/);
  });

  it("ignores a message that is only whitespace", () => {
    expect(build({ personalMessage: "   \n  " }).html).not.toContain("border-left:3px solid");
  });
});

describe("the copy rules", () => {
  const mail = build({ personalMessage: "A note from us." });

  // Code of Fundraising Practice: never "£25 buys a school coat".
  it("makes no definitive claim about what money buys", () => {
    expect(mail.text).toMatch(/could help/i);
    expect(mail.text).not.toMatch(/£\s?\d+\s+(buys|provides|pays for)/i);
  });

  // Inherited from the approved family. The CSS and URLs are not copy, so only the text half is
  // checked - that is the half that is nothing but human words.
  it("uses no dashes of any kind in the human copy", () => {
    const humanCopy = mail.text.replace(/https?:\/\/\S+/g, "");
    expect(humanCopy).not.toMatch(/[-–—]/);
  });

  it("describes beneficiaries the way NBCC asks to be described", () => {
    expect(mail.text).toContain("children, young people and vulnerable adults");
  });

  it("calls the charity by its full name, never another abbreviation", () => {
    expect(mail.text).toContain("Night Before Christmas Campaign");
  });
});

describe("what the law requires of a cold approach", () => {
  const mail = build();

  // PECR: every marketing message needs a way to opt out, including to companies.
  it("offers a way to opt out, in plain words", () => {
    expect(flat(mail.text)).toMatch(/would rather we did not contact you again/i);
    expect(flat(mail.html)).toMatch(/would rather we did not contact you again/i);
  });

  // UK GDPR Article 14: where personal data came from somewhere other than the person - a company
  // website, a local directory - they must be told, and the first communication is the deadline.
  // This email IS that first communication, so the answer cannot live only on a page they would
  // have to think to go and find.
  it("says where we got their details, and points at the privacy notice", () => {
    for (const half of [mail.html, mail.text]) {
      expect(flat(half)).toMatch(/we found your details/i);
      expect(flat(half)).toMatch(/own website or a local business listing/i);
    }
    expect(mail.html).toContain("https://nbcc.scot/privacy");
    expect(mail.text).toContain("https://nbcc.scot/privacy");
  });

  // A fixed sentence would be wrong for a business that handed over a card, and a disclosure
  // that is wrong is worse than one that is vague.
  it("says the source the volunteer actually recorded", () => {
    expect(flat(build({ detailsSource: "given_to_us" }).text)).toMatch(/you gave us these details/i);
    expect(flat(build({ detailsSource: "referred" }).text)).toMatch(/someone we both know/i);
    expect(flat(build({ detailsSource: "social" }).text)).toMatch(/social media/i);
  });

  it("falls back to the commonest source rather than saying nothing", () => {
    expect(detailsSourceSentence(null)).toBe(DETAILS_SOURCES.website_or_listing + ", and nowhere else.");
    expect(detailsSourceSentence("not-a-source")).toContain("website or a local business listing");
  });

  // "We bought a list" is the thing a business fears, so the email says the opposite outright.
  it("says plainly that this is the only place we got them", () => {
    expect(flat(mail.text)).toMatch(/and nowhere else/i);
    for (const source of Object.keys(DETAILS_SOURCES)) {
      expect(detailsSourceSentence(source), source).toMatch(/and nowhere else\.$/);
    }
  });

  // 2005 Act and the SCIO Regulations, from the single source of truth rather than retyped.
  it("carries the charity registration statement", () => {
    expect(mail.html).toMatch(/SC047995/);
    expect(mail.text).toMatch(/SC047995/);
    expect(mail.text).toMatch(/Scottish Charitable Incorporated Organisation/);
  });

  // The recipient did not ask to hear from us, so the email has to say who is writing.
  it("says who it is from, by name and role", () => {
    expect(mail.html).toContain("Jaimie Wakefield");
    expect(mail.html).toContain("Project Manager");
  });

  // A cold approach is the one email whose recipient has most reason to want a person on the end
  // of a phone rather than a reply box. Both halves carry both, and the HTML makes them tappable.
  it("gives a phone number and an email address, not just a reply box", () => {
    for (const half of [mail.html, mail.text]) {
      expect(half).toContain("01292 811 015");
      expect(half).toContain("info@nbcc.scot");
    }
    expect(mail.html).toContain('href="tel:+441292811015"');
    expect(mail.html).toContain('href="mailto:info@nbcc.scot"');
  });
});

describe("the shape of it", () => {
  const mail = build();

  it("has one clear call to action and both links", () => {
    expect((mail.html.match(/Become a supporter/g) ?? []).length).toBe(1);
    expect(mail.html).toContain("https://nbcc.scot/donate");
    expect(mail.html).toContain("nbcc-business-booklet-2026.pdf");
  });

  it("names the business it is actually written to", () => {
    expect(mail.html).toContain("Ayr Joinery Ltd");
  });

  // Dark-mode clients invert unstyled mail, which would turn the maroon letterhead muddy.
  it("pins the colour scheme so dark mode does not invert it", () => {
    expect(mail.html).toContain('name="color-scheme" content="light"');
  });

  it("has a subject that reads the same in a preview pane as in a list", () => {
    expect(outreachSubject()).toBe("A small idea from a local charity");
    expect(outreachSubject().length).toBeLessThan(60);
  });

  it("builds both formats from the same input", () => {
    expect(buildOutreachEmailHtml(base)).toBe(mail.html);
    expect(buildOutreachEmailText(base)).toBe(mail.text);
  });
});
