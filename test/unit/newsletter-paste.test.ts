// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// TASK-469: what a paste into a newsletter prose box keeps. assets/js/admin/paste-prose.js turns the
// clipboard into the builder's own plain-text markup: a blank line between paragraphs, a newline for a
// line break, **bold** and *italic*. Every word in these samples is made up: the repository is public,
// so nothing here is copied from a real newsletter, post or conversation.
const require = createRequire(import.meta.url);
const { htmlToProse, markdownToProse } = require(resolve(__dirname, "../../assets/js/admin/paste-prose.js"));

// The clipboard's HTML, parsed the way app.js parses it before converting.
const fromHtml = (html: string): string => htmlToProse(new DOMParser().parseFromString(html, "text/html").body);

describe("markdownToProse: Claude's Copy button writes Markdown as plain text", () => {
  it("keeps paragraphs, line breaks, **bold** and *italic* exactly as they are", () => {
    const md = "Dear friends,\n\nThis winter we **packed 300 bags**.\nThat is *so* many.";
    expect(markdownToProse(md)).toBe(md);
  });

  it("turns a heading into its own bold paragraph", () => {
    expect(markdownToProse("Intro line.\n## What we did\nWe packed.")).toBe(
      "Intro line.\n\n**What we did**\n\nWe packed.",
    );
    expect(markdownToProse("# **Already bold**")).toBe("**Already bold**");
  });

  it("puts each bullet on its own line with a •, and leaves numbered items as they are", () => {
    expect(markdownToProse("- Wrap\n* Pack\n+ Deliver\n  - Smile")).toBe("• Wrap\n• Pack\n• Deliver\n• Smile");
    expect(markdownToProse("1. First\n2. Second")).toBe("1. First\n2. Second");
  });

  it("keeps a link's words and drops the address behind them; a written-out address stays", () => {
    expect(markdownToProse("Read [our story](https://example.org/story) today")).toBe("Read our story today");
    expect(markdownToProse("See <https://example.org/a>")).toBe("See https://example.org/a");
    expect(markdownToProse("Visit https://example.org/b now")).toBe("Visit https://example.org/b now");
  });

  it("drops pictures, code marks, quote marks, dividers and code fences, keeping the words", () => {
    expect(markdownToProse("A ![a photo](https://example.org/p.jpg) B")).toBe("A B");
    expect(markdownToProse("Use `code` here")).toBe("Use code here");
    expect(markdownToProse("> A quoted line")).toBe("A quoted line");
    expect(markdownToProse("Above\n\n---\n\nBelow")).toBe("Above\n\nBelow");
    expect(markdownToProse("```\nplain words\n```")).toBe("plain words");
  });

  it("turns __bold__ and _italic_ into the builder's markers, but never inside a word", () => {
    expect(markdownToProse("__Big__ and _small_")).toBe("**Big** and *small*");
    expect(markdownToProse("a file_name_here stays")).toBe("a file_name_here stays");
  });

  it("tidies blank lines: none at either end, and a run of them counts as one", () => {
    expect(markdownToProse("\n\nOne\n\n\n\nTwo\n\n")).toBe("One\n\nTwo");
    expect(markdownToProse("One\r\nTwo")).toBe("One\nTwo");
  });

  it("leaves a social post's own text alone: hashtags, emoji and line breaks", () => {
    const post = "Another brilliant day 🎄\nThank you all ❤️\n\n#MadeUpTag #AnotherTag";
    expect(markdownToProse(post)).toBe(post);
  });
});

