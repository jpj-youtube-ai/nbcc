import { describe, it, expect } from "vitest";
import { preflightNewsletter, hasBlockingFindings, type PreflightContext } from "../../src/newsletter/preflight";
import type { NewsletterDoc } from "../../src/newsletter/blocks";

// TASK-277 (letter P): the checks that run before a newsletter goes out.
//
// A send is the one action in this admin that cannot be undone. These are the mistakes that are
// obvious in hindsight and invisible while writing — a button that goes nowhere, a mistyped merge tag
// that reaches every reader as literal text — surfaced while someone can still act on them.

const doc = (blocks: NewsletterDoc["blocks"]): NewsletterDoc => ({ blocks });
const ctx = (over: Partial<PreflightContext> = {}): PreflightContext => ({
  testSent: true,
  subject: "Our winter update",
  ...over,
});
const block = (type: string, data: Record<string, unknown>) =>
  ({ type, variant: 0, data, size: 0 }) as NewsletterDoc["blocks"][number];

const messages = (findings: { message: string }[]) => findings.map((f) => f.message).join(" | ");

describe("preflightNewsletter", () => {
  it("says nothing about a newsletter that is ready", () => {
    const findings = preflightNewsletter(
      doc([block("text", { text: "Hello {{firstName}}" }), block("button", { label: "Give", href: "https://nbcc.scot/donate" })]),
      ctx(),
    );
    expect(findings).toEqual([]);
    expect(hasBlockingFindings(findings)).toBe(false);
  });

  it("blocks an empty newsletter and an empty subject", () => {
    const findings = preflightNewsletter(doc([]), ctx({ subject: "  " }));
    expect(messages(findings)).toMatch(/no content/i);
    expect(messages(findings)).toMatch(/subject line is empty/i);
    expect(hasBlockingFindings(findings)).toBe(true);
  });

  // The renderer silently drops a button with no href, so it never looks wrong in the preview either.
  it("blocks a button that goes nowhere", () => {
    const findings = preflightNewsletter(doc([block("button", { label: "Donate", href: "" })]), ctx());
    expect(messages(findings)).toMatch(/no working link/i);
    expect(hasBlockingFindings(findings)).toBe(true);
  });

  it("blocks a link that is not really a link", () => {
    const findings = preflightNewsletter(doc([block("button", { label: "Go", href: "nbcc.scot/donate" })]), ctx());
    expect(messages(findings)).toMatch(/no working link/i);
  });

  it("accepts mailto and tel as real destinations", () => {
    const findings = preflightNewsletter(
      doc([block("button", { label: "Email", href: "mailto:giving@nbcc.scot" }), block("button", { label: "Call", href: "tel:+441292811015" })]),
      ctx(),
    );
    expect(findings).toEqual([]);
  });

  // A mistyped tag is NOT substituted — it reaches every reader exactly as written.
  it("blocks a merge tag we do not understand, in the subject or the body", () => {
    const subjectFindings = preflightNewsletter(doc([block("text", { text: "hi" })]), ctx({ subject: "Hi {{firstname}}" }));
    expect(messages(subjectFindings)).toMatch(/not a merge tag/i);
    expect(messages(subjectFindings)).toMatch(/firstName/);

    const bodyFindings = preflightNewsletter(doc([block("text", { text: "Dear {{name}}," })]), ctx());
    expect(messages(bodyFindings)).toMatch(/not a merge tag/i);
  });

  it("accepts the tag we do support, spaces and all", () => {
    const findings = preflightNewsletter(doc([block("text", { text: "Hi {{firstName}}" })]), ctx({ subject: "Hi {{firstName}}" }));
    expect(findings).toEqual([]);
  });

  // Images are blocked by default in many inboxes, so no alt means nothing is there for that reader.
  it("warns — but does not block — on an image with no description", () => {
    const findings = preflightNewsletter(doc([block("image", { url: "https://x/y.png", alt: "" })]), ctx());
    expect(messages(findings)).toMatch(/no description/i);
    expect(hasBlockingFindings(findings)).toBe(false);
  });

  it("counts repeated problems rather than repeating itself", () => {
    const findings = preflightNewsletter(
      doc([block("image", { alt: "" }), block("image", { alt: "" }), block("image", { alt: "a real description" })]),
      ctx(),
    );
    const alt = findings.filter((f) => /description/i.test(f.message));
    expect(alt).toHaveLength(1);
    expect(alt[0].message).toMatch(/^2 images/);
  });

  it("warns when no test copy has been sent", () => {
    const findings = preflightNewsletter(doc([block("text", { text: "hi" })]), ctx({ testSent: false }));
    expect(messages(findings)).toMatch(/test copy/i);
    expect(hasBlockingFindings(findings)).toBe(false);
  });

  it("survives a malformed block without throwing", () => {
    const findings = preflightNewsletter(
      { blocks: [{ type: "text", variant: 0, data: undefined as never, size: 0 }] },
      ctx(),
    );
    expect(Array.isArray(findings)).toBe(true);
  });
});
