import { describe, it, expect } from "vitest";
import { buildThankYouLetterPage, type ThankYouLetterPageData } from "../../src/thank-you/letter-page";

// TASK-165 (REQ-069): the public printable letter page, rendered from a stored thank_you_sent row.
// Pure and DB-free (the route loads the row), so it is unit-tested directly.

const base: ThankYouLetterPageData = {
  thankYouName: "Margaret",
  addressedTo: "Mrs Robertson",
  giftType: "money",
  giftAmountPence: 150000,
  giftInKind: null,
  giftAided: true,
  personalMessage: "It was lovely to meet you at the Elves Workshop.",
  signedByName: "Jodie McFarlane",
  signedByRole: "Head Elf (Trustee), Night Before Christmas Campaign",
  sentAt: "2026-12-25T18:20:00.000Z",
};

describe("thank-you letter page (REQ-069 · TASK-165)", () => {
  it("renders the title, salutation and the date from sent_at", () => {
    const html = buildThankYouLetterPage(base);
    expect(html).toContain("Thank you, Margaret.");
    expect(html).toContain("Dear Mrs Robertson,");
    expect(html).toContain("25 December 2026"); // formatted from sentAt
  });

  it("carries the branded lockup, script signature and a print button", () => {
    const html = buildThankYouLetterPage(base);
    expect(html).toContain("/assets/img/nbcc-logo.png");
    expect(html).toContain("Here all year");
    expect(html).toContain("window.print()"); // the Print / Save as PDF button
    expect(html).toMatch(/Snell Roundhand[^<]*cursive/); // signature stack
    expect(html).toContain("Head Elf (Trustee), Night Before Christmas Campaign");
  });

  it("shows the money gift with the 25% Gift Aid uplift (grouped) when Gift Aided", () => {
    const html = buildThankYouLetterPage(base);
    expect(html).toContain("£1,500");
    expect(html).toContain("£1,875");
    expect(html).toContain("25%");
  });

  it("renders an in-kind gift with no amount or uplift", () => {
    const html = buildThankYouLetterPage({
      ...base,
      giftType: "in_kind",
      giftAmountPence: null,
      giftInKind: "40 selection boxes and a hamper",
      giftAided: false,
    });
    expect(html).toContain("40 selection boxes and a hamper");
    expect(html).not.toContain("25%");
  });

  it("carries the pull-quote, donate CTA and charity registration footer", () => {
    const html = buildThankYouLetterPage(base);
    expect(html).toContain("One random act of kindness at a time.");
    expect(html).toContain("nbcc.scot/donate");
    expect(html).toContain("SC047995");
  });

  it("makes the donate, email, phone and site references clickable links (TASK-177)", () => {
    const html = buildThankYouLetterPage(base);
    expect(html).toContain('href="https://nbcc.scot/donate"');
    expect(html).toContain('href="mailto:giving@nbcc.scot"');
    expect(html).toContain('href="tel:+441292811015"');
    expect(html).toContain('href="https://nbcc.scot"');
  });

  it("omits the role line when the signatory role is unknown (older rows)", () => {
    const html = buildThankYouLetterPage({ ...base, signedByRole: null });
    // the .sig-role class still appears in the <style> block; assert the rendered element is absent
    expect(html).not.toContain('class="sig-role"');
    expect(html).not.toContain("Head Elf (Trustee)");
  });

  it("HTML-escapes donor-supplied fields", () => {
    const html = buildThankYouLetterPage({ ...base, thankYouName: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("prints on a single A4 page on mobile as well as desktop (TASK-197)", () => {
    const html = buildThankYouLetterPage(base);
    // Mobile browsers auto-inflate body text on a wide, fixed-width (210mm) page viewed in a
    // narrow viewport, which pushed the letter past one sheet (the user had to scale to ~78%).
    // Pinning text-size-adjust makes the letter render at the same size as desktop.
    expect(html).toMatch(/text-size-adjust:\s*100%/);
    // In print, the sheet is clamped to exactly one A4 page (fixed height + clip) instead of a
    // zero-tolerance min-height that tips onto a blank second page when a device rounds up.
    const printBlock = html.match(/@media print\{([\s\S]*?)@page/);
    expect(printBlock).not.toBeNull();
    expect(printBlock![1]).toContain("height:297mm");
    expect(printBlock![1]).toContain("overflow:hidden");
  });
});
