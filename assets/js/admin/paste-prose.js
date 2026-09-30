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

  var api = { htmlToProse: htmlToProse, markdownToProse: markdownToProse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.PasteProse = api;
})();
