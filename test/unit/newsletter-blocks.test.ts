import { describe, it, expect } from "vitest";
import { renderNewsletter, newsletterDocSchema } from "../../src/newsletter/blocks";

const ctx = { firstName: "Jane" };

describe("newsletter blocks — core", () => {
  it("renders the full framed email for a masthead block", () => {
    const html = renderNewsletter(
      { blocks: [{ type: "masthead", variant: 0, data: { issueTitle: "July Newsletter" } }] },
      ctx,
    );
    expect(html).toContain("<!doctype html>"); // frame
    expect(html).toContain("July Newsletter");
    expect(html).toContain("nbcc-logo.png"); // logo present
    expect(html).toContain("SC047995"); // footer
  });

  it("rawHtml passthrough renders its HTML verbatim inside the frame", () => {
    const html = renderNewsletter(
      { blocks: [{ type: "rawHtml", variant: 0, data: { html: "<p>LEGACY-BODY</p>" } }] },
      ctx,
    );
    expect(html).toContain("<p>LEGACY-BODY</p>");
  });

  it("schema rejects an unknown type", () => {
    const r = newsletterDocSchema.safeParse({ blocks: [{ type: "nope", variant: 0, data: {} }] });
    expect(r.success).toBe(false);
  });

  it("schema rejects an out-of-range variant", () => {
    const r = newsletterDocSchema.safeParse({
      blocks: [{ type: "text", variant: 9, data: {} }],
    });
    expect(r.success).toBe(false);
  });
});
