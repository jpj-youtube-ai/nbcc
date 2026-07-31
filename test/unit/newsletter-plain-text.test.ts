import { describe, it, expect } from "vitest";
import { htmlToPlainText } from "../../src/newsletter/plain-text";

// TASK-275: newsletters went out HTML-only. A missing text/plain part counts against a sender with
// spam filters, and leaves text-only clients, some screen readers and notification previews with
// nothing useful. Derived from the rendered HTML on purpose — a per-block text renderer would need
// extending for every new block type, and the day someone forgets is the day half the text goes
// missing.

describe("htmlToPlainText", () => {
  it("keeps the words and drops the markup", () => {
    expect(htmlToPlainText("<p>Hello <strong>Ann</strong>, thank you.</p>")).toBe("Hello Ann, thank you.");
  });

  it("breaks lines where blocks end, not mid-sentence", () => {
    const out = htmlToPlainText("<p>First para</p><p>Second para</p>");
    expect(out).toBe("First para\nSecond para");
    // inline emphasis must NOT introduce a break
    expect(htmlToPlainText("<p>a <em>b</em> c</p>")).toBe("a b c");
  });

  it("honours <br> and turns a rule into something visible", () => {
    expect(htmlToPlainText("<p>one<br>two</p>")).toBe("one\ntwo");
    // a section break, with one blank line either side — not a stray line of dashes
    expect(htmlToPlainText("<p>a</p><hr /><p>b</p>")).toBe("a\n\n---\n\nb");
  });

  // The point of the text part is that someone who cannot click still has somewhere to go.
  it("keeps a link's destination beside its label", () => {
    expect(htmlToPlainText('<a href="https://nbcc.scot/donate">Donate now</a>')).toBe(
      "Donate now (https://nbcc.scot/donate)",
    );
  });

  it("does not print a URL twice when the label is the URL", () => {
    expect(htmlToPlainText('<a href="https://nbcc.scot">https://nbcc.scot</a>')).toBe("https://nbcc.scot");
  });

  it("leaves mailto and tel as their readable label", () => {
    expect(htmlToPlainText('<a href="mailto:giving@nbcc.scot">giving@nbcc.scot</a>')).toBe("giving@nbcc.scot");
    expect(htmlToPlainText('<a href="tel:+441292811015">01292 811 015</a>')).toBe("01292 811 015");
  });

  it("decodes the entities the renderer emits", () => {
    expect(htmlToPlainText("<p>Ben &amp; Jerry &mdash; &pound;20 &rsquo;s</p>")).toBe("Ben & Jerry — £20 ’s");
    expect(htmlToPlainText("<p>&#163;5</p>")).toBe("£5");
  });

  it("throws away script, style and comments entirely — contents included", () => {
    const out = htmlToPlainText('<style>.x{color:red}</style><p>Real</p><script>alert(1)</script><!-- note -->');
    expect(out).toBe("Real");
  });

  // A table-based email is mostly empty cells; without this the text part is a column of whitespace.
  it("collapses the whitespace a table layout produces", () => {
    const html = "<table><tr><td></td></tr><tr><td><p>Only line</p></td></tr><tr><td>  </td></tr></table>";
    expect(htmlToPlainText(html)).toBe("Only line");
  });

  it("never leaves leading or trailing blank space", () => {
    expect(htmlToPlainText("<div><div><p>  padded  </p></div></div>")).toBe("padded");
  });

  it("survives an empty or markup-only document without throwing", () => {
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText("<div></div>")).toBe("");
  });
});
