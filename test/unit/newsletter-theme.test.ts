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
    expect(html).toContain("info@nbcc.scot");
    expect(html).toContain("#F8F5EE"); // cream card
  });
  it("brandButton renders an anchor with the label and href", () => {
    const b = brandButton("Donate", "https://nbcc.scot/donate", "primary");
    expect(b).toContain("https://nbcc.scot/donate");
    expect(b).toContain("Donate");
    expect(b).toContain("#C02238"); // crimson primary
  });
});
