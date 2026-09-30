# Pasting into the newsletter builder keeps the basics: design

Date: 2026-09-30. Task: TASK-469. The client chose "just the basics" (paragraphs, line breaks, bold
and italic) and that a linked phrase arrives as its words, without the address behind them. They paste
mostly from Claude (a highlighted reply, or its Copy button) and from social media posts.

## The problem

1. **Pasting brings only the words.** The builder's prose boxes are plain `<textarea>`s, and a
   textarea takes the clipboard's plain text: bold, italic and headings are lost on the way in.
2. **Paragraphs run together in the email.** A prose field is rendered as one `<p>` with the raw
   newlines inside it (`proseHtml` in `src/newsletter/theme.ts`), and HTML collapses newlines to
   spaces. A two-paragraph pasted draft reads as one block, in the preview and in the sent email.
   Typed line breaks have always been lost the same way.
3. **Claude's Copy button pastes Markdown.** `**bold**` and `*italic*` already match the builder's
   own markers (TASK-253), but `## headings`, `- bullets` and `[links](…)` print literally.

## Decisions

The four prose boxes are the ones the email already formats: **Text**, **Greeting intro**,
**Story body** and **Spotlight quote** (every multi-line box in the builder; the B / I buttons sit on
exactly these). Every other box (titles, names, labels, the one-line Ways-to-help body) is unchanged.

| Pasted | Arrives in the box as |
|---|---|
| A paragraph | its own paragraph, a blank line before the next |
| A line break | a line break |
| Bold, italic | `**bold**`, `*italic*`: the markers the B and I buttons make |
| A heading | its own paragraph, in bold |
| A list item | its own line, starting `• ` (bulleted) or `1. ` (numbered) |
| A link | its visible words; the address behind them is dropped |
| A web address written out in the text | itself, as written |
| An emoji drawn as a picture (Facebook) | the emoji |
| Other pictures | dropped |
| Fonts, colours, sizes, underline, highlight, strikethrough | dropped; the words are kept |
| Code | its text |
| Markdown in plain text (Claude's Copy button) | the same rules |

In the email, in those four fields, **a line break shows as a line break and a blank line starts a
new paragraph**, whether the text was pasted or typed. Runs of blank lines count as one (a line
holding only spaces is blank), Windows line endings are normalised, and blank lines at the very start
or end are dropped. Drafts and templates
that already hold line breaks start showing them as they were typed; emails already sent are
unaffected. Ctrl+Z undoes a paste like any other edit.

## How it works

### The email: `proseHtml`

`escapeHtml` → emphasis → line breaks. A newline becomes `<br>` and a paragraph break `<br><br>`.
This keeps TASK-253's safety argument whole: the author's text holds no live markup by the time any
tag is added, and the only tags that can reach an inbox are the three we add (`<strong>`, `<em>`,
`<br>`). `<br>` rather than a `<p>` per paragraph, because every block wraps its prose in its own
styled `<p>` (the quotes add curly quotes around it) and `<br>` works in every mail client, Outlook
included, with no block renderer changed. The `{{firstName}}` merge still runs after, on the same
safe text; `applySizeStep` is unaffected; the plain-text part (`htmlToPlainText`) already turns
`<br>` into a newline and keeps one blank line between paragraphs, so it follows by construction.

### The paste: `assets/js/admin/paste-prose.js`

A new file in the style of `helpers.js` (window global in the browser, `module.exports` in tests),
loaded by `admin.html` before `app.js`. Not added to `helpers.js`, which is deliberately DOM-free. Two
pure functions, both returning the builder's plain-text markup:

- **`htmlToProse(node)`** walks the parsed clipboard HTML. Block elements start a new line or
  paragraph (`<p>`, headings and quotes a paragraph; `<div>`, list items and table rows a line;
  `<br>` a line). Bold and italic come from tags and from inline `font-weight` / `font-style`, read
  as exact properties: Google Docs' `<b style="font-weight:normal">` wrapper is not bold, and Word's
  `mso-bidi-font-weight` is not `font-weight`. Text inside `white-space: pre / pre-wrap / pre-line`
  (or `<pre>`) keeps its newlines, which is how X and Claude's chat carry line breaks. An `<img>`
  whose `alt` is an emoji becomes that emoji. Markers hug the words (spaces move outside), never
  span a line break, and adjacent runs with the same emphasis merge.
- **`markdownToProse(text)`** tidies a plain-text paste: `#` headings become a bold paragraph;
  `-`, `*`, `+` bullets become `• `; `[words](url)` becomes the words; backticks, `>` quote markers
  and `---` rules go; `__x__` / `_x_` become `**x**` / `*x*`, but only where the underscores are
  not inside a word (`file_name` stays as it is); `**x**` / `*x*` stay as they are.

In `app.js`, `nlText` gives every multi-line (prose) box a `paste` listener. When the clipboard
carries HTML (a highlighted selection, a social post), it goes through `DOMParser` and
`htmlToProse`. When it carries only plain text (Claude's Copy button writes Markdown as plain text),
that goes through `markdownToProse`. The result is
inserted at the selection with `document.execCommand("insertText")`, so Ctrl+Z undoes it and the
box's own `input` handler updates the block and the preview exactly as typing does
(`setRangeText` is the fallback where that command is unavailable). The selection is set afresh just
before, because Chrome otherwise folds the insert into the words typed before it and one Ctrl+Z takes
both (found in headless Chrome while verifying; the paste is now its own undo step, as a normal paste
is). If the converter is missing or
returns nothing, the browser's ordinary paste goes ahead.

Nothing from the clipboard reaches the server except the plain-text result, which the server
escapes like any other text.

## Testing

- `test/unit/newsletter-blocks.test.ts`: a newline gives `<br>`, a blank line a paragraph gap, runs
  of blank lines collapse, CRLF is normalised, escaping still comes first (a pasted `<b>` stays
  text), emphasis still works around line breaks, and the plain-text part keeps the paragraphs.
- A new `test/unit/newsletter-paste.test.ts` (jsdom): invented clipboard samples shaped like a
  highlighted Claude reply (paragraphs, bold, a heading, a list, a link, `pre-wrap` line breaks),
  Claude's Copy-button Markdown, a Facebook-style post (a line per `<div>`, emoji pictures, hashtag
  and @mention links), an X-style post (newlines in `pre-wrap`), and the Google Docs and Word bold
  pitfalls. Every word in them is made up: the repository is public.
- `test/unit/newsletter-builder-ui.test.ts`: a paste into a prose box inserts the converted text at
  the caret and updates the block; a paste into a title box is left to the browser.
- `features/newsletter.feature`: previewing a text block written as two paragraphs shows two
  paragraphs.
- A real-browser check against the stand-in admin, pasting real clipboard content.

## Not in this task

Clickable links in prose (the Button block does that), lists as real list formatting, an editor that
shows bold as bold while typing, and any box other than the four above.