describe("htmlToProse: a highlighted selection arrives as HTML", () => {
  it("keeps paragraphs, line breaks, bold and italic from a highlighted Claude reply", () => {
    const html =
      '<p style="white-space: pre-wrap;">Dear friends,</p>' +
      '<p style="white-space: pre-wrap;">This winter we <strong>packed 300 bags</strong>.\nThat is <em>so</em> many.</p>';
    expect(fromHtml(html)).toBe("Dear friends,\n\nThis winter we **packed 300 bags**.\nThat is *so* many.");
  });

  it("turns a heading into its own bold paragraph, and a list into lines", () => {
    const html =
      "<h2>What we did</h2>" +
      "<ul><li>Wrapped</li><li><p>Packed</p></li></ul>" +
      '<ol start="3"><li>Delivered</li><li>Smiled</li></ol>' +
      "<p>Done.</p>";
    expect(fromHtml(html)).toBe("**What we did**\n\n• Wrapped\n• Packed\n\n3. Delivered\n4. Smiled\n\nDone.");
  });

  it("keeps a link's words and drops the address behind it", () => {
    expect(fromHtml('<p>Read <a href="https://example.org/story">our story</a> today</p>')).toBe(
      "Read our story today",
    );
  });

  it("keeps a Facebook-style post: a line per div, emoji drawn as pictures, hashtag links as words", () => {
    const html =
      '<div dir="auto">Another brilliant day <img alt="🎄" src="https://example.org/e1.png" width="16" height="16"></div>' +
      '<div dir="auto">Thank you all <img alt="❤️" src="https://example.org/e2.png"></div>' +
      '<div dir="auto"><a href="https://example.org/hashtag/madeuptag">#MadeUpTag</a></div>' +
      '<div role="button">See more</div>' +
      '<img alt="A crowd of made-up people" src="https://example.org/photo.jpg">';
    expect(fromHtml(html)).toBe("Another brilliant day 🎄\nThank you all ❤️\n#MadeUpTag");
  });

  it("keeps an X-style post's line breaks, carried as newlines inside pre-wrap", () => {
    const html = '<div style="white-space: pre-wrap;"><span>First line\nSecond line\n\nNew paragraph</span></div>';
    expect(fromHtml(html)).toBe("First line\nSecond line\n\nNew paragraph");
  });

  it("does not read Google Docs' outer <b style=font-weight:normal> as bold, only its bold spans", () => {
    const html =
      '<b style="font-weight:normal;" id="docs-internal-guid-made-up">' +
      '<p dir="ltr"><span style="font-weight:400;">Plain words and </span><span style="font-weight:700;">bold words</span></p>' +
      "</b>";
    expect(fromHtml(html)).toBe("Plain words and **bold words**");
  });

  it("does not mistake Word's mso-bidi-font-weight for font-weight", () => {
    const html =
      '<p class="MsoNormal"><b><span style="mso-bidi-font-weight:normal">Bold in Word</span></b> and plain<o:p></o:p></p>';
    expect(fromHtml(html)).toBe("**Bold in Word** and plain");
  });

  it("merges a phrase split across spans, and keeps spaces outside the markers", () => {
    const html = '<p><span style="font-weight:700">Thank</span> <span style="font-weight:700">you </span>all</p>';
    expect(fromHtml(html)).toBe("**Thank you** all");
  });

  it("drops fonts, colours, sizes and underline but keeps every word", () => {
    const html = '<p><span style="font-family:Comic Sans MS;color:#ff0000;font-size:30px"><u>Loud</u> words</span></p>';
    expect(fromHtml(html)).toBe("Loud words");
  });

  it("skips what is not content: styles, buttons, hidden bits", () => {
    const html =
      '<style>p{color:red}</style><p>Kept</p><button>Copy</button><span aria-hidden="true">icon</span>' +
      '<div style="display:none">Hidden</div>';
    expect(fromHtml(html)).toBe("Kept");
  });

  it("treats <br> as a line break, and Gmail's <div><br></div> as a blank line", () => {
    expect(fromHtml("<div>One<br>Two</div><div><br></div><div>Three</div>")).toBe("One\nTwo\n\nThree");
  });

  it("ignores the page's indentation between elements, even in pre-wrap", () => {
    const html = '<ol style="white-space: pre-wrap;">\n<li>One</li>\n<li>Two</li>\n</ol>';
    expect(fromHtml(html)).toBe("1. One\n2. Two");
  });

  it("puts each table row on its own line, its cells side by side", () => {
    expect(fromHtml("<table><tr><td>Bags</td><td>300</td></tr><tr><td>Helpers</td><td>40</td></tr></table>")).toBe(
      "Bags 300\nHelpers 40",
    );
  });

  it("returns nothing when there are no words, so the browser's own paste goes ahead", () => {
    expect(fromHtml('<img alt="" src="https://example.org/p.jpg">')).toBe("");
  });
});
