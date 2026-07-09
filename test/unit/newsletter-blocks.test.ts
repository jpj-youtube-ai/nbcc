import { describe, it, expect } from "vitest";
import { renderNewsletter, newsletterDocSchema, renderBlock } from "../../src/newsletter/blocks";
import { HEAD, CRIMSON, MAROON } from "../../src/newsletter/theme";

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

describe("newsletter blocks — text variants", () => {
  const mk = (variant: number, text: string) =>
    renderNewsletter({ blocks: [{ type: "text", variant, data: { text } }] }, ctx);

  it("variant 0: plain body paragraph", () => {
    const html = mk(0, "Plain body copy.");
    expect(html).toContain("Plain body copy.");
  });

  it("variant 0: merges {{firstName}} via applyMerge", () => {
    const html = mk(0, "Thank you, {{firstName}}.");
    expect(html).toContain("Thank you, Jane.");
  });

  it("variant 1: lead paragraph at ~18px", () => {
    const html = mk(1, "A bigger lead line.");
    expect(html).toContain("A bigger lead line.");
    expect(html).toContain("font-size:18px");
  });

  it("variant 2: pull-quote in HEAD font, italic, CRIMSON, centered", () => {
    const html = mk(2, "What a year it has been.");
    expect(html).toContain("What a year it has been.");
    expect(html).toContain(HEAD);
    expect(html).toContain("font-style:italic");
    expect(html).toContain(CRIMSON);
    expect(html).toContain("text-align:center");
  });

  it("variant 3: highlighted callout with TAN_SOFT background + CRIMSON left border", () => {
    const html = mk(3, "Every gift matters.");
    expect(html).toContain("Every gift matters.");
    expect(html).toContain("#F3E4DD"); // TAN_SOFT
    expect(html).toContain(`border-left:4px solid ${CRIMSON}`);
  });
});

describe("newsletter blocks — heading variants", () => {
  const mk = (variant: number, data: Record<string, unknown>) =>
    renderNewsletter({ blocks: [{ type: "heading", variant, data }] }, ctx);

  it("variant 0: CRIMSON serif heading, centered", () => {
    const html = mk(0, { title: "A Year of Giving" });
    expect(html).toContain("A Year of Giving");
    expect(html).toContain(CRIMSON);
    expect(html).toContain(HEAD);
    expect(html).toContain("text-align:center");
  });

  it("variant 1: kicker eyebrow + title", () => {
    const html = mk(1, { kicker: "Community News", title: "A Year of Giving" });
    expect(html).toContain("Community News");
    expect(html).toContain("A Year of Giving");
  });

  it("variant 1: degrades gracefully when kicker is absent (no stray eyebrow markup)", () => {
    const html = mk(1, { title: "A Year of Giving" });
    expect(html).toContain("A Year of Giving");
    expect(html).not.toContain("text-transform:uppercase");
  });

  it("variant 2: maroon band behind the title", () => {
    const html = mk(2, { title: "A Year of Giving" });
    expect(html).toContain("A Year of Giving");
    expect(html).toContain(MAROON);
  });

  it("variant 3: uppercase letter-spaced eyebrow only", () => {
    const html = mk(3, { title: "A Year of Giving" });
    expect(html).toContain("A Year of Giving");
    expect(html).toContain("text-transform:uppercase");
  });
});

describe("newsletter blocks — divider variants", () => {
  const mk = (variant: number) =>
    renderNewsletter({ blocks: [{ type: "divider", variant, data: {} }] }, ctx);

  it("variant 0: hairline <hr>", () => {
    const html = mk(0);
    expect(html).toContain("<hr");
  });

  it("variant 1: short CRIMSON rule", () => {
    const html = mk(1);
    expect(html).toContain(CRIMSON);
  });

  it("variant 2: blank spacer — no <hr> and no centered mark", () => {
    const html = mk(2);
    expect(html).not.toContain("<hr");
    expect(html).not.toContain("&middot;");
    expect(html).toContain("padding:24px 40px 0");
  });

  it("variant 3: small centered mark", () => {
    const html = mk(3);
    expect(html).toContain("&middot;");
  });
});

describe("newsletter blocks — button variants", () => {
  const mk = (variant: number, data: Record<string, unknown>) =>
    renderNewsletter({ blocks: [{ type: "button", variant, data }] }, ctx);

  it("variant 0: primary button, label + href present", () => {
    const html = mk(0, { label: "Donate now", href: "https://nbcc.scot/donate" });
    expect(html).toContain("Donate now");
    expect(html).toContain("https://nbcc.scot/donate");
  });

  it("variant 1: outline button style", () => {
    const html = mk(1, { label: "Learn more", href: "https://nbcc.scot/about" });
    expect(html).toContain("Learn more");
    expect(html).toContain("border:2px solid");
  });

  it("variant 2: full-width button", () => {
    const html = mk(2, { label: "Give today", href: "https://nbcc.scot/donate" });
    expect(html).toContain("Give today");
    expect(html).toContain("display:block");
  });

  it("variant 3: link-style button", () => {
    const html = mk(3, { label: "See details", href: "https://nbcc.scot/details" });
    expect(html).toContain("See details");
    expect(html).toContain("&rarr;");
  });

  it("degrades to nothing when href is empty", () => {
    const result = renderBlock(
      { type: "button", variant: 0, data: { label: "Donate now", href: "" } },
      ctx,
    );
    expect(result).toBe("");
  });
});
