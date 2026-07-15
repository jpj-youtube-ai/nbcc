import { describe, it, expect } from "vitest";
import { escapeHtml, applyMerge, renderFrame, brandButton } from "../../src/newsletter/theme";

describe("newsletter theme", () => {
  it("escapes HTML-special characters", () => {
    expect(escapeHtml(`<b>&"x`)).toBe("&lt;b&gt;&amp;&quot;x");
  });
  it("merges the first name and escapes both text and name", () => {
    expect(applyMerge("Dear {{firstName}} <ok>", { firstName: "Jane & Co" })).toBe(
      "Dear Jane &amp; Co &lt;ok&gt;",
    );
  });
  it("frame wraps content with the cream card and the OSCR footer line", () => {
    const html = renderFrame("<p>BODYMARK</p>");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("BODYMARK");
    expect(html).toContain("SC047995");
    expect(html).toContain("newsletter@nbcc.scot");
    expect(html).toContain("#F8F5EE"); // cream card
  });
  it("footer mirrors the thank-you letter: circular contact icons around the text", () => {
    const html = renderFrame("<p>x</p>");
    // inline SVGs (phone/envelope/social) render in clients that support them and
    // degrade to the plain contact text where they're stripped.
    expect((html.match(/<svg/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("01292 811 015");
    expect(html).toContain("nbcc.scot");
    expect(html).toContain("border-radius:50%"); // the circular icon chips
  });
  it("renders a branded Unsubscribe button only when an unsubscribe URL is given", () => {
    const without = renderFrame("<p>x</p>");
    expect(without).not.toContain("Unsubscribe");

    const withUrl = renderFrame("<p>x</p>", "https://nbcc.scot/unsubscribe/abc.def");
    expect(withUrl).toContain(">Unsubscribe<");
    expect(withUrl).toContain('href="https://nbcc.scot/unsubscribe/abc.def"');
    expect(withUrl).toContain("opted in"); // the PECR reason line
  });
  it("pins a light color-scheme so dark-mode mail clients don't invert the palette", () => {
    const html = renderFrame("<p>x</p>");
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light">');
    expect(html).toContain("color-scheme: light");
  });
  it("footer contacts are cream-coloured anchors so clients don't auto-link them blue", () => {
    const html = renderFrame("<p>x</p>");
    // Each contact is an explicit <a> with an inline cream colour — pre-empts the phone/email/URL
    // auto-linkification that would otherwise render them as default blue links.
    expect(html).toContain('<a href="tel:+441292811015" style="color:#F8F5EE;text-decoration:none">01292 811 015</a>');
    expect(html).toContain('<a href="mailto:newsletter@nbcc.scot" style="color:#F8F5EE;text-decoration:none">newsletter@nbcc.scot</a>');
    expect(html).toContain('<a href="https://nbcc.scot" style="color:#F8F5EE;text-decoration:none">nbcc.scot</a>');
  });
  it("brandButton renders an anchor with the label and href", () => {
    const b = brandButton("Donate", "https://nbcc.scot/donate", "primary");
    expect(b).toContain("https://nbcc.scot/donate");
    expect(b).toContain("Donate");
    expect(b).toContain("#C02238"); // crimson primary
  });
});
