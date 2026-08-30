import { describe, it, expect } from "vitest";
import { renderGuestPage, renderGuestNotFound } from "../../src/ball/guest-page";

const booking = {
  reference: "BALL-K7M2PQ",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerName: "Jo Smith",
  tableName: null,
};

const render = (over: Partial<Parameters<typeof renderGuestPage>[0]> = {}) =>
  renderGuestPage({ booking, guests: [], token: "tok123", ...over });

describe("renderGuestPage", () => {
  it("gives one set of fields per seat booked", () => {
    const html = render();
    for (let n = 1; n <= 10; n += 1) expect(html).toContain(`name="fullName${n}"`);
    expect(html).not.toContain('name="fullName11"');
  });

  it("asks for only two seats when only two were bought", () => {
    const html = renderGuestPage({
      booking: { ...booking, kind: "seat", quantity: 2, seats: 2 },
      guests: [],
      token: "t",
    });
    expect(html).toContain('name="fullName2"');
    expect(html).not.toContain('name="fullName3"');
  });

  it("works with no JavaScript at all", () => {
    const html = render();
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/ball/guests/tok123"');
    expect(html).not.toContain("<script");
  });

  it("says plainly that a partial save is fine, so nobody waits for all ten names", () => {
    expect(render()).toMatch(/don't have to do it all at once/i);
  });

  it("reports progress honestly", () => {
    expect(render()).toContain("You haven't added anyone yet.");
    expect(render({ guests: [{ fullName: "Jo", dietary: null, accessNeeds: null }] }))
      .toContain("1 of 10 added so far.");
  });

  it("explains who sees the sensitive answers and when they are deleted, on the page itself", () => {
    const html = render();
    expect(html).toMatch(/pass the food and access notes to The Park Hotel/i);
    expect(html).toMatch(/delete all of it 90 days after the ball/i);
  });

  it("asks about food and access in plain words, not jargon", () => {
    const html = render();
    // Literal template text, so the apostrophe is NOT entity-escaped — only interpolated
    // values pass through escapeHtml.
    expect(html).toMatch(/Anything they can't eat\?/);
    expect(html).toMatch(/need to get around comfortably/i);
    // "Dietary requirements" and "access needs" are our words, not a guest's.
    expect(html).not.toMatch(/<span>Dietary requirements<\/span>/);
  });

  it("offers a private route for anything someone would rather not type into a form", () => {
    expect(render()).toMatch(/rather tell us something privately/i);
  });

  it("names the action on the button", () => {
    expect(render()).toContain(">Save guest details</button>");
    expect(render()).not.toMatch(/>Submit</);
  });

  it("pre-fills what was already given so nothing is retyped", () => {
    const html = render({
      guests: [{ fullName: "Pat Brown", dietary: "Coeliac", accessNeeds: "Step-free" }],
      booking: { ...booking, tableName: "Ayrshire Bakery" },
    });
    expect(html).toContain('value="Pat Brown"');
    expect(html).toContain('value="Coeliac"');
    expect(html).toContain('value="Ayrshire Bakery"');
  });

  it("confirms a save and says they can come back", () => {
    const html = render({ saved: true });
    expect(html).toMatch(/Saved, thank you/);
    expect(html).toMatch(/come back to this page any time/i);
  });

  it("shows an error instead of a success when something failed", () => {
    const html = render({ error: "Every guest needs a name." });
    expect(html).toContain("Every guest needs a name.");
    expect(html).not.toMatch(/Saved, thank you/);
  });

  it("escapes guest-entered text", () => {
    const html = render({
      guests: [{ fullName: '"><script>alert(1)</script>', dietary: null, accessNeeds: null }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is hidden from search engines", () => {
    expect(render()).toContain('content="noindex, nofollow"');
  });
});

describe("renderGuestNotFound", () => {
  it("does not reveal whether the booking exists", () => {
    const html = renderGuestNotFound();
    // An unknown token and an expired one must look identical, so the page cannot be used to
    // probe which references are real.
    expect(html).toMatch(/may have expired, or the address may have been copied incompletely/i);
    expect(html).not.toMatch(/no such booking|not found in our records/i);
  });

  it("tells the reader exactly how to get unstuck", () => {
    expect(renderGuestNotFound()).toContain("events@nbcc.scot");
  });
});
