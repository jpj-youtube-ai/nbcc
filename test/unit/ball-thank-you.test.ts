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
    expect(renderBallThankYou(null)).toMatch(/before trying again/i);
    expect(renderBallThankYou(booking)).toMatch(/check your junk folder before booking again/i);
  });

  it("is hidden from search engines", () => {
    expect(renderBallThankYou(booking)).toContain('content="noindex, nofollow"');
  });
});
