import { describe, it, expect } from "vitest";
import { renderBallThankYou } from "../../src/ball/thank-you-page";

const booking = {
  reference: "BALL-K7M2PQ",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerEmail: "jo@example.com",
  totalPence: 101_520,
  guestToken: "tok123",
};

describe("renderBallThankYou", () => {
  it("confirms the booking with its reference and what was paid", () => {
    const html = renderBallThankYou(booking);
    expect(html).toContain("BALL-K7M2PQ");
    expect(html).toContain("a table of 10");
    expect(html).toContain("£1,015.20");
    expect(html).toContain("jo@example.com");
  });

  it("sends them straight on to naming their guests", () => {
    expect(renderBallThankYou(booking)).toContain('href="/ball/guests/tok123"');
  });

  // Stripe only redirects here on success, so a lookup miss is OUR problem, not theirs.
  it("still reads as success when the booking cannot be found yet", () => {
    const html = renderBallThankYou(null);
    expect(html).toMatch(/Your payment went through/i);
    expect(html).not.toMatch(/error|sorry|went wrong|failed/i);
  });

  it("never tells a paying customer something went wrong", () => {
    for (const html of [renderBallThankYou(booking), renderBallThankYou(null)]) {
      expect(html).toMatch(/You're coming to the Festive Ball/);
      expect(html).not.toMatch(/not found/i);
    }
  });

  it("tells them what to do if the email does not arrive, rather than book again", () => {
    // The intent is unchanged and the wording is not. Both sentences used to end on the idea of
    // paying twice ("before booking again", "before trying again"), which is the last thing to
    // put in front of somebody who has just paid and cannot find the receipt. They now give the
    // two steps in order and name the inbox that will fix it. Collapsed, because the copy wraps.
    const flat = (s: string) => s.replace(/\s+/g, " ");
    for (const html of [flat(renderBallThankYou(null)), flat(renderBallThankYou(booking))]) {
      expect(html).toMatch(/check your junk folder/i);
      expect(html).toMatch(/events@nbcc\.scot/);
      expect(html).toMatch(/we'll sort it out/i);
      expect(html).not.toMatch(/again/i);
    }
  });

  it("is hidden from search engines", () => {
    expect(renderBallThankYou(booking)).toContain('content="noindex, nofollow"');
  });
});
