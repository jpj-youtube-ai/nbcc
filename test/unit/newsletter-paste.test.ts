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
