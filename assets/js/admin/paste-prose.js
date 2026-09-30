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
