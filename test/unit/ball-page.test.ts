import { describe, it, expect } from "vitest";
import { renderBallPage } from "../../src/ball/page";

const TEMPLATE = `<html><head>
<meta name="robots" content="noindex, nofollow" data-region="robots" />
</head><body>
<span data-region="arrival">Start time to be confirmed</span>
<p data-region="included">Entry to the ball, a meal, and the full evening's entertainment.</p>
<span class="v" data-region="arrival-2">To be confirmed</span>
<p data-region="lineup" class="ball-tbc">Special guests still to be announced.</p>
</body></html>`;

const BLANK = { arrivalTime: null, includedNote: null, lineUpNote: null };

describe("renderBallPage", () => {
  it("keeps noindex while the gate is shut", () => {
    const html = renderBallPage(TEMPLATE, { settings: BLANK, gateOpen: false });
    expect(html).toContain('content="noindex, nofollow"');
  });

  it("lets search engines in once the gate is open", () => {
    const html = renderBallPage(TEMPLATE, { settings: BLANK, gateOpen: true });
    expect(html).toContain('content="index, follow"');
    expect(html).not.toContain("noindex");
  });

  it("leaves the to-be-confirmed wording alone when nothing is confirmed", () => {
    const html = renderBallPage(TEMPLATE, { settings: BLANK, gateOpen: false });
    expect(html).toContain("Start time to be confirmed");
    expect(html).toContain("Special guests still to be announced.");
  });

  it("publishes an arrival time in both places once staff set it", () => {
    const html = renderBallPage(TEMPLATE, {
      settings: { ...BLANK, arrivalTime: "7pm for 7.30pm" },
      gateOpen: true,
    });
    expect(html).toContain(">7pm for 7.30pm<");
    expect(html).not.toContain("Start time to be confirmed");
    expect(html).not.toContain(">To be confirmed<");
  });

  it("appends the menu detail to the confirmed inclusions rather than replacing them", () => {
    const html = renderBallPage(TEMPLATE, {
      settings: { ...BLANK, includedNote: "Arrival drink and a three-course dinner." },
      gateOpen: true,
    });
    expect(html).toContain("Entry to the ball, a meal, and the full evening's entertainment.");
    expect(html).toContain("Arrival drink and a three-course dinner.");
  });

  it("replaces the line-up note when guests are announced", () => {
    const html = renderBallPage(TEMPLATE, {
      settings: { ...BLANK, lineUpNote: "Plus a special guest, announced soon." },
      gateOpen: true,
    });
    expect(html).toContain("Plus a special guest, announced soon.");
    expect(html).not.toContain("Special guests still to be announced.");
  });

  it("escapes staff-entered text so a stray angle bracket cannot break the page", () => {
    const html = renderBallPage(TEMPLATE, {
      settings: { ...BLANK, arrivalTime: '7pm <script>alert("x")</script>' },
      gateOpen: true,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps the surrounding attributes on the elements it fills", () => {
    const html = renderBallPage(TEMPLATE, {
      settings: { ...BLANK, arrivalTime: "7pm" },
      gateOpen: false,
    });
    expect(html).toContain('class="v" data-region="arrival-2"');
  });

  it("is a no-op on a template with no regions", () => {
    expect(renderBallPage("<p>hello</p>", { settings: BLANK, gateOpen: false })).toBe("<p>hello</p>");
  });
});
