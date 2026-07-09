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

describe("newsletter blocks — masthead variants", () => {
  it("variant 1: logo-left / title(+date)-right two-cell table, date rendered", () => {
    const html = renderNewsletter(
      {
        blocks: [
          {
            type: "masthead",
            variant: 1,
            data: { issueTitle: "July Newsletter", date: "9 July 2026" },
          },
        ],
      },
      ctx,
    );
    // marker unique to variant 1: the right-aligned title cell in the two-cell <table> layout
    expect(html).toContain('<td style="vertical-align:middle">');
    expect(html).toContain('<td style="vertical-align:middle;text-align:right">');
    expect(html).toContain("July Newsletter");
    expect(html).toContain("9 July 2026"); // date value present
  });

  it("variant 2 with heroUrl: hero <img> src present, title accompanies it", () => {
    const html = renderNewsletter(
      {
        blocks: [
          {
            type: "masthead",
            variant: 2,
            data: { issueTitle: "July Newsletter", heroUrl: "https://example.org/hero.jpg" },
          },
        ],
      },
      ctx,
    );
    expect(html).toContain('<img src="https://example.org/hero.jpg"');
    expect(html).toContain("July Newsletter");
  });

  it("variant 2 without heroUrl: degrades to logo+title fallback, no broken <img>", () => {
    const html = renderNewsletter(
      { blocks: [{ type: "masthead", variant: 2, data: { issueTitle: "July Newsletter" } }] },
      ctx,
    );
    expect(html).toContain("July Newsletter");
    expect(html).toContain("nbcc-logo.png"); // logo still present
    expect(html).not.toContain('src=""'); // no broken empty-src <img>
    // Without hero, variant 2 converges with variant 0 (both fallback to centered logo+title)
    const v0 = renderNewsletter(
      { blocks: [{ type: "masthead", variant: 0, data: { issueTitle: "July Newsletter" } }] },
      ctx,
    );
    expect(html).toBe(v0);
  });

  it("variant 3: slim/compact wordmark strip, title as inline <span>", () => {
    const html = renderNewsletter(
      { blocks: [{ type: "masthead", variant: 3, data: { issueTitle: "July Newsletter" } }] },
      ctx,
    );
    // marker unique to variant 3: compact single-row table (14px vertical padding vs 28px
    // elsewhere) with the title as an inline <span> rather than an <h1>
    expect(html).toContain('style="padding:14px 40px"');
    expect(html).toMatch(/<span[^>]*>July Newsletter<\/span>/);
  });
});

describe("newsletter blocks — greeting variants", () => {
  it("variant 0: plain 'Dear {{firstName}},' merges the donor's first name", () => {
    const html = renderNewsletter(
      { blocks: [{ type: "greeting", variant: 0, data: {} }] },
      { firstName: "Jane" },
    );
    expect(html).toContain("Dear Jane,");
  });

  it("variant 0: merges a fallback 'friend' name the same way", () => {
    const html = renderNewsletter(
      { blocks: [{ type: "greeting", variant: 0, data: {} }] },
      { firstName: "friend" },
    );
    expect(html).toContain("Dear friend,");
  });

  it("variant 1: greeting line plus a lead intro paragraph below it", () => {
    const html = renderNewsletter(
      {
        blocks: [
          { type: "greeting", variant: 1, data: { lead: "What a year it has been." } },
        ],
      },
      { firstName: "Jane" },
    );
    expect(html).toContain("Dear Jane,");
    expect(html).toContain("What a year it has been.");
  });

  it("variant 2: heading appears above the greeting line", () => {
    const html = renderNewsletter(
      {
        blocks: [
          { type: "greeting", variant: 2, data: { heading: "A Year of Giving" } },
        ],
      },
      { firstName: "Jane" },
    );
    expect(html).toContain("A Year of Giving");
    expect(html).toContain("Dear Jane,");
    expect(html.indexOf("A Year of Giving")).toBeLessThan(html.indexOf("Dear Jane,"));
  });

  it("variant 3: warm/casual 'Hi {{firstName}} 👋'", () => {
    const html = renderNewsletter(
      { blocks: [{ type: "greeting", variant: 3, data: {} }] },
      { firstName: "Jane" },
    );
    expect(html).toContain("Hi Jane 👋");
  });
});
