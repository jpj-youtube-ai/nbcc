# Pasting into the newsletter builder keeps the basics: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paste into the newsletter builder's four prose boxes keeps paragraphs, line breaks, bold and italic, and the email shows line breaks and paragraphs instead of running them together.

**Architecture:** The server's `proseHtml` (src/newsletter/theme.ts) gains a line-break pass after escaping and emphasis, so `<br>` joins `<strong>`/`<em>` as the only tags an author's text can produce. A new pure browser module, `assets/js/admin/paste-prose.js`, converts clipboard HTML (`htmlToProse`) or Markdown (`markdownToProse`) into the builder's plain-text markup; `app.js` calls it from a `paste` listener on the prose textareas and inserts the result at the cursor.

**Tech Stack:** TypeScript (server renderer), vanilla ES5-style browser JS (admin), Vitest (+ jsdom), Cucumber (BDD, CI only: no local database).

Spec: `docs/superpowers/specs/2026-09-30-newsletter-paste-formatting-design.md`. Task TASK-469, branch
`task-469-newsletter-paste-formatting`. Every sample text in the tests is invented: the repository is
public.

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/newsletter/theme.ts` | modify | `applyLineBreaks`, called by `proseHtml` |
| `test/unit/newsletter-blocks.test.ts` | modify | line breaks in the four prose fields |
| `test/unit/newsletter-plain-text.test.ts` | modify | the text part keeps the paragraphs |
| `assets/js/admin/paste-prose.js` | create | `htmlToProse`, `markdownToProse` |
| `test/unit/newsletter-paste.test.ts` | create | both converters, invented clipboard samples |
| `admin.html` | modify | load `paste-prose.js` before `app.js` |
| `test/unit/admin-shell.test.ts` | modify | pins that script order |
| `assets/js/admin/app.js` | modify | `nlPasteProse`, and the listener in `nlText` |
| `test/unit/newsletter-builder-ui.test.ts` | modify | a paste lands in the box and the saved document |
| `features/newsletter.feature`, `features/steps/newsletter.steps.js` | modify | two paragraphs preview as two |
| `README.md` | modify | the Newsletter tab section |

---

### Task 1: The email shows line breaks and paragraphs

**Files:**
- Modify: `src/newsletter/theme.ts` (`proseHtml`, ~line 93)
- Test: `test/unit/newsletter-blocks.test.ts` (append), `test/unit/newsletter-plain-text.test.ts` (append)

- [ ] **Step 1: Write the failing tests.** Append to `test/unit/newsletter-blocks.test.ts`:

```ts
// TASK-469: a prose field's line breaks reach the email. They used to arrive as raw newlines inside one
// <p>, which every mail client collapses to a space, so a second paragraph ran on from the first.
describe("line breaks and paragraphs in prose (TASK-469)", () => {
  const text = (body: string) => renderBlock({ type: "text", variant: 0, data: { text: body } }, ctx);

  it("turns a line break into <br> and a blank line into a paragraph gap", () => {
    const html = text("First paragraph.\n\nSecond paragraph.\nA line straight after.");
    expect(html).toContain("First paragraph.<br><br>Second paragraph.<br>A line straight after.");
  });

  it("counts a run of blank lines, or a line of only spaces, as one paragraph gap", () => {
    expect(text("One.\n\n\n\nTwo.")).toContain("One.<br><br>Two.");
    expect(text("One.\n   \nTwo.")).toContain("One.<br><br>Two.");
  });

  it("normalises Windows line endings and drops blank lines at either end", () => {
    const html = text("\r\n\r\nOne.\r\nTwo.\r\n\r\n");
    expect(html).toContain(">One.<br>Two.</p>");
    expect(html).not.toContain("\r");
  });

  it("still escapes first: a pasted tag stays text, and the only new tag is our own <br>", () => {
    const html = text("<b>not bold</b>\n<script>x</script>");
    expect(html).toContain("&lt;b&gt;not bold&lt;/b&gt;<br>&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("keeps bold and italic working on either side of a break", () => {
    expect(text("**Thank you**\n*so* much")).toContain("<strong>Thank you</strong><br><em>so</em> much");
  });

  it("does it in every prose field: the greeting intro, a story's body and a spotlight's quote", () => {
    const greeting = renderBlock({ type: "greeting", variant: 1, data: { lead: "Hello.\n\nWelcome." } }, ctx);
    expect(greeting).toContain("Hello.<br><br>Welcome.");
    const story = renderBlock({ type: "story", variant: 2, data: { title: "T", body: "Line one.\nLine two." } }, ctx);
    expect(story).toContain("Line one.<br>Line two.");
    const spotlight = renderBlock({ type: "spotlight", variant: 2, data: { name: "N", quote: "Kind.\nTruly.", role: "R" } }, ctx);
    expect(spotlight).toContain("Kind.<br>Truly.");
  });

  it("leaves a title alone: a heading is not prose", () => {
    const heading = renderBlock({ type: "heading", variant: 0, data: { title: "One\nTwo" } }, ctx);
    expect(heading).not.toContain("<br>");
  });
});
```

Append to `test/unit/newsletter-plain-text.test.ts` (and add
`import { renderBlock } from "../../src/newsletter/blocks";` below its existing import):

```ts
// TASK-469: the text part follows the email's paragraphs, because it is derived from the rendered HTML.
describe("paragraphs written in a prose field (TASK-469)", () => {
  it("keeps the blank line between paragraphs and the single line break", () => {
    const html = renderBlock(
      { type: "text", variant: 0, data: { text: "First paragraph.\n\nSecond paragraph.\nA line after." } },
      { firstName: "Jane" },
    );
    expect(htmlToPlainText(html)).toBe("First paragraph.\n\nSecond paragraph.\nA line after.");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/unit/newsletter-blocks.test.ts test/unit/newsletter-plain-text.test.ts -t "TASK-469"`
Expected: FAIL. The HTML still holds raw newlines ("expected … to contain 'First paragraph.<br><br>…'"),
and the text part reads "First paragraph. Second paragraph. A line after." on one line. The "leaves a title
alone" test passes already; it pins that titles stay untouched.

- [ ] **Step 3: Implement.** In `src/newsletter/theme.ts`, replace the `proseHtml` comment and function:

```ts
// TASK-469: line breaks. A prose field reached the email with its raw newlines inside one <p>, which
// every mail client collapses to a space, so a pasted (or typed) second paragraph ran straight on from
// the first. A newline becomes <br>, and a blank line a paragraph gap (<br><br>). Like the emphasis
// pass, this runs on ALREADY-ESCAPED copy, so <br> joins <strong>/<em> as the only tags we add.
// <br> rather than a <p> per paragraph: every block wraps its prose in its own styled <p> (the quotes
// add curly quotes around it), and <br> works in every mail client, Outlook included.
function applyLineBreaks(escaped: string): string {
  return escaped
    .replace(/\r\n?/g, "\n") // Windows and old Mac line endings
    .replace(/^[ \t ]+$/gm, "") // a line of only spaces is a blank line
    .replace(/^\n+|\n+$/g, "") // no blank lines at the very start or end
    .replace(/\n{3,}/g, "\n\n") // a run of blank lines is one paragraph gap
    .replace(/\n/g, "<br>");
}

// Prose an author wrote: escaped, then emphasised, then its line breaks kept. Use for any field where
// a paragraph is written — NOT for a title or a button label, where emphasis has no business.
export function proseHtml(text: string): string {
  return applyLineBreaks(applyEmphasis(escapeHtml(text)));
}
```

- [ ] **Step 4: Run them and watch them pass**, then every newsletter test, to catch a test elsewhere that
pinned the old run-together output.

Run: `npx vitest run test/unit/newsletter-blocks.test.ts test/unit/newsletter-plain-text.test.ts -t "TASK-469"`
Expected: PASS.
Run: `npx vitest run test/unit/newsletter`
Expected: all pass (a failure here is an old assertion about a newline; read it before touching it).

- [ ] **Step 5: Commit**

```bash
git add src/newsletter/theme.ts test/unit/newsletter-blocks.test.ts test/unit/newsletter-plain-text.test.ts
git commit -m "[TASK-469] The email shows a prose field's line breaks and paragraphs"
```

---

### Task 2: `markdownToProse`: Claude's Copy button

**Files:**
- Create: `assets/js/admin/paste-prose.js`
- Test: `test/unit/newsletter-paste.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `test/unit/newsletter-paste.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/newsletter-paste.test.ts`
Expected: FAIL: "Cannot find module …/assets/js/admin/paste-prose.js".

- [ ] **Step 3: Implement.** Create `assets/js/admin/paste-prose.js` with the Markdown half (Task 3 adds the
HTML half above it):

```js
// TASK-469: what a paste into a newsletter prose box keeps.
//
// The builder's prose boxes (Text, Greeting intro, Story body, Spotlight quote) are plain textareas.
// The server renders their text (src/newsletter/theme.ts proseHtml): a newline is a line break, a blank
// line starts a paragraph, and **bold** / *italic* are the only emphasis (TASK-253). A paste used to
// bring only the clipboard's plain words; these turn what was copied into that markup instead, so
// paragraphs, line breaks, bold and italic survive the trip:
//
//   htmlToProse(element)  - a highlighted selection (a Claude reply, a social post, a web page), which
//                           the clipboard carries as HTML. Pass the parsed document's <body>.
//   markdownToProse(text) - plain text written in Markdown (what Claude's Copy button puts on the
//                           clipboard).
//
// The rest is dropped on purpose: fonts, colours, sizes and pictures (the newsletter keeps its own
// look, and every inbox shows it the same), and the address behind a link (social posts are full of
// hashtag and @mention links; an address written out in the text stays as written). A heading becomes
// a bold paragraph, and a list item a line starting "• " or its number.
//
// Pure: no fetch and no document of its own, so both are unit-tested directly
// (test/unit/newsletter-paste.test.ts). In the browser they hang off window.PasteProse; app.js reads the
// clipboard and inserts the result where the author's cursor is.
(function () {
  "use strict";

  // ---- Markdown ---------------------------------------------------------------------------------

  // The inline half of Markdown, on one line.
  function inlineMarkdown(s) {
    return s
      .replace(/\s?!\[[^\]]*\]\([^)]*\)/g, "") // a picture goes, with the space before it
      .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/g, "$1") // [words](address) -> words
      .replace(/<(https?:\/\/[^>\s]+)>/g, "$1") // <https://...> -> the address, written out
      .replace(/`([^`]+)`/g, "$1") // `code` -> its text
      .replace(/(^|[^\w*])__(\S(?:[^_]*?\S)?)__(?!\w)/g, "$1**$2**") // __bold__ -> **bold**
      .replace(/(^|[^\w*])_(\S(?:[^_]*?\S)?)_(?!\w)/g, "$1*$2*"); // _italic_ -> *italic*, never mid-word
  }

  function markdownToProse(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var fenced = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var m;
      if (/^\s*(```|~~~)/.test(ln)) {
        fenced = !fenced; // a code fence goes; the code inside it stays as it is
        continue;
      }
      if (fenced) out.push(ln);
      else if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(ln)) out.push(""); // --- : a paragraph break
      else if ((m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(ln))) {
        var title = inlineMarkdown(m[1]).replace(/\*\*/g, "").trim();
        out.push("", title ? "**" + title + "**" : "", ""); // a heading: its own bold paragraph
      } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(ln))) out.push("• " + inlineMarkdown(m[1]));
      else if ((m = /^\s*>\s?(.*)$/.exec(ln))) out.push(inlineMarkdown(m[1]));
      else out.push(inlineMarkdown(ln));
    }
    return out
      .join("\n")
      .replace(/^[ \t]+$/gm, "") // a line of only spaces is blank
      .replace(/\n{3,}/g, "\n\n") // a run of blank lines counts as one
      .replace(/^\n+|\n+$/g, ""); // and there are none at either end
  }

  var api = { markdownToProse: markdownToProse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.PasteProse = api;
})();
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/newsletter-paste.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add assets/js/admin/paste-prose.js test/unit/newsletter-paste.test.ts
git commit -m "[TASK-469] Tidy pasted Markdown into the builder's own markup"
```

---

### Task 3: `htmlToProse`: a highlighted selection

**Files:**
- Modify: `assets/js/admin/paste-prose.js`
- Test: `test/unit/newsletter-paste.test.ts` (append)

- [ ] **Step 1: Write the failing tests.** Append to `test/unit/newsletter-paste.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/unit/newsletter-paste.test.ts -t "htmlToProse"`
Expected: FAIL: "htmlToProse is not a function".

- [ ] **Step 3: Implement.** In `assets/js/admin/paste-prose.js`, insert this HTML half right after
`"use strict";` (above the Markdown half), and change the export line to
`var api = { htmlToProse: htmlToProse, markdownToProse: markdownToProse };`:

```js
  // ---- HTML -------------------------------------------------------------------------------------

  // Never words: page furniture, code and controls that ride along with a selection.
  var SKIP = {
    SCRIPT: 1, STYLE: 1, HEAD: 1, TITLE: 1, META: 1, LINK: 1, TEMPLATE: 1, NOSCRIPT: 1,
    SVG: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1,
    BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1,
  };
  // Starts a new paragraph: a blank line before the next words.
  var PARAGRAPH = {
    P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1, PRE: 1,
    UL: 1, OL: 1, TABLE: 1, HR: 1, FIGURE: 1,
  };
  // Starts a new line.
  var LINE = {
    DIV: 1, LI: 1, TR: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, ASIDE: 1, NAV: 1,
    MAIN: 1, FIGCAPTION: 1, DL: 1, DT: 1, DD: 1, ADDRESS: 1, CENTER: 1, CAPTION: 1,
  };
  var HEADING = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };
  var BOLD = { B: 1, STRONG: 1 };
  var ITALIC = { I: 1, EM: 1, CITE: 1 };

  function tagOf(node) {
    return String(node.nodeName || "").toUpperCase();
  }

  function isBlock(node) {
    return !!node && node.nodeType === 1 && !!(PARAGRAPH[tagOf(node)] || LINE[tagOf(node)]);
  }

  // One declaration of an element's inline style, read as an exact property name: Word's
  // "mso-bidi-font-weight" is not "font-weight". Lower-cased; "" when absent.
  function styleOf(el, prop) {
    var style = el.getAttribute("style");
    if (!style) return "";
    var parts = style.split(";");
    for (var i = 0; i < parts.length; i++) {
      var colon = parts[i].indexOf(":");
      if (colon > 0 && parts[i].slice(0, colon).trim().toLowerCase() === prop) {
        return parts[i].slice(colon + 1).replace(/!important/i, "").trim().toLowerCase();
      }
    }
    return "";
  }

  // What a style value says: true, false, or null when it says nothing either way.
  function boldFrom(weight) {
    if (!weight) return null;
    if (weight === "bold" || weight === "bolder") return true;
    if (weight === "normal" || weight === "lighter") return false;
    var n = parseInt(weight, 10);
    return isNaN(n) ? null : n >= 600;
  }
  function italicFrom(fontStyle) {
    if (!fontStyle) return null;
    if (/^(italic|oblique)/.test(fontStyle)) return true;
    return fontStyle === "normal" ? false : null;
  }
  function keepsNewlinesFrom(whiteSpace) {
    if (!whiteSpace) return null;
    return /^(pre|pre-wrap|pre-line|break-spaces)$/.test(whiteSpace);
  }

  // A picture that is really a character: Facebook and X draw emoji as <img alt="😀">. Short, with no
  // letters or digits, so a photo's description never slips into the newsletter.
  function emojiOf(img) {
    var alt = (img.getAttribute("alt") || "").trim();
    if (!alt || alt.length > 16 || /[\p{L}\p{N}]/u.test(alt)) return "";
    return alt;
  }

  // "• " for a bulleted item; its number for a numbered one, counting from the list's start.
  function markerFor(li) {
    var list = li.parentNode;
    if (!list || tagOf(list) !== "OL") return "• ";
    var n = parseInt(list.getAttribute("start"), 10);
    if (isNaN(n)) n = 1;
    for (var s = li.previousSibling; s; s = s.previousSibling) {
      if (s.nodeType === 1 && tagOf(s) === "LI") n++;
    }
    return n + ". ";
  }

  // One line as the builder writes it. A space between two runs of the same emphasis joins them (a
  // phrase split across spans reads **Thank you**, not **Thank** **you**), runs with the same emphasis
  // merge, and markers hug the words: spaces go outside them.
  function renderLine(runs) {
    var i;
    for (i = 1; i < runs.length - 1; i++) {
      var before = runs[i - 1];
      var after = runs[i + 1];
      if (!/\S/.test(runs[i].text) && before.b === after.b && before.i === after.i) {
        runs[i].b = before.b;
        runs[i].i = before.i;
      }
    }
    var merged = [];
    for (i = 0; i < runs.length; i++) {
      var last = merged[merged.length - 1];
      if (last && last.b === runs[i].b && last.i === runs[i].i) last.text += runs[i].text;
      else merged.push({ text: runs[i].text, b: runs[i].b, i: runs[i].i });
    }
    var out = "";
    for (i = 0; i < merged.length; i++) {
      var r = merged[i];
      var parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text);
      if ((!r.b && !r.i) || !parts[2]) {
        out += r.text;
        continue;
      }
      var mark = r.b && r.i ? "***" : r.b ? "**" : "*";
      out += parts[1] + mark + parts[2] + mark + parts[3];
    }
    return out.replace(/\s+$/, "");
  }

  function htmlToProse(root) {
    var lines = []; // finished lines, each an array of runs { text, b, i }; [] is a blank line
    var line = [];
    var gapOwed = false; // a paragraph break is owed before the next words
    var marker = ""; // a list item's "• " or "3. ", written with its first words

    function endLine() {
      if (line.length) lines.push(line);
      line = [];
    }
    function paragraph() {
      endLine();
      gapOwed = true;
    }
    // <br>, or a newline kept by pre-wrap: ends the words so far, or on an empty line makes a blank one
    // (Gmail writes a blank line as <div><br></div>).
    function newline() {
      if (line.length) endLine();
      else lines.push([]);
    }
    function words(text, fmt) {
      // A space at the start of a line, or after another space, collapses as it does on the page.
      if (!line.length || /\s$/.test(line[line.length - 1].text)) text = text.replace(/^\s+/, "");
      if (!text) return;
      if (gapOwed && lines.length) lines.push([]);
      gapOwed = false;
      if (marker) {
        line.push({ text: marker, b: false, i: false });
        marker = "";
      }
      line.push({ text: text, b: fmt.b, i: fmt.i });
    }

    function walk(node, fmt) {
      if (node.nodeType === 3) {
        var text = node.nodeValue || "";
        // The page's own indentation between blocks, not the author's words.
        if (!/\S/.test(text) && (isBlock(node.previousSibling) || isBlock(node.nextSibling))) return;
        if (!fmt.pre) {
          words(text.replace(/\s+/g, " "), fmt);
          return;
        }
        var parts = text.replace(/\r\n?/g, "\n").split("\n");
        for (var k = 0; k < parts.length; k++) {
          if (k > 0) newline();
          words(parts[k].replace(/[ \t ]+/g, " "), fmt);
        }
        return;
      }
      if (node.nodeType !== 1) return; // comments, and Word's conditional leftovers
      var tag = tagOf(node);
      if (SKIP[tag]) return;
      if (node.getAttribute("role") === "button" || node.getAttribute("aria-hidden") === "true") return;
      if (styleOf(node, "display") === "none") return;
      if (tag === "BR") {
        newline();
        return;
      }
      if (tag === "IMG") {
        var emoji = emojiOf(node);
        if (emoji) words(emoji, fmt);
        return;
      }

      var inner = { b: fmt.b, i: fmt.i, pre: fmt.pre, heading: fmt.heading, inList: fmt.inList };
      if (BOLD[tag]) inner.b = true;
      if (ITALIC[tag]) inner.i = true;
      var bold = boldFrom(styleOf(node, "font-weight"));
      if (bold !== null) inner.b = bold;
      var italic = italicFrom(styleOf(node, "font-style"));
      if (italic !== null) inner.i = italic;
      if (HEADING[tag]) inner.heading = true;
      if (inner.heading) inner.b = true; // a heading is bold whatever its spans say (Google Docs' are 400)
      if (tag === "PRE") inner.pre = true;
      var keep = keepsNewlinesFrom(styleOf(node, "white-space"));
      if (keep !== null) inner.pre = keep;
      if (tag === "LI") inner.inList = true;

      // Inside a list item, a paragraph or a nested list is only the next line: no blank lines in a list.
      var isParagraph = !!PARAGRAPH[tag] && !(fmt.inList && (tag === "P" || tag === "UL" || tag === "OL"));
      var isLine = !isParagraph && !!(LINE[tag] || PARAGRAPH[tag]);
      if (isParagraph) paragraph();
      else if (isLine) endLine();
      if (tag === "LI") marker = markerFor(node);
      if ((tag === "TD" || tag === "TH") && line.length) words(" ", { b: false, i: false });

      for (var child = node.firstChild; child; child = child.nextSibling) walk(child, inner);

      if (isParagraph) paragraph();
      else if (isLine) endLine();
      if (tag === "LI") marker = "";
    }

    walk(root, { b: false, i: false, pre: false, heading: false, inList: false });
    endLine();

    var out = [];
    for (var n = 0; n < lines.length; n++) {
      var rendered = renderLine(lines[n]);
      if (rendered) out.push(rendered);
      else if (out.length && out[out.length - 1] !== "") out.push(""); // one blank line, never first
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.join("\n");
  }

```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run test/unit/newsletter-paste.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 5: Commit**

```bash
git add assets/js/admin/paste-prose.js test/unit/newsletter-paste.test.ts
git commit -m "[TASK-469] Turn a pasted selection into paragraphs, line breaks, bold and italic"
```

---

### Task 4: The builder uses it on paste

**Files:**
- Modify: `admin.html` (script tags, ~line 11), `assets/js/admin/app.js` (`nlText`, ~line 3417)
- Test: `test/unit/admin-shell.test.ts`, `test/unit/newsletter-builder-ui.test.ts`

- [ ] **Step 1: Write the failing tests.** In `test/unit/admin-shell.test.ts`, after the
"links the admin stylesheet + both scripts" test, add:

```ts
  // TASK-469: app.js reads window.PasteProse when a prose box is pasted into, so it must be there first.
  it("loads the paste converter before the app that uses it", () => {
    const at = html.indexOf('src="/assets/js/admin/paste-prose.js"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('src="/assets/js/admin/app.js"'));
  });
```

In `test/unit/newsletter-builder-ui.test.ts`, add below `const helpers = require(...)`:

```ts
const pasteProse = require(resolve(ROOT, "assets/js/admin/paste-prose.js"));
```

and append at the end of the file:

```ts
// TASK-469: a paste into a prose box keeps paragraphs, line breaks, bold and italic, written as the
// markers the B and I buttons write; a paste into any other box is left to the browser. jsdom has no
// clipboard, so the paste event carries a stub; it has no execCommand either, so this exercises the
// setRangeText fallback (a real browser takes the execCommand path, which keeps Ctrl+Z).
describe("pasting into a prose box (TASK-469)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    savedRequests.length = 0;
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (window as unknown as { PasteProse: unknown }).PasteProse = pasteProse;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc);
  });

  // A paste event carrying these clipboard contents, as the browser sends it.
  function paste(target: HTMLElement, clip: Record<string, string>) {
    const e = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: { getData: (type: string) => clip[type] || "" } });
    target.dispatchEvent(e);
    return e;
  }

  // The input or textarea under a field label on the canvas.
  function field(label: string) {
    const wrap = Array.prototype.find.call(
      el("nlCanvas").querySelectorAll(".nl-field"),
      (w: HTMLElement) => (w.querySelector(".nl-field-label")?.textContent || "").trim() === label,
    ) as HTMLElement;
    expect(wrap).toBeTruthy();
    return wrap.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement;
  }

  async function newTextBox() {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    (el("newsletterSubject") as HTMLInputElement).value = "Pasted";
    clickPalette("Text");
    return field("Text") as HTMLTextAreaElement;
  }

  it("keeps a highlighted reply's paragraphs and bold, inserted where the cursor is, and saves them", async () => {
    const box = await newTextBox();
    box.value = "Before  after";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.setSelectionRange(7, 7);

    const e = paste(box, {
      "text/html": "<p>We <strong>did it</strong>.</p><p>Thank you.</p>",
      "text/plain": "We did it.\n\nThank you.",
    });

    expect(e.defaultPrevented).toBe(true);
    expect(box.value).toBe("Before We **did it**.\n\nThank you. after");
    (el("newsletterForm") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    await flush();
    const sentDoc = savedRequests[0].body.bodyJson as { blocks: { data: { text?: string } }[] };
    expect(sentDoc.blocks[0].data.text).toBe("Before We **did it**.\n\nThank you. after");
  });

  it("tidies Claude's Copy-button Markdown the same way", async () => {
    const box = await newTextBox();
    box.value = "";
    box.dispatchEvent(new Event("input", { bubbles: true }));

    paste(box, { "text/plain": "## Our week\n\n- Packed **120** bags\n- Met [the team](https://example.org/team)" });

    expect(box.value).toBe("**Our week**\n\n• Packed **120** bags\n• Met the team");
  });

  it("leaves a paste into a one-line box to the browser", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    clickPalette("Heading");

    const e = paste(field("Title"), { "text/html": "<b>Bold</b>", "text/plain": "Bold" });

    expect(e.defaultPrevented).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/unit/admin-shell.test.ts test/unit/newsletter-builder-ui.test.ts -t "paste"`
Expected: FAIL: the script tag is missing (`expected -1 to be greater than -1`), and the paste is not
converted (`expected false to be true` on `defaultPrevented`). The one-line box test already passes.

- [ ] **Step 3: Implement.** In `admin.html`, between the helpers and app script tags:

```html
    <script defer src="/assets/js/admin/helpers.js"></script>
    <script defer src="/assets/js/admin/paste-prose.js"></script>
    <script defer src="/assets/js/admin/app.js"></script>
```

In `assets/js/admin/app.js`, add above `function nlText(`:

```js
  // TASK-469: a paste into a prose box keeps the basics (paragraphs, line breaks, bold and italic),
  // written as the markers the B and I buttons write, so the preview and the email show them.
  // paste-prose.js does the converting and is unit-tested on its own; this reads the clipboard and
  // inserts the result where the author's cursor is. Without the converter, or with nothing to insert,
  // the browser's own paste goes ahead.
  function nlPasteProse(e, input) {
    var P = window.PasteProse;
    var clip = e.clipboardData;
    if (!P || !clip) return;
    var html = clip.getData("text/html");
    var text = html
      ? P.htmlToProse(new DOMParser().parseFromString(html, "text/html").body)
      : P.markdownToProse(clip.getData("text/plain"));
    if (!text) return;
    e.preventDefault();
    // execCommand keeps Ctrl+Z working and fires "input", which saves the block and refreshes the
    // preview exactly as typing does. Where it is unavailable, insert and announce by hand.
    var inserted = false;
    try {
      inserted = typeof doc.execCommand === "function" && doc.execCommand("insertText", false, text);
    } catch (err) {
      inserted = false;
    }
    if (!inserted) {
      input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
```

and in `nlText`, replace

```js
    if (nlReadOnly()) input.disabled = true;
    else input.addEventListener("input", function () { obj[key] = input.value; nlSchedulePreview(); });
```

with

```js
    if (nlReadOnly()) input.disabled = true;
    else {
      input.addEventListener("input", function () { obj[key] = input.value; nlSchedulePreview(); });
      // TASK-469: a prose box keeps what matters from a paste; a one-line box pastes plain text.
      if (opts.multiline) input.addEventListener("paste", function (e) { nlPasteProse(e, input); });
    }
```

- [ ] **Step 4: Run them and watch them pass**, then every test that loads the admin page.

Run: `npx vitest run test/unit/admin-shell.test.ts test/unit/newsletter-builder-ui.test.ts -t "paste"`
Expected: PASS.
Run: `npx vitest run $(grep -rlE 'admin/app\.js|admin\.html' test/unit | tr '\n' ' ')`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add admin.html assets/js/admin/app.js test/unit/admin-shell.test.ts test/unit/newsletter-builder-ui.test.ts
git commit -m "[TASK-469] A paste into a newsletter prose box keeps the basics"
```

---

### Task 5: BDD: two paragraphs preview as two

**Files:**
- Modify: `features/newsletter.feature`, `features/steps/newsletter.steps.js`

There is no local database (see the team notes), so this runs only in CI's `pr.yml`. Confirm there that
the scenario count went up by one.

- [ ] **Step 1: Add the scenario** after "an Editor creates a block-document draft and previews it":

```gherkin
  Scenario: a text block written in two paragraphs previews as two paragraphs
    Given a newsletter admin "paste.editor.newsletter.bdd@example.com" with role "editor" and password "pw-paste"
    When I preview a block document whose text reads:
      """
      First paragraph.

      Second paragraph.
      And a line straight after.
      """
    Then the preview response status should be 200
    And the preview HTML should contain "First paragraph.<br><br>Second paragraph.<br>And a line straight after."
```

- [ ] **Step 2: Add the step** after `When("I preview the current block document", …)`:

```js
// TASK-469: a text block's paragraphs and line breaks reach the preview (and so the email).
When("I preview a block document whose text reads:", async function (text) {
  const bodyJson = { blocks: [{ type: "text", variant: 0, data: { text } }] };
  const r = await authFetch("/api/admin/newsletters/preview", "POST", { bodyJson }, this.token);
  this.previewStatus = r.status;
  this.previewHtml = r.json.html || "";
});
```

- [ ] **Step 3: Check the syntax locally** (the scenario itself runs in CI):
Run: `node --check features/steps/newsletter.steps.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add features/newsletter.feature features/steps/newsletter.steps.js
git commit -m "[TASK-469] BDD: a text block's two paragraphs preview as two"
```

---

### Task 6: README

**Files:**
- Modify: `README.md` (the Newsletter tab section, after the text-size-step paragraph ending
  "mirrored by `NL_NO_SIZE` in the builder.")

- [ ] **Step 1: Add the paragraph**

```markdown
**Bold, italic and line breaks in prose, and what a paste keeps (TASK-253, TASK-469).** The four prose
boxes (Text, Greeting intro, Story body, Spotlight quote) are plain text carrying two markers the server
turns into emphasis, `**bold**` and `*italic*`, which the **B** / **I** buttons above each box write
(TASK-253). Their line breaks reach the email as well (TASK-469). `proseHtml` turns a newline into `<br>`
and a blank line into a paragraph gap (`<br><br>`), after escaping, so `<strong>`, `<em>` and `<br>`
remain the only tags an author's text can produce. Until then, a second paragraph ran straight on from
the first, because mail clients collapse a raw newline to a space. A **paste** into one of those boxes
keeps the basics. `assets/js/admin/paste-prose.js` turns a highlighted selection (clipboard HTML: a
Claude reply, a social post) or Markdown (Claude's Copy button) into the same markup. Paragraphs, line
breaks, bold and italic come across; a heading becomes a bold paragraph, and a list item a line starting
`• ` or its number. A link keeps only its words: the address behind it is dropped, while an address
written out in the text stays. Fonts, colours, sizes and pictures are dropped, and emoji kept. The
result goes in with `execCommand("insertText")`, so Ctrl+Z undoes a paste. Every other box pastes plain
text, as before.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "[TASK-469] README: what a paste into the newsletter builder keeps"
```

---

### Task 7: Verify and ship

- [ ] **Step 1: Preflight.** Run `npm run lint && npm run build && npm run test:unit`. The one expected
local failure is `perf-budget` (donate.html, CRLF line endings on Windows). Anything else is real.
- [ ] **Step 2: Real browser.** Use a stand-in server that serves the real `admin.html` and assets, and
answers `POST /api/admin/newsletters/preview` with the real renderer (tsx). Open Newsletter → New → Text,
dispatch real `ClipboardEvent("paste")`s carrying a DataTransfer (a Claude-style reply, Markdown, a
Facebook-style post), and check the box and the preview. Take a screenshot.
- [ ] **Step 3: Independent review** (superpowers:requesting-code-review), as a background agent.
- [ ] **Step 4: Ship with `/ship`:** re-check the task number (runs, PR titles, local branches), push, open
the PR, bind it (ccd_pr), merge on green, find the deploy by the merge SHA, and confirm
`https://nbcc.scot/assets/js/admin/paste-prose.js` is served live.
