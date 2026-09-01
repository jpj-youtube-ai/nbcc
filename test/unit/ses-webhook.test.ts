import { describe, it, expect } from "vitest";
import { parseSnsEnvelope, parseSesEvent } from "../../src/newsletter/ses-events";

// The SES delivery webhook is the ONLY writer of delivery facts, and it is a public URL — the
// token in the path is the trust boundary (the route checks it), and these parsers are the shape
// boundary. Both are PURE so every accept/reject path is unit-tested without HTTP — the same
// discipline the old Svix verification tests followed.

describe("parseSnsEnvelope", () => {
  it("accepts a Notification and hands back the id + inner message", () => {
    const envelope = parseSnsEnvelope(
      JSON.stringify({ Type: "Notification", MessageId: "sns-1", Message: '{"eventType":"Delivery"}' }),
    );
    expect(envelope).toEqual({ type: "Notification", messageId: "sns-1", message: '{"eventType":"Delivery"}' });
  });

  it("accepts a SubscriptionConfirmation only for a genuine https SNS URL", () => {
    const good = parseSnsEnvelope(
      JSON.stringify({
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc",
      }),
    );
    expect(good).toEqual({
      type: "SubscriptionConfirmation",
      subscribeUrl: "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc",
    });
  });

  it("REJECTS a confirmation URL pointing anywhere but SNS — no server-side request forgery", () => {
    for (const url of [
      "https://evil.example/collect",
      "http://sns.eu-west-1.amazonaws.com/?x=1", // not https
      "https://sns.eu-west-1.amazonaws.com.evil.example/", // suffix spoof
      "not a url",
    ]) {
      expect(parseSnsEnvelope(JSON.stringify({ Type: "SubscriptionConfirmation", SubscribeURL: url }))).toBeNull();
    }
  });

  it("drops malformed JSON, unknown types, and a Notification without an id or message", () => {
    expect(parseSnsEnvelope("not json")).toBeNull();
    expect(parseSnsEnvelope(JSON.stringify({ Type: "UnsubscribeConfirmation" }))).toBeNull();
    expect(parseSnsEnvelope(JSON.stringify({ Type: "Notification", Message: "{}" }))).toBeNull();
    expect(parseSnsEnvelope(JSON.stringify({ Type: "Notification", MessageId: "x" }))).toBeNull();
  });
});

const sesEvent = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    eventType: "Delivery",
    mail: {
      timestamp: "2026-08-31T10:00:00.000Z",
      destination: ["Dora@Example.com"],
      messageId: "0100018f-aaaa-bbbb-cccc-000000000001",
    },
    delivery: { timestamp: "2026-08-31T10:00:01.000Z" },
    ...over,
  });

describe("parseSesEvent", () => {
  it("maps a Delivery onto the delivered event with the per-event timestamp, address lowercased", () => {
    const parsed = parseSesEvent(sesEvent());
    expect(parsed).toEqual({
      eventType: "delivered",
      email: "dora@example.com",
      occurredAt: new Date("2026-08-31T10:00:01.000Z"),
      detail: null,
      linkUrl: null,
      messageId: "0100018f-aaaa-bbbb-cccc-000000000001",
    });
  });

  // TASK-346: mail.messageId is what lets the audit log stamp an outcome onto the exact send.
  // It is the id SES gave OUR message — deliberately not the SNS notification's own MessageId,
  // which identifies the delivery of the notification and changes per event.
  it("carries the SES message id, so an outcome can find the send it belongs to", () => {
    expect(parseSesEvent(sesEvent())?.messageId).toBe("0100018f-aaaa-bbbb-cccc-000000000001");
  });

  // Events for mail sent before TASK-346, and any sender that omits it. The event must still
  // parse: markEmailDelivery falls back to matching on recipient and recency rather than
  // dropping the outcome entirely.
  it("still parses an event with no message id, rather than dropping it", () => {
    const parsed = parseSesEvent(
      sesEvent({ mail: { timestamp: "2026-08-31T10:00:00.000Z", destination: ["dora@example.com"] } }),
    );
    expect(parsed?.eventType).toBe("delivered");
    expect(parsed?.messageId).toBeNull();
  });

  it("keeps the bounce object as detail on a Bounce — and nothing else, ever", () => {
    const parsed = parseSesEvent(
      sesEvent({
        eventType: "Bounce",
        delivery: undefined,
        bounce: { timestamp: "2026-08-31T10:00:02.000Z", bounceType: "Permanent", bounceSubType: "General" },
      }),
    );
    expect(parsed?.eventType).toBe("bounced");
    expect(parsed?.detail).toEqual({
      timestamp: "2026-08-31T10:00:02.000Z",
      bounceType: "Permanent",
      bounceSubType: "General",
    });
    expect(parsed?.occurredAt).toEqual(new Date("2026-08-31T10:00:02.000Z"));
  });

  it("maps Complaint and Click — a click carries its link", () => {
    expect(parseSesEvent(sesEvent({ eventType: "Complaint", complaint: { timestamp: "2026-08-31T10:00:03.000Z" } }))?.eventType).toBe("complained");
    const clicked = parseSesEvent(
      sesEvent({ eventType: "Click", click: { timestamp: "2026-08-31T10:00:04.000Z", link: "https://nbcc.scot/donate" } }),
    );
    expect(clicked?.eventType).toBe("clicked");
    expect(clicked?.linkUrl).toBe("https://nbcc.scot/donate");
  });

  it("still counts a click whose link is missing — degrade, not drop", () => {
    const clicked = parseSesEvent(sesEvent({ eventType: "Click", click: { timestamp: "2026-08-31T10:00:04.000Z" } }));
    expect(clicked?.eventType).toBe("clicked");
    expect(clicked?.linkUrl).toBeNull();
  });

  it("falls back to mail.timestamp when the per-event timestamp is missing", () => {
    const parsed = parseSesEvent(sesEvent({ delivery: {} }));
    expect(parsed?.occurredAt).toEqual(new Date("2026-08-31T10:00:00.000Z"));
  });

  it("acknowledges-and-drops unconsumed types, malformed bodies, and payloads with no recipient", () => {
    expect(parseSesEvent(sesEvent({ eventType: "Send" }))).toBeNull();
    expect(parseSesEvent("not json")).toBeNull();
    expect(parseSesEvent(sesEvent({ mail: { timestamp: "2026-08-31T10:00:00.000Z", destination: [] } }))).toBeNull();
    expect(parseSesEvent(sesEvent({ mail: { destination: ["dora@example.com"] }, delivery: {} }))).toBeNull(); // no usable timestamp at all
  });
});
