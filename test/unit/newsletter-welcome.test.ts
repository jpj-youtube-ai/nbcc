import { describe, it, expect } from "vitest";
import { buildWelcomeEmail, shouldSendWelcome, WELCOME_SUBJECT } from "../../src/newsletter/welcome";

// TASK-276: the welcome email for a website signup.
//
// It carries a job beyond being friendly: it is the SAFEGUARD that makes one-step signup safe. Joining
// is immediate — no confirmation click, so nobody is lost to an unclicked email — and this arrives at
// once to say what happened, with the same one-click unsubscribe as every other send. Anyone added by
// someone else therefore finds out immediately and can leave in one press.

describe("shouldSendWelcome — who gets one", () => {
  it("welcomes somebody who just signed up on the website", () => {
    expect(shouldSendWelcome("footer")).toBe(true);
  });

  // The rule that matters most. A volunteer importing a spreadsheet of several hundred people must
  // NOT trigger several hundred unexpected emails: that is the "why am I getting this?" reaction that
  // produces spam complaints, and complaints cost the sending domain far more than a welcome is worth.
  it("never welcomes an imported list", () => {
    expect(shouldSendWelcome("import")).toBe(false);
  });

  it("does not welcome someone staff typed in — usually a conversation already had", () => {
    expect(shouldSendWelcome("admin")).toBe(false);
  });
});

describe("buildWelcomeEmail", () => {
  const built = () => buildWelcomeEmail("Ann Volunteer", "https://nbcc.scot/unsubscribe/tok123");

  it("greets them by first name and carries the subject", () => {
    const { subject, html } = built();
    expect(subject).toBe(WELCOME_SUBJECT);
    expect(html).toContain("Dear Ann,");
  });

  it("falls back to a greeting that reads properly when there is no name", () => {
    const html = buildWelcomeEmail(null, "https://nbcc.scot/unsubscribe/t").html;
    expect(html).toContain("Dear friend,");
    expect(html).not.toContain("Dear ,");
  });

  // The safeguard is only a safeguard if the way out is actually in the email.
  it("carries the recipient's own unsubscribe link", () => {
    expect(built().html).toContain("https://nbcc.scot/unsubscribe/tok123");
  });

  it("tells someone who did not sign up how to get out", () => {
    const { html, text } = built();
    expect(html).toMatch(/didn't sign up/i);
    expect(text).toMatch(/didn't sign up/i);
  });

  it("is branded like every other send — the shared frame, not bespoke markup", () => {
    const { html } = built();
    expect(html).toContain("#800000"); // the maroon frame
    expect(html).toContain("nbcc-logo.png"); // the masthead lockup
  });

  it("carries a plain-text part with the links still reachable", () => {
    const { text } = built();
    expect(text.length).toBeGreaterThan(80);
    expect(text).toContain("https://nbcc.scot/about-us"); // the button's destination survives
    expect(text).not.toContain("<"); // no markup left in the text part
  });
});
