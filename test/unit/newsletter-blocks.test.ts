import { describe, it, expect } from "vitest";
import { renderNewsletter, newsletterDocSchema, renderBlock } from "../../src/newsletter/blocks";
import { HEAD, CRIMSON, MAROON, TAN_SOFT, SLATE_SOFT } from "../../src/newsletter/theme";
// TASK-251: imported from the THANK-YOU email on purpose. The sign-off block must sign in the same
// hand, so the test asserts against that module's constant rather than a copy of the string here —
// change the signature there and this fails, which is exactly what "the same signature" requires.
import { SCRIPT } from "../../src/thank-you/letter";

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

describe("newsletter blocks — image variants", () => {
  const mk = (variant: number, data: Record<string, unknown>) =>
    renderNewsletter({ blocks: [{ type: "image", variant, data }] }, ctx);

  it("variant 0: full-width image, url in src, alt escaped", () => {
    const html = mk(0, {
      url: "https://example.org/tree.jpg",
      alt: "Tree & lights",
    });
    expect(html).toContain('src="https://example.org/tree.jpg"');
    expect(html).toContain('alt="Tree &amp; lights"');
  });

  it("variant 1: rounded corners", () => {
    const html = mk(1, { url: "https://example.org/tree.jpg" });
    expect(html).toContain('src="https://example.org/tree.jpg"');
    expect(html).toContain("border-radius");
  });

  it("variant 2: caption rendered under the image", () => {
    const html = mk(2, {
      url: "https://example.org/tree.jpg",
      caption: "Lighting the tree, December 2025",
    });
    expect(html).toContain('src="https://example.org/tree.jpg"');
    expect(html).toContain("Lighting the tree, December 2025");
  });

  it("variant 3: framed with a border", () => {
    const html = mk(3, { url: "https://example.org/tree.jpg" });
    expect(html).toContain('src="https://example.org/tree.jpg"');
    expect(html).toContain("border:1px solid");
  });

  it("degrades to nothing when url is empty", () => {
    const result = renderBlock(
      { type: "image", variant: 0, data: { url: "", alt: "Tree" } },
      ctx,
    );
    expect(result).toBe("");
    expect(result).not.toContain("<img");
  });
});

