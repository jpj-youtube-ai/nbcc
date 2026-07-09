import { describe, it, expect } from "vitest";
import {
  buildThankYouEmailHtml,
  buildThankYouEmailText,
  thankYouSubject,
  type ThankYouLetterView,
} from "../../src/thank-you/letter";

// TASK-163 (REQ-069): the pure, branded thank-you letter → email HTML builder.
// DB-free and config-free (CLAUDE.md rule 5 — logic gets a unit test); the route
// that sends it is exercised via BDD. The letter is the same content the admin
// composes in the "Thank you" view; here we assemble it as a self-contained HTML
// email (inline colours, since email clients don't load the site stylesheet).

const base: ThankYouLetterView = {
  thankYouName: "Margaret",
  addressedTo: "Mrs Robertson",
  giftType: "money",
  giftAmountPence: 150000,
  giftInKind: null,
  giftAided: true,
  personalMessage: "It was lovely to meet you at the Elves Workshop.",
  signedByName: "Jodie McFarlane",
  signedByRole: "Head Elf (Trustee), Night Before Christmas Campaign",
  letterDate: "25 December 2026",
};

describe("thank-you letter (REQ-069 · TASK-163)", () => {
  describe("thankYouSubject", () => {
    it("greets by the thank-you name", () => {
      expect(thankYouSubject({ thankYouName: "Margaret" })).toBe("Thank you, Margaret");
    });
  });

  describe("buildThankYouEmailHtml", () => {
    it("renders the title, salutation and letter date", () => {
      const html = buildThankYouEmailHtml(base);
      expect(html).toContain("Thank you, Margaret.");
      expect(html).toContain("Dear Mrs Robertson,");
      expect(html).toContain("25 December 2026");
    });

    it("states the money gift and the 25% Gift Aid uplift when Gift Aided", () => {
      const html = buildThankYouEmailHtml(base);
      expect(html).toContain("£1500.00"); // the gift (model formatting: no thousands grouping)
      expect(html).toContain("£1875.00"); // gift + 25% HMRC uplift
      expect(html).toContain("25%");
    });

    it("omits the Gift Aid uplift line when not Gift Aided", () => {
      const html = buildThankYouEmailHtml({ ...base, giftAided: false });
      expect(html).toContain("£1500.00");
      expect(html).not.toContain("£1875.00");
      expect(html).not.toContain("25%");
    });

    it("renders an in-kind gift with its description and no amount", () => {
      const html = buildThankYouEmailHtml({
        ...base,
        giftType: "in_kind",
        giftAmountPence: null,
        giftInKind: "40 selection boxes and a hamper of gifts",
        giftAided: false,
      });
      expect(html).toContain("40 selection boxes and a hamper of gifts");
      expect(html).not.toContain("£");
      expect(html).not.toContain("25%");
    });

    it("includes the personal message when present and omits it when null", () => {
      expect(buildThankYouEmailHtml(base)).toContain("It was lovely to meet you at the Elves Workshop.");
      const without = buildThankYouEmailHtml({ ...base, personalMessage: null });
      expect(without).not.toContain("It was lovely to meet you");
    });

    it("signs off with the signer's name and role", () => {
      const html = buildThankYouEmailHtml(base);
      expect(html).toContain("Jodie McFarlane");
      expect(html).toContain("Head Elf (Trustee), Night Before Christmas Campaign");
    });

    it("carries the charity registration footer and giving address", () => {
      const html = buildThankYouEmailHtml(base);
      expect(html).toContain("SC047995");
      expect(html).toContain("giving@nbcc.scot");
    });

    it("includes the branded lockup: the real logo (absolute URL) and the tagline", () => {
      const html = buildThankYouEmailHtml(base);
      expect(html).toContain("https://nbcc.scot/assets/img/nbcc-logo.png");
      expect(html).toContain("Here all year");
    });

    it("carries the letterhead sender, pull-quote and donate CTA from the mockup", () => {
      const html = buildThankYouEmailHtml(base);
      expect(html).toContain("Elves Workshop");
      expect(html).toContain("One random act of kindness at a time.");
      expect(html).toContain("nbcc.scot/donate");
      expect(html).toContain("7,657"); // the impact stat paragraph
    });

    it("sets the signature in the script font stack, not the heading font", () => {
      const html = buildThankYouEmailHtml(base);
      // the signer's name sits in a span whose font-family is the cursive/script stack
      expect(html).toMatch(/font-family:[^"]*Snell Roundhand[^"]*cursive[^"]*">Jodie McFarlane</);
    });

    it("HTML-escapes donor-supplied fields", () => {
      const html = buildThankYouEmailHtml({
        ...base,
        thankYouName: "<script>alert(1)</script>",
        personalMessage: "Tom & Jerry <3",
      });
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("Tom &amp; Jerry &lt;3");
    });

    it("adds a 'View & print your letter' button only when a printUrl is given (TASK-165)", () => {
      expect(buildThankYouEmailHtml(base)).not.toContain("View &amp; print your letter");
      const withLink = buildThankYouEmailHtml({ ...base, printUrl: "https://nbcc.scot/thank-you/letter/7.sig" });
      expect(withLink).toContain("View &amp; print your letter");
      expect(withLink).toContain('href="https://nbcc.scot/thank-you/letter/7.sig"');
    });
  });

  describe("buildThankYouEmailText (TASK-165 deliverability)", () => {
    it("produces a plain-text alternative with the key letter content", () => {
      const text = buildThankYouEmailText({ ...base, printUrl: "https://nbcc.scot/thank-you/letter/7.sig" });
      expect(text).toContain("Thank you, Margaret.");
      expect(text).toContain("Dear Mrs Robertson,");
      expect(text).toContain("£1500.00");
      expect(text).toContain("£1875.00"); // Gift Aid uplift
      expect(text).toContain("It was lovely to meet you at the Elves Workshop.");
      expect(text).toContain("Jodie McFarlane");
      expect(text).toContain("View & print your letter: https://nbcc.scot/thank-you/letter/7.sig");
      expect(text).toContain("SC047995");
      // plain text carries no HTML tags
      expect(text).not.toMatch(/<[a-z]/i);
    });

    it("uses the in-kind wording and omits the uplift for an in-kind gift", () => {
      const text = buildThankYouEmailText({
        ...base,
        giftType: "in_kind",
        giftAmountPence: null,
        giftInKind: "40 selection boxes",
        giftAided: false,
      });
      expect(text).toContain("your donation of 40 selection boxes");
      expect(text).not.toContain("25%");
    });
  });
});
