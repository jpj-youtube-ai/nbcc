import { describe, it, expect } from "vitest";
import { renderNewsletter, newsletterDocSchema, type NewsletterDoc } from "../../src/newsletter/blocks";
import { htmlToPlainText } from "../../src/newsletter/plain-text";

// TASK-645: preview text, the grey line an inbox shows after the subject. It rides on the document
// (no migration: the body is JSON) and reaches the email as a hidden line at the top of the body,
// ONLY when it is set. Every newsletter already written has no such field and must render exactly
// as before (newsletter-golden.test.ts pins that byte for byte; this file checks the new path).

const blocks: NewsletterDoc["blocks"] = [{ type: "text", variant: 0, data: { text: "Invented words for a newsletter." } }];
const ctx = { firstName: "Jane", unsubscribeUrl: "#" };

describe("preview text", () => {
  it("leaves the email exactly as it was when there is none, or only spaces", () => {
    const before = renderNewsletter({ blocks }, ctx);
    expect(renderNewsletter({ blocks, preheader: "" }, ctx)).toBe(before);
    expect(renderNewsletter({ blocks, preheader: "   " }, ctx)).toBe(before);
  });

  it("puts it first in the body, hidden, so an inbox shows it but the reader does not", () => {
    const html = renderNewsletter({ blocks, preheader: "Fifty bags packed in one invented evening" }, ctx);
    const body = html.slice(html.indexOf("<body"));
    const firstAfterBody = body.slice(body.indexOf(">") + 1).trimStart();
    expect(firstAfterBody.startsWith('<div style="display:none')).toBe(true);
    expect(firstAfterBody).toContain("Fifty bags packed in one invented evening");
    expect(firstAfterBody.slice(0, 300)).toContain("max-height:0");
    expect(firstAfterBody.slice(0, 300)).toContain("overflow:hidden");
  });

  it("is escaped, and greets by name the way the subject does", () => {
    const html = renderNewsletter({ blocks, preheader: "<b>Hi</b> {{firstName}}, a note & a thank you" }, ctx);
    expect(html).toContain("&lt;b&gt;Hi&lt;/b&gt; Jane, a note &amp; a thank you");
    const noName = renderNewsletter({ blocks, preheader: "Hey, {{firstName}}! A note" }, { firstName: "", unsubscribeUrl: "#" });
    expect(noName).toContain("Hey! A note");
    expect(noName).not.toContain("{{firstName}}");
  });

  it("is the first line of the plain-text version too", () => {
    const text = htmlToPlainText(renderNewsletter({ blocks, preheader: "An invented line for the inbox" }, ctx));
    expect(text.split("\n")[0]).toBe("An invented line for the inbox");
  });

  it("is an optional field of the document, kept when saved and capped at 150 characters", () => {
    expect(newsletterDocSchema.parse({ blocks: [] }).preheader).toBeUndefined();
    expect(newsletterDocSchema.parse({ blocks: [], preheader: "Kept" }).preheader).toBe("Kept");
    expect(newsletterDocSchema.safeParse({ blocks: [], preheader: "x".repeat(151) }).success).toBe(false);
  });
  // Review of #769: a "$" pattern in the words must reach the email as written, never be read as a
  // replacement pattern (which copied the rest of the email into the hidden line).
  it("keeps dollar signs as written", () => {
    for (const words of ["Win $' now", "$` and $1", "Save $& more $$"]) {
      const html = renderNewsletter({ blocks, preheader: words }, ctx);
      const expected = words.replace(/&/g, "&amp;");
      const body = html.slice(html.indexOf("<body"));
      const hidden = body.slice(body.indexOf(">") + 1, body.indexOf("</div>") + 6);
      expect(hidden).toContain(">" + expected + "</div>");
      expect(html.split("<body").length).toBe(2);
      expect(html.length).toBeLessThan(renderNewsletter({ blocks }, ctx).length + 400);
    }
  });
});