describe("newsletter blocks — story variants", () => {
  const mk = (variant: number, data: Record<string, unknown>) =>
    renderNewsletter({ blocks: [{ type: "story", variant, data }] }, ctx);

  it("variant 0: image-top — image renders above the title and body", () => {
    const html = mk(0, {
      imageUrl: "https://example.org/story.jpg",
      title: "A Winter to Remember",
      body: "Our shelter welcomed forty families this year.",
    });
    expect(html).toContain('src="https://example.org/story.jpg"');
    expect(html).toContain("A Winter to Remember");
    expect(html).toContain("Our shelter welcomed forty families this year.");
    // image markup precedes the title in document order (image-top)
    expect(html.indexOf("story.jpg")).toBeLessThan(html.indexOf("A Winter to Remember"));
  });

  it("variant 0: degrades to no image markup when imageUrl is absent, title/body still render", () => {
    const html = mk(0, { title: "A Winter to Remember", body: "Forty families helped." });
    expect(html).toContain("A Winter to Remember");
    expect(html).toContain("Forty families helped.");
    expect(html).not.toContain("<img");
  });

  it("variant 1: image-left / text-right two-column table layout", () => {
    const result = renderBlock(
      {
        type: "story",
        variant: 1,
        data: {
          imageUrl: "https://example.org/story.jpg",
          title: "A Winter to Remember",
          body: "Forty families helped.",
        },
      },
      ctx,
    );
    expect(result).toContain("A Winter to Remember");
    expect(result).toContain('src="https://example.org/story.jpg"');
    expect(result).toContain("<table");
    // two-column layout: an image <td> and a text <td> side by side in one row
    expect((result.match(/<td/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("variant 2: two-up row renders both items' titles and bodies side by side", () => {
    const html = mk(2, {
      items: [
        { title: "Sarah's Story", body: "Sarah found warmth this winter." },
        { title: "Tom's Story", body: "Tom's family had a place to stay." },
      ],
    });
    expect(html).toContain("Sarah's Story");
    expect(html).toContain("Sarah found warmth this winter.");
    expect(html).toContain("Tom's Story");
    expect(html).toContain("Tom's family had a place to stay.");
  });

  it("variant 2: empty items falls back to a single item from the top-level fields (never blank)", () => {
    const html = mk(2, {
      items: [],
      title: "A Winter to Remember",
      body: "Forty families helped.",
    });
    expect(html).toContain("A Winter to Remember");
    expect(html).toContain("Forty families helped.");
  });

  it("variant 3: text-only with a top rule — no image markup even when imageUrl is provided", () => {
    const html = mk(3, {
      imageUrl: "https://example.org/story.jpg",
      title: "A Winter to Remember",
      body: "Forty families helped.",
    });
    expect(html).toContain("A Winter to Remember");
    expect(html).toContain("Forty families helped.");
    expect(html).toContain("<hr");
    expect(html).not.toContain("<img");
  });

  it("with href present: renders the read-more link using the given label", () => {
    const html = mk(0, {
      title: "A Winter to Remember",
      body: "Forty families helped.",
      label: "Read Sarah's story",
      href: "https://nbcc.scot/stories/sarah",
    });
    expect(html).toContain("Read Sarah's story");
    expect(html).toContain('href="https://nbcc.scot/stories/sarah"');
  });

  it("read-more label falls back to 'Read more' when label is absent", () => {
    const html = mk(0, {
      title: "A Winter to Remember",
      body: "Forty families helped.",
      href: "https://nbcc.scot/stories/sarah",
    });
    expect(html).toContain("Read more");
    expect(html).toContain('href="https://nbcc.scot/stories/sarah"');
  });

  it("degrades to no read-more link when href is absent, title/body still render", () => {
    const html = mk(0, { title: "A Winter to Remember", body: "Forty families helped." });
    expect(html).toContain("A Winter to Remember");
    expect(html).toContain("Forty families helped.");
    expect(html).not.toContain("&rarr;");
  });
});

describe("newsletter blocks — spotlight variants", () => {
  const mk = (variant: number, data: Record<string, unknown>) =>
    renderNewsletter({ blocks: [{ type: "spotlight", variant, data }] }, ctx);

  it("variant 0: photo-left + quote — two-column table with photo, name, quote, role", () => {
    const html = mk(0, {
      photoUrl: "https://example.org/margaret.jpg",
      name: "Margaret Kerr",
      quote: "The shelter gave my family somewhere warm to be.",
      role: "Volunteer",
    });
    expect(html).toContain("Margaret Kerr");
    expect(html).toContain("The shelter gave my family somewhere warm to be.");
    expect(html).toContain('src="https://example.org/margaret.jpg"');
    expect(html).toContain('alt="Margaret Kerr"');
    expect(html).toContain("<table");
    expect(html).toContain("Volunteer");
  });

  it("variant 0: degrades to no photo markup when photoUrl is absent, name/quote still render", () => {
    const html = mk(0, { name: "Margaret Kerr", quote: "Thank you for everything." });
    expect(html).toContain("Margaret Kerr");
    expect(html).toContain("Thank you for everything.");
    expect(html).not.toContain("<img");
  });

  it("variant 0: no role line when role is absent", () => {
    const html = mk(0, { name: "Margaret Kerr", quote: "Thank you for everything." });
    expect(html).toContain("Margaret Kerr");
    expect(html).not.toContain(SLATE_SOFT);
  });

  it("variant 1: centered round avatar (border-radius:50%) + quote below", () => {
    const html = mk(1, {
      photoUrl: "https://example.org/margaret.jpg",
      name: "Margaret Kerr",
      quote: "The shelter gave my family somewhere warm to be.",
    });
    expect(html).toContain("Margaret Kerr");
    expect(html).toContain("The shelter gave my family somewhere warm to be.");
    expect(html).toContain('src="https://example.org/margaret.jpg"');
    expect(html).toContain("border-radius:50%");
  });

  it("variant 1: degrades to no photo markup when photoUrl is absent", () => {
    const html = mk(1, { name: "Margaret Kerr", quote: "Thank you for everything." });
    expect(html).toContain("Margaret Kerr");
    expect(html).toContain("Thank you for everything.");
    expect(html).not.toContain("<img");
  });

  it("variant 2: big-quote in the HEAD font with name/role attribution, no photo", () => {
    const html = mk(2, {
      photoUrl: "https://example.org/margaret.jpg",
      name: "Margaret Kerr",
      quote: "The shelter gave my family somewhere warm to be.",
      role: "Volunteer",
    });
    expect(html).toContain("Margaret Kerr");
    expect(html).toContain("The shelter gave my family somewhere warm to be.");
    expect(html).toContain("Volunteer");
    expect(html).toContain(HEAD);
    // big-quote variant never shows a photo, even when photoUrl is provided
    expect(html).not.toContain("<img");
  });

  it("variant 3: tinted card (TAN_SOFT background) with name and quote", () => {
    const html = mk(3, {
      photoUrl: "https://example.org/margaret.jpg",
      name: "Margaret Kerr",
      quote: "The shelter gave my family somewhere warm to be.",
    });
    expect(html).toContain("Margaret Kerr");
    expect(html).toContain("The shelter gave my family somewhere warm to be.");
    expect(html).toContain(TAN_SOFT);
    expect(html).toContain("#F3E4DD");
  });

  it("variant 3: degrades to no photo markup when photoUrl is absent", () => {
    const html = mk(3, { name: "Margaret Kerr", quote: "Thank you for everything." });
    expect(html).toContain("Margaret Kerr");
    expect(html).toContain("Thank you for everything.");
    expect(html).not.toContain("<img");
  });
});

describe("newsletter blocks — stats variants", () => {
  const mk = (variant: number, data: Record<string, unknown>) =>
    renderNewsletter({ blocks: [{ type: "stats", variant, data }] }, ctx);

  it("variant 0: one big number + label, using the FIRST item only", () => {
    const html = mk(0, {
      items: [
        { number: "500+", label: "Meals served" },
        { number: "1,234", label: "Families housed" },
      ],
    });
    expect(html).toContain("500+");
    expect(html).toContain("Meals served");
    expect(html).toContain(HEAD);
    expect(html).toContain(CRIMSON);
    // only the first item's figures — the second item's are not rendered by variant 0
    expect(html).not.toContain("1,234");
    expect(html).not.toContain("Families housed");
  });

  it("variant 1: three-across row — a table rendering ALL items' numbers and labels", () => {
    const html = mk(1, {
      items: [
        { number: "500+", label: "Meals served" },
        { number: "40", label: "Families housed" },
      ],
    });
    expect(html).toContain("<table");
    expect(html).toContain("500+");
    expect(html).toContain("Meals served");
    expect(html).toContain("40");
    expect(html).toContain("Families housed");
  });

  it("variant 2: number + label + caption (first item), caption shown when present", () => {
    const html = mk(2, {
      items: [
        {
          number: "500+",
          label: "Meals served",
          caption: "Across twelve winter weeks",
        },
      ],
    });
    expect(html).toContain("500+");
    expect(html).toContain("Meals served");
    expect(html).toContain("Across twelve winter weeks");
  });

  it("variant 2: degrades to no caption markup when caption is absent", () => {
    const html = mk(2, { items: [{ number: "500+", label: "Meals served" }] });
    expect(html).toContain("500+");
    expect(html).toContain("Meals served");
    expect(html).not.toContain(SLATE_SOFT);
  });

  it("variant 3: inline highlighted — all items' numbers rendered inline, tinted", () => {
    const html = mk(3, {
      items: [
        { number: "500+", label: "Meals served" },
        { number: "40", label: "Families housed" },
      ],
    });
    expect(html).toContain("500+");
    expect(html).toContain("Meals served");
    expect(html).toContain("40");
    expect(html).toContain("Families housed");
    expect(html).toContain(TAN_SOFT);
  });

  it("escapes number/label/caption strings", () => {
    const html = mk(2, {
      items: [{ number: "<b>500</b>", label: "Meals & drinks", caption: "12 <weeks>" }],
    });
    expect(html).toContain("&lt;b&gt;500&lt;/b&gt;");
    expect(html).toContain("Meals &amp; drinks");
    expect(html).toContain("12 &lt;weeks&gt;");
    expect(html).not.toContain("<b>500</b>");
  });

  it("degrades to exactly '' when items is empty", () => {
    const result0 = renderBlock({ type: "stats", variant: 0, data: { items: [] } }, ctx);
    const result1 = renderBlock({ type: "stats", variant: 1, data: { items: [] } }, ctx);
    expect(result0).toBe("");
    expect(result1).toBe("");
  });

  it("degrades to exactly '' when items is absent entirely", () => {
    const result = renderBlock({ type: "stats", variant: 0, data: {} }, ctx);
    expect(result).toBe("");
  });
});

describe("newsletter blocks — waysToHelp variants", () => {
  const mk = (variant: number, data: Record<string, unknown>) =>
    renderNewsletter({ blocks: [{ type: "waysToHelp", variant, data }] }, ctx);

  const threeItems = [
    {
      icon: "🎁",
      title: "Donate",
      body: "Help fund a Christmas parcel.",
      label: "Give now",
      href: "https://nbcc.scot/donate",
    },
    {
      icon: "🙋",
      title: "Volunteer",
      body: "Join the pack-and-deliver team.",
      label: "Sign up",
      href: "https://nbcc.scot/volunteer",
    },
    {
      icon: "📣",
      title: "Spread the word",
      body: "Tell a friend or share on social.",
    },
  ];

  it("variant 0: three icon columns — a table with all item titles, an icon, and a button when label+href present", () => {
    const html = mk(0, { items: threeItems });
    expect(html).toContain("<table");
    expect(html).toContain("Donate");
    expect(html).toContain("Volunteer");
    expect(html).toContain("Spread the word");
    expect(html).toContain("🎁");
    expect(html).toContain("Help fund a Christmas parcel.");
    expect(html).toContain('href="https://nbcc.scot/donate"');
    expect(html).toContain('href="https://nbcc.scot/volunteer"');
  });

  it("variant 1: stacked list — all item titles present, no table markup", () => {
    const html = renderBlock({ type: "waysToHelp", variant: 1, data: { items: threeItems } }, ctx);
    expect(html).toContain("Donate");
    expect(html).toContain("Volunteer");
    expect(html).toContain("Spread the word");
    expect(html).not.toContain("<table");
  });

  it("variant 2: two-up columns — all item titles present in a table", () => {
    const html = mk(2, { items: threeItems });
    expect(html).toContain("<table");
    expect(html).toContain("Donate");
    expect(html).toContain("Volunteer");
    expect(html).toContain("Spread the word");
  });

  it("variant 2: true two-up grid — 3 items wrap into TWO <tr> rows, not one 150%-wide row", () => {
    const html = renderBlock({ type: "waysToHelp", variant: 2, data: { items: threeItems } }, ctx);
    // 3 items at 50% each in a single <tr> totals 150% width, which breaks in Outlook's Word
    // rendering engine. Chunked into rows of 2, 3 items must produce exactly two <tr> rows:
    // one full pair + one trailing single-cell row.
    expect((html.match(/<tr/g) ?? []).length).toBe(2);
    expect(html).toContain("Donate");
    expect(html).toContain("Volunteer");
    expect(html).toContain("Spread the word");
  });

  it("variant 3: single primary CTA — first item only, exactly one button, crimson primary", () => {
    // Render the block alone (not the full frame) so the anchor count reflects the block's single
    // CTA, not the frame footer's contact links.
    const html = renderBlock({ type: "waysToHelp", variant: 3, data: { items: threeItems } }, ctx);
    expect(html).toContain("Give now");
    expect(html).toContain('href="https://nbcc.scot/donate"');
    expect(html).not.toContain("https://nbcc.scot/volunteer");
    expect(html).not.toContain("Sign up");
    expect((html.match(/<a /g) ?? []).length).toBe(1);
    expect(html).toContain(CRIMSON);
  });

  it("variant 3: degrades to '' when the first item has no href", () => {
    const result = renderBlock(
      { type: "waysToHelp", variant: 3, data: { items: [{ title: "Donate", label: "Give now" }] } },
      ctx,
    );
    expect(result).toBe("");
  });

  it("degrades to no button markup when an item has no href (variants 0-2)", () => {
    // Block-only render: the frame footer's contact anchors would otherwise mask a leaked button <a>.
    const html = renderBlock(
      { type: "waysToHelp", variant: 0, data: { items: [{ title: "Spread the word", body: "Tell a friend." }] } },
      ctx,
    );
    expect(html).toContain("Spread the word");
    expect(html).not.toContain("<a ");
  });

  it("escapes icon/title/body/label strings", () => {
    const html = mk(0, {
      items: [
        {
          icon: "<b>*</b>",
          title: "<script>evil()</script>",
          body: "Tea & biscuits",
          label: "Go <now>",
          href: "https://nbcc.scot/donate",
        },
      ],
    });
    expect(html).toContain("&lt;script&gt;evil()&lt;/script&gt;");
    expect(html).toContain("Tea &amp; biscuits");
    expect(html).toContain("&lt;b&gt;*&lt;/b&gt;");
    expect(html).not.toContain("<script>evil()</script>");
  });

  it("degrades to exactly '' when items is empty", () => {
    const result0 = renderBlock({ type: "waysToHelp", variant: 0, data: { items: [] } }, ctx);
    const result1 = renderBlock({ type: "waysToHelp", variant: 1, data: { items: [] } }, ctx);
    expect(result0).toBe("");
    expect(result1).toBe("");
  });

  it("degrades to exactly '' when items is absent entirely", () => {
    const result = renderBlock({ type: "waysToHelp", variant: 0, data: {} }, ctx);
    expect(result).toBe("");
  });
});

describe("newsletter blocks — events variants", () => {
  const mk = (variant: number, data: Record<string, unknown>) =>
    renderNewsletter({ blocks: [{ type: "events", variant, data }] }, ctx);

  const twoItems = [
    {
      day: "12",
      month: "Dec",
      name: "Carols on the Green",
      location: "Church Street",
      label: "Register",
      href: "https://nbcc.scot/events/carols",
    },
    {
      day: "20",
      month: "Dec",
      name: "Santa's Grotto",
      location: "Town Hall",
    },
  ];

  it("variant 0: date-badge rows — both item names present", () => {
    const html = mk(0, { items: twoItems });
    expect(html).toContain("Carols on the Green");
    expect(html).toContain("Santa's Grotto");
  });

  it("variant 0: renders the day inside a maroon badge (MAROON near the day)", () => {
    const html = renderBlock({ type: "events", variant: 0, data: { items: twoItems } }, ctx);
    const badgeMatch = html.match(new RegExp(`<td[^>]*${MAROON}[^>]*>[\\s\\S]*?</td>`));
    expect(badgeMatch).not.toBeNull();
    expect(badgeMatch![0]).toContain("12");
    expect(badgeMatch![0]).toContain("Dec");
  });

  it("an item with href gets the Register label and link, the other does not", () => {
    const html = mk(0, { items: twoItems });
    expect(html).toContain("Register");
    expect(html).toContain('href="https://nbcc.scot/events/carols"');
  });

  it("degrades to no Register button when an item has no href", () => {
    const html = renderBlock(
      { type: "events", variant: 0, data: { items: [{ day: "20", month: "Dec", name: "Santa's Grotto" }] } },
      ctx,
    );
    expect(html).not.toContain("<a ");
  });

  it("variant 1: simple list — names + dates inline, no table markup", () => {
    const html = renderBlock({ type: "events", variant: 1, data: { items: twoItems } }, ctx);
    expect(html).toContain("Carols on the Green");
    expect(html).toContain("Santa's Grotto");
    expect(html).toContain("12");
    expect(html).toContain("Dec");
    expect(html).not.toContain("<table");
  });

  it("variant 2: cards — each event in its own bordered card", () => {
    const html = mk(2, { items: twoItems });
    expect(html).toContain("Carols on the Green");
    expect(html).toContain("Santa's Grotto");
    expect(html).toContain("border:1px solid");
  });

  it("variant 3: single featured event — first item only, larger heading", () => {
    const html = mk(3, { items: twoItems });
    expect(html).toContain("Carols on the Green");
    expect(html).not.toContain("Santa's Grotto");
    expect(html).toContain("<h2");
  });

  it("escapes name/location/label strings", () => {
    const html = mk(0, {
      items: [
        {
          day: "12",
          month: "Dec",
          name: "<script>evil()</script>",
          location: "Tea & biscuits",
          label: "Go <now>",
          href: "https://nbcc.scot/events/x",
        },
      ],
    });
    expect(html).toContain("&lt;script&gt;evil()&lt;/script&gt;");
    expect(html).toContain("Tea &amp; biscuits");
    expect(html).toContain("Go &lt;now&gt;");
    expect(html).not.toContain("<script>evil()</script>");
  });

  it("degrades to exactly '' when items is empty", () => {
    const result = renderBlock({ type: "events", variant: 0, data: { items: [] } }, ctx);
    expect(result).toBe("");
  });

  it("degrades to exactly '' when items is absent entirely", () => {
    const result = renderBlock({ type: "events", variant: 0, data: {} }, ctx);
    expect(result).toBe("");
  });
});

describe("newsletter blocks — donationCta variants", () => {
  const mk = (variant: number, data: Record<string, unknown>) =>
    renderNewsletter({ blocks: [{ type: "donationCta", variant, data }] }, ctx);

  it("variant 0: image row + heading + button, image src present when imageUrl given", () => {
    const html = mk(0, {
      imageUrl: "https://example.org/donate.jpg",
      heading: "Make a donation today",
      label: "Donate now",
      href: "https://nbcc.scot/donate",
    });
    expect(html).toContain("Make a donation today");
    expect(html).toContain('href="https://nbcc.scot/donate"');
    expect(html).toContain('src="https://example.org/donate.jpg"');
  });

  it("variant 0: degrades to no image markup when imageUrl is absent, heading/button still render", () => {
    const html = mk(0, {
      heading: "Make a donation today",
      label: "Donate now",
      href: "https://nbcc.scot/donate",
    });
    expect(html).toContain("Make a donation today");
    expect(html).toContain('href="https://nbcc.scot/donate"');
    expect(html).not.toContain("<img");
  });

  it("variant 1: tinted TAN_SOFT band + heading + button", () => {
    const html = mk(1, {
      heading: "Make a donation today",
      label: "Donate now",
      href: "https://nbcc.scot/donate",
    });
    expect(html).toContain("Make a donation today");
    expect(html).toContain('href="https://nbcc.scot/donate"');
    expect(html).toContain("#F3E4DD"); // TAN_SOFT
  });

  it("variant 2: split layout — heading and button in a two-cell table", () => {
    const html = mk(2, {
      heading: "Make a donation today",
      label: "Donate now",
      href: "https://nbcc.scot/donate",
    });
    expect(html).toContain("Make a donation today");
    expect(html).toContain('href="https://nbcc.scot/donate"');
    expect(html).toContain("<table");
  });

  it("variant 3: centered heading + button", () => {
    const html = mk(3, {
      heading: "Make a donation today",
      label: "Donate now",
      href: "https://nbcc.scot/donate",
    });
    expect(html).toContain("Make a donation today");
    expect(html).toContain('href="https://nbcc.scot/donate"');
    expect(html).toContain("text-align:center");
  });

  it("escapes the heading string", () => {
    const html = mk(0, {
      heading: "<script>evil()</script>",
      label: "Donate now",
      href: "https://nbcc.scot/donate",
    });
    expect(html).toContain("&lt;script&gt;evil()&lt;/script&gt;");
    expect(html).not.toContain("<script>evil()</script>");
  });
});

describe("newsletter blocks — all block types integration", () => {
  it("renders one block of every palette type + rawHtml with clean output (no leaked 'undefined' or '[object Object]')", () => {
    const html = renderNewsletter(
      {
        blocks: [
          { type: "masthead", variant: 0, data: { issueTitle: "July Newsletter" } },
          { type: "greeting", variant: 0, data: {} },
          { type: "text", variant: 0, data: { text: "Some body copy." } },
          { type: "heading", variant: 0, data: { title: "Section Heading" } },
          {
            type: "image",
            variant: 0,
            data: { url: "https://example.org/img.jpg", alt: "Alt text" },
          },
          {
            type: "story",
            variant: 0,
            data: {
              imageUrl: "https://example.org/story.jpg",
              title: "A Story",
              body: "Story body.",
            },
          },
          {
            type: "spotlight",
            variant: 0,
            data: {
              photoUrl: "https://example.org/person.jpg",
              name: "Jane Doe",
              quote: "Great quote.",
              role: "Volunteer",
            },
          },
          {
            type: "stats",
            variant: 0,
            data: { items: [{ number: "500+", label: "Meals served" }] },
          },
          {
            type: "waysToHelp",
            variant: 0,
            data: {
              items: [
                {
                  icon: "🎁",
                  title: "Donate",
                  body: "Help out.",
                  label: "Give now",
                  href: "https://nbcc.scot/donate",
                },
              ],
            },
          },
          {
            type: "events",
            variant: 0,
            data: {
              items: [
                {
                  day: "12",
                  month: "Dec",
                  name: "Carols",
                  location: "Church Street",
                  label: "Register",
                  href: "https://nbcc.scot/events",
                },
              ],
            },
          },
          {
            type: "donationCta",
            variant: 0,
            data: {
              imageUrl: "https://example.org/donate.jpg",
              heading: "Make a donation today",
              label: "Donate now",
              href: "https://nbcc.scot/donate",
            },
          },
          {
            type: "button",
            variant: 0,
            data: { label: "Learn more", href: "https://nbcc.scot/about" },
          },
          { type: "divider", variant: 0, data: {} },
          { type: "rawHtml", variant: 0, data: { html: "<p>Legacy content</p>" } },
        ],
      },
      ctx,
    );
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("SC047995");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("[object Object]");
  });
});

// TASK-248: per-block text size. A block carries an optional `size` step (-2..+2) that shifts EVERY
// font-size in that block's rendered HTML by N notches along the newsletter's own size ladder
// (10/12/13/14/15/16/18/20/22/24/26/28 — the sizes the variants already use). A step, not a pixel
// value, so it stays on the designed scale, keeps a block's internal hierarchy (a story's heading
// stays above its body), and still means something when saved as a template and reused on new copy.
// Applied at the single renderBlock dispatch, so preview / saved html / merge send cannot disagree.
describe("per-block text size step (TASK-248)", () => {
  const textBlock = (size?: number) => ({
    type: "text" as const,
    variant: 0,
    data: { body: "BODYCOPY" },
    ...(size === undefined ? {} : { size }),
  });

  it("renders identically to today when no size is set (the regression lock)", () => {
    // Every newsletter written before this feature has no `size`. It must render byte-identical.
    expect(renderBlock(textBlock(), ctx)).toBe(renderBlock(textBlock(0), ctx));
    expect(renderBlock(textBlock(), ctx)).toContain("font-size:15px"); // the variant's own size
  });

  it("steps a block's text UP the ladder (15 → 16 at +1, → 18 at +2)", () => {
    expect(renderBlock(textBlock(1), ctx)).toContain("font-size:16px");
    expect(renderBlock(textBlock(2), ctx)).toContain("font-size:18px");
  });

  it("steps a block's text DOWN the ladder (15 → 14 at -1, → 13 at -2)", () => {
    expect(renderBlock(textBlock(-1), ctx)).toContain("font-size:14px");
    expect(renderBlock(textBlock(-2), ctx)).toContain("font-size:13px");
  });

  it("preserves a multi-element block's internal hierarchy — every element shifts together", () => {
    // A story block has a heading ABOVE its body. Stepping the block must move both, keeping the gap:
    // the point is to resize the section, never to flatten its hierarchy.
    const story = (size: number) => ({
      type: "story" as const,
      variant: 0,
      data: { heading: "H", body: "B", lead: "L" },
      size,
    });
    const base = renderBlock(story(0), ctx);
    const up = renderBlock(story(1), ctx);
    const sizesOf = (html: string) => (html.match(/font-size:(\d+)px/g) ?? []).map((s) => Number(s.match(/\d+/)![0]));
    const b = sizesOf(base);
    const u = sizesOf(up);
    expect(b.length).toBeGreaterThan(1); // genuinely multi-element, else this proves nothing
    expect(u).not.toEqual(b); // it moved
    // Same count, and every element ended up strictly larger — hierarchy intact, nothing flattened.
    expect(u.length).toBe(b.length);
    for (let i = 0; i < b.length; i++) expect(u[i]).toBeGreaterThanOrEqual(b[i]);
    expect(new Set(u).size).toBe(new Set(b).size); // distinct levels stay distinct
  });

  it("clamps at both ends of the ladder rather than inventing sizes off it", () => {
    // A kicker at the bottom of the ladder cannot go below 10; a hero at the top cannot exceed 28.
    const tiny = renderBlock({ type: "text", variant: 0, data: { body: "B" }, size: -2 }, ctx);
    expect(tiny).not.toMatch(/font-size:(?:[0-9]|1[01])px/); // never below the ladder's floor
    const huge = renderBlock({ type: "heading", variant: 0, data: { title: "T" }, size: 2 }, ctx);
    expect(huge).not.toMatch(/font-size:(?:29|3[0-9]|[4-9][0-9])px/); // never above 28
  });

  it("never touches rawHtml (we do not rewrite HTML the user authored)", () => {
    const raw = { type: "rawHtml" as const, variant: 0, data: { html: '<p style="font-size:15px">X</p>' }, size: 2 };
    expect(renderBlock(raw, ctx)).toContain("font-size:15px"); // verbatim, step ignored
  });

  it("never touches the masthead (it is the brand signature — variants set its size)", () => {
    const m = (size: number) => renderBlock({ type: "masthead", variant: 0, data: { issueTitle: "T" }, size }, ctx);
    expect(m(2)).toBe(m(0));
  });

  it("schema defaults size to 0 and rejects a step off the allowed range", () => {
    const parsed = newsletterDocSchema.parse({ blocks: [{ type: "text", variant: 0, data: {} }] });
    expect(parsed.blocks[0].size).toBe(0);
    expect(newsletterDocSchema.safeParse({ blocks: [{ type: "text", variant: 0, data: {}, size: 3 }] }).success).toBe(false);
    expect(newsletterDocSchema.safeParse({ blocks: [{ type: "text", variant: 0, data: {}, size: -3 }] }).success).toBe(false);
  });
});

// TASK-251: the sign-off block — the letter-style close a newsletter ends on:
//
//   With love and gratitude,
//   Jodie McFarlane            <- in the SAME script hand the thank-you email signs with
//   On behalf of everyone at NBCC
//   info@nbcc.scot
//
// The signature font is the one thing that must not drift: it is IMPORTED from the thank-you email
// (src/thank-you/letter.ts SCRIPT), never copied, so the two can never sign differently. It is a
// stack of SYSTEM script faces with a cursive fallback — no webfont — which is exactly why it
// survives a mail client at all.
describe("sign-off block (TASK-251)", () => {
  const signoff = (data: Record<string, unknown>, variant = 0) =>
    renderBlock({ type: "signoff", variant, data }, ctx);
  const full = {
    closing: "With love and gratitude,",
    name: "Jodie McFarlane",
    role: "On behalf of everyone at NBCC",
    email: "info@nbcc.scot",
  };

  it("renders the closing, the name, the role line and the email", () => {
    const html = signoff(full);
    expect(html).toContain("With love and gratitude,");
    expect(html).toContain("Jodie McFarlane");
    expect(html).toContain("On behalf of everyone at NBCC");
    expect(html).toContain("info@nbcc.scot");
  });

  it("signs the NAME in the very same hand as the thank-you email — imported, never copied", () => {
    const html = signoff(full);
    // The exact stack the thank-you email uses. If someone changes it there, this fails here, which
    // is the point: "the same signature" has to stay true.
    expect(html).toContain(SCRIPT);
    // …and it is the NAME that is signed, not the whole block: the name sits inside the signed
    // element. (The stack itself is ~140 chars, so the window has to clear it and the rest of the
    // style attribute before the text begins.)
    const signed = html.slice(html.indexOf(SCRIPT), html.indexOf(SCRIPT) + 320);
    expect(signed).toContain("Jodie McFarlane");
    expect(signed).not.toContain("With love and gratitude"); // the closing line is NOT in script
  });

  it("makes the email a real mailto link, so a reader can just tap it", () => {
    expect(signoff(full)).toContain('href="mailto:info@nbcc.scot"');
  });

  it("drops any line left blank rather than printing an empty gap", () => {
    // A sign-off with no role/email should not leave dangling whitespace in the email.
    const html = signoff({ closing: "Thanks,", name: "Jon McFarlane", role: "", email: "" });
    expect(html).toContain("Jon McFarlane");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("On behalf of");
  });

  it("escapes the copy — a name is user input like any other", () => {
    const html = signoff({ ...full, name: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("takes a size step like any other text block (it is not in NO_SIZE_STEP)", () => {
    const base = signoff(full);
    const up = renderBlock({ type: "signoff", variant: 0, data: full, size: 1 }, ctx);
    expect(up).not.toBe(base);
  });

  it("is a known block type the schema accepts", () => {
    const r = newsletterDocSchema.safeParse({ blocks: [{ type: "signoff", variant: 0, data: full }] });
    expect(r.success).toBe(true);
  });
});
