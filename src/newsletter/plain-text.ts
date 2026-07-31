// TASK-275: the plain-text half of every newsletter.
//
// Newsletters went out HTML-only. Spam filters treat a missing text/plain part as a mild negative on
// its own, and it leaves anyone reading in a text-only client, a screen reader that prefers text, or a
// watch/notification preview with nothing but stripped markup. The thank-you letters have carried a
// text part for ages (src/thank-you/letter.ts) — the newsletter was the one send that skipped it.
//
// Deliberately derived from the RENDERED HTML rather than walking the block document. A per-block text
// renderer would have to be extended every time a block type is added, and the day someone forgets is
// the day a newsletter goes out with half its text part missing. Working from the finished HTML means
// every block — including ones not invented yet — is covered by construction.

// Tags after which a line break belongs. Everything else is inline and should not break a sentence.
const BLOCK_END = /<\/(p|div|h[1-6]|li|tr|table|blockquote|section|header|footer)\s*>/gi;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&mdash;": "—",
  "&ndash;": "–",
  "&pound;": "£",
  "&rarr;": "→",
  "&hellip;": "…",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

// Keep the destination of a link: "Donate now (https://nbcc.scot/donate)". A text reader who cannot
// click still needs somewhere to go — dropping the href would strip every call to action in the email.
// A link whose text already IS the URL is left alone rather than printed twice; mailto/tel are already
// readable as their label.
function inlineLinks(html: string): string {
  return html.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const label = stripTags(inner).trim();
    const url = href.trim();
    if (!url || url.startsWith("mailto:") || url.startsWith("tel:")) return label;
    if (!label) return url;
    return label === url ? label : `${label} (${url})`;
  });
}

// Rendered newsletter HTML -> the text/plain alternative.
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    // Anything that never carries reader-facing words goes first, contents and all.
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    // A divider gets a blank line either side; the collapse pass below trims any run to one, so it
    // reads as a section break rather than a stray line of dashes.
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

  const text = decodeEntities(stripTags(inlineLinks(withBreaks.replace(BLOCK_END, "$&\n"))));

  return text
    .split("\n")
    // \u00A0 is the non-breaking space the renderer emits (&nbsp;, decoded above) — collapse it along
    // with ordinary runs rather than leaving invisible padding in the text part.
    .map((line) => line.replace(/[ \t\u00A0]+/g, " ").trim())
    // A table-based email produces long runs of empty cells; collapse them to at most one blank line
    // so the text part reads as paragraphs rather than a column of whitespace.
    .filter((line, i, all) => line.length > 0 || (i > 0 && all[i - 1].length > 0))
    .join("\n")
    .trim();
}
